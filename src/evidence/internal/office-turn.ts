import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import {
  appendOfficeRetrievalTurn,
  loadOfficeRetrievalThread,
  type OfficeCitation,
  type OfficeRetrievalBound,
  type OfficeRetrievalTurn,
} from '../../staff/contract.ts';
import {
  type ActiveLettingInBuilding,
  listActiveLettingsInBuilding,
} from '../../tenancy/contract.ts';
import {
  type PassageHit,
  type RetrievalBound,
  searchPassages,
} from './search.ts';
import type { Queryable } from './types.ts';

/** Frozen refusal. No citations, no Building nudge. */
export const OFFICE_TURN_REFUSAL = 'אין במסמכים האלה תשובה לשאלה הזו.';

export const OFFICE_TURN_INSTRUCTIONS =
  'Answer in Hebrew. Thread text may only clarify the question; it is not a source of facts. Facts are only this turn’s numbered passages, if present, and this turn’s lettings list, if present. Copy names, addresses, amounts and identifiers exactly as printed. When a passage heading names a clause, use that heading. If you answer only from the lettings list, set hit_indexes to [] — a list cites no paper. If passages answer, cite them even when the list is also present. If the lettings list is present and empty, nobody is let today: that is an answer, not a documents refusal. If only passages are present and they do not answer, set answers to false. Do not mention another Unit. Do not suggest a Building or a wider bound.';

export const OFFICE_TOOLS_INSTRUCTIONS =
  'Choose commands for this turn. search retrieves numbered passages (leases, protocols, other paper). list returns who is let in this Building today (unit names, party names, dates — not rent, not identifiers). A table of apartments let today and their tenants uses list and does not rebuild the roll from passages. A question about a document, clause, protocol or printed fact uses search. You may choose both. Facts will only be what the chosen commands return this turn.';

const OFFICE_TURN_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: { type: 'boolean' },
    text: { type: 'string' },
    hit_indexes: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answers', 'text', 'hit_indexes'],
};

const OFFICE_TOOLS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'boolean' },
    list: { type: 'boolean' },
  },
  required: ['search', 'list'],
};

export type OfficeTool = 'search' | 'list';

export interface OfficeTurnDeps {
  db: Queryable;
  clock: Clock;
  extractor: Extractor;
  embedder: Embedder;
  model: string;
  reasoningEffort?: string;
}

export interface OfficeTurnSpec {
  staffAccountId: string;
  bound: RetrievalBound;
  question: string;
}

export interface OfficeTurnResult {
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
  hitIds: string[];
  tools: OfficeTool[];
  thread: OfficeRetrievalTurn[];
}

export function offeredOfficeTools(bound: RetrievalBound): OfficeTool[] {
  if (bound.kind === 'building') return ['search', 'list'];
  return ['search'];
}

/**
 * Active lettings in this Building, for the office turn. Not a tenant tool.
 * A Unit bound or the portfolio is a command error.
 */
export async function listOfficeLettings(
  db: Queryable,
  clock: Clock,
  bound: RetrievalBound,
): Promise<ActiveLettingInBuilding[]> {
  if (bound.kind !== 'building') {
    throw new KernelError(
      'not_allowed',
      'the lettings list is only offered on a Building bound',
    );
  }
  return listActiveLettingsInBuilding(db, bound.id, clock);
}

export async function chooseOfficeTools(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  bound: RetrievalBound,
  question: string,
): Promise<OfficeTool[]> {
  const offered = offeredOfficeTools(bound);
  if (!offered.includes('list')) return ['search'];
  const reply = await deps.extractor.extract({
    model: deps.model,
    name: 'office_tools',
    instructions: OFFICE_TOOLS_INSTRUCTIONS,
    input: `BOUND: building\n\nQUESTION:\n${question}`,
    schema: OFFICE_TOOLS_SCHEMA,
    reasoningEffort: deps.reasoningEffort,
  });
  return readTools(reply, offered);
}

export async function runOfficeTurn(
  deps: OfficeTurnDeps,
  spec: OfficeTurnSpec,
): Promise<OfficeTurnResult> {
  const question = spec.question.trim();
  if (question.length === 0) {
    throw new KernelError('invalid', 'a question is required');
  }
  const bound = asOfficeBound(spec.bound);
  const history = await loadOfficeRetrievalThread(
    deps.db,
    spec.staffAccountId,
    bound,
  );
  const tools = await chooseOfficeTools(deps, spec.bound, question);
  let hits: PassageHit[] = [];
  if (tools.includes('search')) {
    hits = await searchPassages(
      deps.db,
      deps.embedder,
      question,
      'administrator',
      spec.bound,
    );
  }
  let lettings: ActiveLettingInBuilding[] | null = null;
  if (tools.includes('list')) {
    lettings = await listOfficeLettings(deps.db, deps.clock, spec.bound);
  }
  const hitIds = hits.map((hit) => hit.passageId);
  const decided = await answerOfficeHits(
    deps,
    question,
    history,
    hits,
    lettings,
  );

  await appendOfficeRetrievalTurn(deps.db, deps.clock, {
    staffAccountId: spec.staffAccountId,
    bound,
    question,
    answer: decided.text,
    refused: decided.refused,
    citations: decided.citations,
    hitIds,
  });

  const thread = await loadOfficeRetrievalThread(
    deps.db,
    spec.staffAccountId,
    bound,
  );
  return {
    refused: decided.refused,
    text: decided.text,
    citations: decided.citations,
    hitIds,
    tools,
    thread,
  };
}

export async function answerOfficeHits(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  question: string,
  history: OfficeRetrievalTurn[],
  hits: PassageHit[],
  lettings: ActiveLettingInBuilding[] | null = null,
): Promise<{
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
}> {
  if (hits.length === 0 && lettings === null) {
    return refuse();
  }
  const reply = await deps.extractor.extract({
    model: deps.model,
    name: 'office_turn',
    instructions: OFFICE_TURN_INSTRUCTIONS,
    input: modelInput(question, history, hits, lettings),
    schema: OFFICE_TURN_SCHEMA,
    reasoningEffort: deps.reasoningEffort,
  });
  return readReply(reply, hits, lettings !== null);
}

function asOfficeBound(bound: RetrievalBound): OfficeRetrievalBound {
  if (bound.kind === 'portfolio') return { kind: 'portfolio' };
  return { kind: bound.kind, id: bound.id };
}

function readTools(reply: unknown, offered: OfficeTool[]): OfficeTool[] {
  if (typeof reply !== 'object' || reply === null) return ['search'];
  const value = reply as { search?: unknown; list?: unknown };
  const chosen: OfficeTool[] = [];
  if (value.search === true && offered.includes('search'))
    chosen.push('search');
  if (value.list === true && offered.includes('list')) chosen.push('list');
  return chosen.length > 0 ? chosen : ['search'];
}

function modelInput(
  question: string,
  history: OfficeRetrievalTurn[],
  hits: PassageHit[],
  lettings: ActiveLettingInBuilding[] | null,
): string {
  const thread =
    history.length === 0
      ? '(none)'
      : history
          .map(
            (turn) =>
              `Q: ${turn.question}\nA: ${turn.answer}${turn.refused ? ' [refused]' : ''}`,
          )
          .join('\n');
  const parts = [`THREAD:\n${thread}`, `QUESTION:\n${question}`];
  if (hits.length > 0) {
    const passages = hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.documentType} page ${hit.page}\n${hit.text}`,
      )
      .join('\n\n');
    parts.push(`PASSAGES:\n${passages}`);
  }
  if (lettings !== null) {
    const rows =
      lettings.length === 0
        ? '(none)'
        : lettings
            .map(
              (row) =>
                `- ${row.unit_name} · ${row.start_date}–${row.end_date} · ${row.party_names.join(', ') || '(no parties)'}`,
            )
            .join('\n');
    parts.push(`LETTINGS:\n${rows}`);
  }
  return parts.join('\n\n');
}

function readReply(
  reply: unknown,
  hits: PassageHit[],
  listFacts: boolean,
): { refused: boolean; text: string; citations: OfficeCitation[] } {
  if (typeof reply !== 'object' || reply === null) {
    return refuse();
  }
  const value = reply as {
    answers?: unknown;
    text?: unknown;
    hit_indexes?: unknown;
  };
  if (value.answers !== true) {
    return refuse();
  }
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (text.length === 0) {
    return refuse();
  }
  const indexes = Array.isArray(value.hit_indexes) ? value.hit_indexes : [];
  const citations: OfficeCitation[] = [];
  const seen = new Set<string>();
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
  if (citations.length === 0 && !listFacts) {
    return refuse();
  }
  return { refused: false, text, citations };
}

function refuse(): {
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
} {
  return { refused: true, text: OFFICE_TURN_REFUSAL, citations: [] };
}
