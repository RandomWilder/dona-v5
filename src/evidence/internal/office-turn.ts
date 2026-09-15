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
  type PassageHit,
  type RetrievalBound,
  searchPassages,
} from './search.ts';
import type { Queryable } from './types.ts';

/** Frozen refusal. No citations, no Building nudge. */
export const OFFICE_TURN_REFUSAL = 'אין במסמכים האלה תשובה לשאלה הזו.';

export const OFFICE_TURN_INSTRUCTIONS =
  'Answer in Hebrew. Thread text may only clarify the question; it is not a source of facts. Facts are only the numbered passages. Copy names, addresses, amounts and identifiers exactly as printed. When a passage heading names a clause, use that heading. If the passages do not answer, set answers to false. Do not mention another Unit. Do not suggest a Building or a wider bound.';

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
  thread: OfficeRetrievalTurn[];
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
  const hits = await searchPassages(
    deps.db,
    deps.embedder,
    question,
    'administrator',
    spec.bound,
  );
  const hitIds = hits.map((hit) => hit.passageId);
  const decided = await answerOfficeHits(deps, question, history, hits);

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
): Promise<{
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
}> {
  if (hits.length === 0) {
    return refuse();
  }
  const reply = await deps.extractor.extract({
    model: deps.model,
    name: 'office_turn',
    instructions: OFFICE_TURN_INSTRUCTIONS,
    input: modelInput(question, history, hits),
    schema: OFFICE_TURN_SCHEMA,
    reasoningEffort: deps.reasoningEffort,
  });
  return readReply(reply, hits);
}

function asOfficeBound(bound: RetrievalBound): OfficeRetrievalBound {
  if (bound.kind === 'portfolio') return { kind: 'portfolio' };
  return { kind: bound.kind, id: bound.id };
}

function modelInput(
  question: string,
  history: OfficeRetrievalTurn[],
  hits: PassageHit[],
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
  const passages = hits
    .map(
      (hit, index) =>
        `[${index + 1}] ${hit.documentType} page ${hit.page}\n${hit.text}`,
    )
    .join('\n\n');
  return `THREAD:\n${thread}\n\nQUESTION:\n${question}\n\nPASSAGES:\n${passages}`;
}

function readReply(
  reply: unknown,
  hits: PassageHit[],
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
  if (citations.length === 0) {
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
