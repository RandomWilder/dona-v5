import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import {
  appendCallTurn,
  loadCallThread,
  type OfficeCitation,
} from '../../staff/contract.ts';
import { OFFICE_TURN_REFUSAL } from './office-turn.ts';
import {
  type PassageHit,
  type RetrievalBound,
  searchPassages,
} from './search.ts';
import type { Queryable } from './types.ts';

/**
 * What the paper says about this request. Context names the requester and is
 * not a source. A provider's record is a fact on its own; a lease is not searched.
 */
export const CALL_BRIEF_INSTRUCTIONS =
  'Answer in Hebrew. This is the call brief: what the paper says about this request. Facts are only this turn’s numbered passages. When the context says the requester is a service provider, that record is a fact even when no passage answers. Thread text and any other context line are not sources. Copy names, amounts and dates exactly as printed. When a passage heading names a clause, use that heading. A passage whose heading names דין המדינה or נוהל חברה is quoted and cited; it does not decide who is responsible, what a threshold is, or whether this is an emergency. Cite a passage by its number. If the passages do not answer, set answers to false. When the input contains נכון לתאריך, the answer states that date. Do not propose a command and do not say the call moved.';

const CALL_BRIEF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: { type: 'boolean' },
    text: { type: 'string' },
    hit_indexes: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answers', 'text', 'hit_indexes'],
};

export interface CallBriefDeps {
  db: Queryable;
  clock: Clock;
  extractor: Extractor;
  embedder: Embedder;
  model: string;
  reasoningEffort?: string;
  /**
   * The Policy library, as of the date the caller resolved. #254.
   * Typed here so evidence does not import policy.
   */
  searchPolicy: (
    question: string,
    asOf: string,
  ) => Promise<
    readonly {
      passageId: string;
      policyDocumentId: string;
      page: number;
      text: string;
      sectionKey: string;
      sectionLabel: string;
      title: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      distance: number;
    }[]
  >;
}

export interface CallBriefSpec {
  callId: string;
  question: string;
  bounds: readonly RetrievalBound[];
  context: string;
  /** A lease is not searched. The provider record stays a fact on its own. */
  providerOnly: boolean;
  /** A person asked again. The first brief does not append a second turn. */
  refresh: boolean;
  /** A staff follow-up. The brief and a refresh leave this false. */
  followUp?: boolean;
  /** Who asked. The brief is the copilot. */
  asker?: string;
  /** The day the library is searched. The brief's is today. */
  asOf: string;
  /**
   * Set when a follow-up named a date. Office form `dd.mm.yyyy`. Stated in
   * the answer. Absent on the brief.
   */
  statedDate?: string | null;
}

interface BriefHit extends PassageHit {
  policy?: {
    sectionKey: string;
    sectionLabel: string;
    title: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
}

function officeDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function headingOf(hit: BriefHit): string {
  const policy = hit.policy;
  if (!policy) return `${hit.documentType} page ${hit.page}`;
  const until = policy.effectiveTo
    ? ` · הוחלף ב־${officeDate(policy.effectiveTo)}`
    : '';
  return `${policy.sectionLabel} · ${policy.title} · בתוקף מ־${officeDate(policy.effectiveFrom)}${until} · עמוד ${hit.page}`;
}

function questionNamesUnit(question: string, unitNumber: string): boolean {
  const escaped = unitNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`דירה\\s*${escaped}(?![\\p{L}\\p{N}])`, 'u').test(question);
}

/** A follow-up names a unit on file that is not the bound unit. */
export function followUpNamesOtherUnit(
  question: string,
  ownUnit: string | null,
  knownOthers: readonly string[],
): boolean {
  return knownOthers.some(
    (unit) => unit !== ownUnit && questionNamesUnit(question, unit),
  );
}

function modelInput(
  question: string,
  context: string,
  hits: BriefHit[],
  history: readonly { question: string; answer: string }[],
  statedDate: string | null,
): string {
  const parts = [`CONTEXT:\n${context}`];
  if (statedDate) parts.push(`נכון לתאריך: ${statedDate}`);
  if (history.length > 0) {
    const lines = history
      .map((turn, index) => `(${index + 1}) ${turn.question}\n${turn.answer}`)
      .join('\n\n');
    parts.push(`THREAD:\n${lines}`);
  }
  parts.push(`QUESTION:\n${question}`);
  if (hits.length > 0) {
    const passages = hits
      .map((hit, index) => `[${index + 1}] ${headingOf(hit)}\n${hit.text}`)
      .join('\n\n');
    parts.push(`PASSAGES:\n${passages}`);
  }
  return parts.join('\n\n');
}

function citationsOf(
  reply: unknown,
  hits: BriefHit[],
  providerOnly: boolean,
  statedDate: string | null,
): { refused: boolean; text: string; citations: OfficeCitation[] } {
  if (typeof reply !== 'object' || reply === null) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  const value = reply as {
    answers?: unknown;
    text?: unknown;
    hit_indexes?: unknown;
  };
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (value.answers !== true || text.length === 0) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  const citations: OfficeCitation[] = [];
  const seen = new Set<string>();
  const indexes = Array.isArray(value.hit_indexes) ? value.hit_indexes : [];
  for (const raw of indexes) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) continue;
    const hit = hits[raw - 1];
    if (!hit) continue;
    const key = `${hit.documentId}:${hit.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const policy = hit.policy;
    citations.push(
      policy
        ? {
            kind: 'policy',
            policyDocumentId: hit.documentId,
            page: hit.page,
            sectionKey: policy.sectionKey,
            sectionLabel: policy.sectionLabel,
            title: policy.title,
            effectiveFrom: policy.effectiveFrom,
            effectiveTo: policy.effectiveTo,
          }
        : {
            documentId: hit.documentId,
            page: hit.page,
            documentType: hit.documentType,
          },
    );
  }
  if (citations.length === 0 && !providerOnly) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  const stated =
    statedDate && !text.includes(statedDate)
      ? `${text} נכון ל־${statedDate}.`
      : text;
  return { refused: false, text: stated, citations };
}

/** The brief's answer from this turn's passages. No thread is written. */
export async function answerCallBrief(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  question: string,
  hits: BriefHit[],
  context: string,
  providerOnly: boolean,
  history: readonly { question: string; answer: string }[] = [],
  statedDate: string | null = null,
): Promise<{ refused: boolean; text: string; citations: OfficeCitation[] }> {
  if (hits.length === 0 && !providerOnly) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  return citationsOf(
    await deps.extractor.extract({
      model: deps.model,
      name: 'call_brief',
      instructions: CALL_BRIEF_INSTRUCTIONS,
      input: modelInput(question, context, hits, history, statedDate),
      schema: CALL_BRIEF_SCHEMA,
      reasoningEffort: deps.reasoningEffort,
    }),
    hits,
    providerOnly,
    statedDate,
  );
}

/**
 * One brief turn. The first call writes one turn; a refresh appends another.
 * Nothing is written when the thread is skipped or the first turn is already
 * there. An extractor failure writes nothing.
 */
export async function runCallBrief(
  deps: CallBriefDeps,
  spec: CallBriefSpec,
): Promise<void> {
  const thread = await loadCallThread(deps.db, spec.callId);
  if (!thread) return;
  if (thread.status === 'skipped') return;
  if (spec.followUp) {
    if (thread.status !== 'ready') return;
  } else {
    if (!spec.refresh && thread.turns.length > 0) return;
    if (spec.refresh && thread.status !== 'ready') return;
  }

  const hits: BriefHit[] = [];
  const seen = new Set<string>();
  for (const bound of spec.bounds) {
    if (bound.kind === 'policy') {
      const found = await deps.searchPolicy(spec.question, spec.asOf);
      for (const hit of found) {
        if (seen.has(hit.passageId)) continue;
        seen.add(hit.passageId);
        hits.push({
          passageId: hit.passageId,
          documentId: hit.policyDocumentId,
          page: hit.page,
          text: hit.text,
          documentType: hit.sectionKey,
          unitId: null,
          distance: hit.distance,
          policy: {
            sectionKey: hit.sectionKey,
            sectionLabel: hit.sectionLabel,
            title: hit.title,
            effectiveFrom: hit.effectiveFrom,
            effectiveTo: hit.effectiveTo,
          },
        });
      }
      continue;
    }
    if (spec.providerOnly) continue;
    const found = await searchPassages(
      deps.db,
      deps.embedder,
      spec.question,
      'administrator',
      bound,
    );
    for (const hit of found) {
      if (seen.has(hit.passageId)) continue;
      seen.add(hit.passageId);
      hits.push(hit);
    }
  }

  const decided = await answerCallBrief(
    deps,
    spec.question,
    hits,
    spec.context,
    spec.providerOnly,
    spec.followUp
      ? thread.turns.map((turn) => ({
          question: turn.question,
          answer: turn.answer,
        }))
      : [],
    spec.statedDate ?? null,
  );

  await appendCallTurn(deps.db, deps.clock, {
    callId: spec.callId,
    asker: spec.asker ?? 'copilot',
    question: spec.question,
    answer: decided.text,
    refused: decided.refused,
    citations: decided.citations,
    hitIds: hits.map((hit) => hit.passageId),
  });
}
