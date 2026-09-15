import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { Queryable } from './types.ts';

export type OfficeRetrievalBound =
  | { kind: 'unit'; id: string }
  | { kind: 'building'; id: string }
  | { kind: 'portfolio' };

export interface OfficeCitation {
  documentId: string;
  page: number;
  documentType: string;
}

export interface OfficeRetrievalTurn {
  question: string;
  answer: string;
  refused: boolean;
  citations: OfficeCitation[];
  hitIds: string[];
}

export interface AppendOfficeTurnSpec extends OfficeRetrievalTurn {
  staffAccountId: string;
  bound: OfficeRetrievalBound;
}

function boundParts(bound: OfficeRetrievalBound): {
  kind: OfficeRetrievalBound['kind'];
  id: string | null;
} {
  if (bound.kind === 'portfolio') {
    return { kind: 'portfolio', id: null };
  }
  if (typeof bound.id !== 'string' || bound.id.length === 0) {
    throw new KernelError('invalid', 'a retrieval bound is required');
  }
  return { kind: bound.kind, id: bound.id };
}

interface TurnRow {
  question: string;
  answer: string;
  refused: boolean;
  citations: OfficeCitation[] | string;
  hit_ids: string[];
}

function toTurn(row: TurnRow): OfficeRetrievalTurn {
  const citations =
    typeof row.citations === 'string'
      ? (JSON.parse(row.citations) as OfficeCitation[])
      : row.citations;
  return {
    question: row.question,
    answer: row.answer,
    refused: row.refused,
    citations,
    hitIds: row.hit_ids,
  };
}

export async function loadOfficeRetrievalThread(
  db: Queryable,
  staffAccountId: string,
  bound: OfficeRetrievalBound,
): Promise<OfficeRetrievalTurn[]> {
  const { kind, id } = boundParts(bound);
  const { rows } = await db.query<TurnRow>(
    `SELECT t.question, t.answer, t.refused, t.citations, t.hit_ids
       FROM office_retrieval_turn t
       JOIN office_retrieval_thread h
         ON h.office_retrieval_thread_id = t.office_retrieval_thread_id
      WHERE h.staff_account_id = $1
        AND h.bound_kind = $2
        AND h.bound_id IS NOT DISTINCT FROM $3
      ORDER BY t.ordinal ASC, t.office_retrieval_turn_id ASC`,
    [staffAccountId, kind, id],
  );
  return rows.map(toTurn);
}

async function ensureThread(
  db: Queryable,
  clock: Clock,
  staffAccountId: string,
  bound: OfficeRetrievalBound,
): Promise<string> {
  const { kind, id } = boundParts(bound);
  const existing = await db.query<{ office_retrieval_thread_id: string }>(
    `SELECT office_retrieval_thread_id
       FROM office_retrieval_thread
      WHERE staff_account_id = $1
        AND bound_kind = $2
        AND bound_id IS NOT DISTINCT FROM $3`,
    [staffAccountId, kind, id],
  );
  const found = existing.rows[0]?.office_retrieval_thread_id;
  if (found) return found;

  const threadId = newId(clock);
  await db.query(
    `INSERT INTO office_retrieval_thread (
       office_retrieval_thread_id, staff_account_id, bound_kind, bound_id, created_at
     ) VALUES ($1, $2, $3, $4, $5)`,
    [threadId, staffAccountId, kind, id, clock.now()],
  );
  return threadId;
}

export async function appendOfficeRetrievalTurn(
  db: Queryable,
  clock: Clock,
  spec: AppendOfficeTurnSpec,
): Promise<void> {
  const threadId = await ensureThread(
    db,
    clock,
    spec.staffAccountId,
    spec.bound,
  );
  const next = await db.query<{ n: string }>(
    `SELECT COALESCE(MAX(ordinal) + 1, 0)::text AS n
       FROM office_retrieval_turn
      WHERE office_retrieval_thread_id = $1`,
    [threadId],
  );
  await db.query(
    `INSERT INTO office_retrieval_turn (
       office_retrieval_turn_id, office_retrieval_thread_id, asked_at, ordinal,
       question, answer, refused, citations, hit_ids
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid[])`,
    [
      newId(clock),
      threadId,
      clock.now(),
      Number(next.rows[0]?.n ?? 0),
      spec.question,
      spec.answer,
      spec.refused,
      JSON.stringify(spec.citations),
      spec.hitIds,
    ],
  );
}

export async function clearOfficeRetrievalThread(
  db: Queryable,
  staffAccountId: string,
  bound: OfficeRetrievalBound,
): Promise<void> {
  const { kind, id } = boundParts(bound);
  await db.query(
    `DELETE FROM office_retrieval_thread
      WHERE staff_account_id = $1
        AND bound_kind = $2
        AND bound_id IS NOT DISTINCT FROM $3`,
    [staffAccountId, kind, id],
  );
}
