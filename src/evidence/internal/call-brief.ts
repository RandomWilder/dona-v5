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
 * not a source, except a provider brief, whose record is the only fact.
 */
export const CALL_BRIEF_INSTRUCTIONS =
  'Answer in Hebrew. This is the call brief: what the paper says about this request. Facts are only this turn’s numbered passages, unless the context says the requester is a service provider — then the context is their record and the only fact, and there are no passages. Thread text and any other context line are not sources. Copy names, amounts and dates exactly as printed. When a passage heading names a clause, use that heading. Cite a passage by its number. If the passages do not answer, set answers to false. Do not propose a command and do not say the call moved.';

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
}

export interface CallBriefSpec {
  callId: string;
  question: string;
  bounds: readonly RetrievalBound[];
  context: string;
  /** The provider record is the only fact. No passage is searched. */
  providerOnly: boolean;
  /** A person asked again. The first brief does not append a second turn. */
  refresh: boolean;
}

function modelInput(
  question: string,
  context: string,
  hits: PassageHit[],
): string {
  const parts = [`CONTEXT:\n${context}`, `QUESTION:\n${question}`];
  if (hits.length > 0) {
    const passages = hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.documentType} page ${hit.page}\n${hit.text}`,
      )
      .join('\n\n');
    parts.push(`PASSAGES:\n${passages}`);
  }
  return parts.join('\n\n');
}

function citationsOf(
  reply: unknown,
  hits: PassageHit[],
  providerOnly: boolean,
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
    citations.push({
      documentId: hit.documentId,
      page: hit.page,
      documentType: hit.documentType,
    });
  }
  if (citations.length === 0 && !providerOnly) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  return { refused: false, text, citations };
}

/** The brief's answer from this turn's passages. No thread is written. */
export async function answerCallBrief(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  question: string,
  hits: PassageHit[],
  context: string,
  providerOnly: boolean,
): Promise<{ refused: boolean; text: string; citations: OfficeCitation[] }> {
  if (hits.length === 0 && !providerOnly) {
    return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
  }
  return citationsOf(
    await deps.extractor.extract({
      model: deps.model,
      name: 'call_brief',
      instructions: CALL_BRIEF_INSTRUCTIONS,
      input: modelInput(question, context, hits),
      schema: CALL_BRIEF_SCHEMA,
      reasoningEffort: deps.reasoningEffort,
    }),
    hits,
    providerOnly,
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
  if (!spec.refresh && thread.turns.length > 0) return;
  if (spec.refresh && thread.status !== 'ready') return;

  const hits: PassageHit[] = [];
  if (!spec.providerOnly) {
    const seen = new Set<string>();
    for (const bound of spec.bounds) {
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
  }

  const decided = await answerCallBrief(
    deps,
    spec.question,
    hits,
    spec.context,
    spec.providerOnly,
  );

  await appendCallTurn(deps.db, deps.clock, {
    callId: spec.callId,
    asker: 'copilot',
    question: spec.question,
    answer: decided.text,
    refused: decided.refused,
    citations: decided.citations,
    hitIds: hits.map((hit) => hit.passageId),
  });
}
