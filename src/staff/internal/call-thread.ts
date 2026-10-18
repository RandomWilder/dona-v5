import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { OfficeCitation } from './office-thread.ts';
import type { Queryable } from './types.ts';

export type CallBriefSkip = 'guarantor' | 'whatsapp' | 'off';

export interface CallTurn {
  asker: string;
  question: string;
  answer: string;
  refused: boolean;
  citations: OfficeCitation[];
  hitIds: string[];
  askedAt: Date;
  /** A draft reply. Every other turn is the brief or a follow-up. */
  kind: 'turn' | 'draft';
  /** Hebrew beside a draft that is not already in Hebrew. */
  rendering: string | null;
}

export interface CallThread {
  status: 'writing' | 'ready' | 'skipped';
  skipReason: CallBriefSkip | null;
  turns: CallTurn[];
}

const SKIPS: readonly CallBriefSkip[] = ['guarantor', 'whatsapp', 'off'];

function skipOf(value: string | null): CallBriefSkip | null {
  if (value === null) return null;
  for (const skip of SKIPS) {
    if (value === skip) return skip;
  }
  throw new KernelError('invalid', 'call thread skip is not a known reason');
}

/**
 * Opens the call's thread. False when one already exists: a second identify
 * does not start a second brief.
 */
export async function beginCallThread(
  db: Queryable,
  clock: Clock,
  spec: {
    callId: string;
    status: 'writing' | 'skipped';
    skipReason: CallBriefSkip | null;
  },
): Promise<boolean> {
  if (
    (spec.status === 'skipped' && spec.skipReason === null) ||
    (spec.status !== 'skipped' && spec.skipReason !== null)
  ) {
    throw new KernelError('invalid', 'a skipped brief names its reason');
  }
  const { rows } = await db.query<{ call_thread_id: string }>(
    `INSERT INTO call_thread (
       call_thread_id, service_call_id, status, skip_reason, created_at
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (service_call_id) DO NOTHING
     RETURNING call_thread_id`,
    [newId(clock), spec.callId, spec.status, spec.skipReason, clock.now()],
  );
  return rows.length > 0;
}

interface ThreadRow {
  status: string;
  skip_reason: string | null;
}

interface TurnRow {
  asker: string;
  question: string;
  answer: string;
  refused: boolean;
  citations: OfficeCitation[] | string;
  hit_ids: string[];
  asked_at: Date;
  kind: string | null;
  rendering: string | null;
}

function toTurn(row: TurnRow): CallTurn {
  const citations =
    typeof row.citations === 'string'
      ? (JSON.parse(row.citations) as OfficeCitation[])
      : row.citations;
  return {
    asker: row.asker,
    question: row.question,
    answer: row.answer,
    refused: row.refused,
    citations,
    hitIds: row.hit_ids,
    askedAt: row.asked_at,
    kind: row.kind === 'draft' ? 'draft' : 'turn',
    rendering: row.rendering,
  };
}

export async function loadCallThread(
  db: Queryable,
  callId: string,
): Promise<CallThread | null> {
  const thread = await db.query<ThreadRow>(
    `SELECT status, skip_reason FROM call_thread WHERE service_call_id = $1`,
    [callId],
  );
  const row = thread.rows[0];
  if (!row) return null;
  if (
    row.status !== 'writing' &&
    row.status !== 'ready' &&
    row.status !== 'skipped'
  ) {
    throw new KernelError(
      'invalid',
      'call thread status is not a known status',
    );
  }
  const turns = await db.query<TurnRow>(
    `SELECT t.asker, t.question, t.answer, t.refused, t.citations, t.hit_ids,
            t.asked_at, t.kind, t.rendering
       FROM call_turn t
       JOIN call_thread h ON h.call_thread_id = t.call_thread_id
      WHERE h.service_call_id = $1
      ORDER BY t.ordinal ASC, t.call_turn_id ASC`,
    [callId],
  );
  return {
    status: row.status,
    skipReason: skipOf(row.skip_reason),
    turns: turns.rows.map(toTurn),
  };
}

/** Appends a turn and marks the thread ready. Earlier turns stay. */
export async function appendCallTurn(
  db: Queryable,
  clock: Clock,
  spec: Omit<CallTurn, 'askedAt' | 'kind' | 'rendering'> & { callId: string },
): Promise<void> {
  await insertTurn(db, clock, { ...spec, kind: null, rendering: null });
}

/** A draft reply on the same thread. The Hebrew rendering is null when the draft is Hebrew. */
export async function appendCallDraft(
  db: Queryable,
  clock: Clock,
  spec: Omit<CallTurn, 'askedAt' | 'kind'> & { callId: string },
): Promise<void> {
  await insertTurn(db, clock, { ...spec, kind: 'draft' });
}

async function insertTurn(
  db: Queryable,
  clock: Clock,
  spec: Omit<CallTurn, 'askedAt' | 'kind'> & {
    callId: string;
    kind: 'draft' | null;
  },
): Promise<void> {
  const thread = await db.query<{ call_thread_id: string }>(
    `SELECT call_thread_id FROM call_thread WHERE service_call_id = $1`,
    [spec.callId],
  );
  const threadId = thread.rows[0]?.call_thread_id;
  if (!threadId) {
    throw new KernelError('invalid', 'this call has no brief thread');
  }
  const next = await db.query<{ n: string }>(
    `SELECT COALESCE(MAX(ordinal) + 1, 0)::text AS n
       FROM call_turn WHERE call_thread_id = $1`,
    [threadId],
  );
  await db.query(
    `INSERT INTO call_turn (
       call_turn_id, call_thread_id, asked_at, ordinal, asker,
       question, answer, refused, citations, hit_ids, kind, rendering
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::uuid[], $11, $12)`,
    [
      newId(clock),
      threadId,
      clock.now(),
      Number(next.rows[0]?.n ?? 0),
      spec.asker,
      spec.question,
      spec.answer,
      spec.refused,
      JSON.stringify(spec.citations),
      spec.hitIds,
      spec.kind,
      spec.rendering,
    ],
  );
  await db.query(
    `UPDATE call_thread
        SET status = 'ready', skip_reason = NULL
      WHERE call_thread_id = $1`,
    [threadId],
  );
}
