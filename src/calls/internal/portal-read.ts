// The calls a tenant may see. The party ids arrive from scope, which is the
// only place that decides the number reaches the tenancy today. This file
// does not join a tenancy, and it does not read a brief or a draft.

import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

export interface PortalReply {
  at: Date;
  body: string;
}

export interface PortalCall {
  id: string;
  number: number;
  sourceChannel: string;
  state: string;
  exitKind: string | null;
  description: string;
  categoryLabel: string | null;
  openedAt: Date;
  cancelNote: string | null;
  visitStarts: Date | null;
  visitEnds: Date | null;
  replies: readonly PortalReply[];
}

interface CallRow {
  service_call_id: string;
  call_number: number | string;
  source_channel: string;
  state: string;
  exit_kind: string | null;
  description: string;
  category_label: string | null;
  opened_at: Date;
  exit_note: string | null;
  visit_starts_at: Date | null;
  visit_ends_at: Date | null;
}

const CALL_SQL = `
  SELECT sc.service_call_id, sc.call_number, sc.source_channel, sc.state,
         sc.exit_kind, sc.description, sc.opened_at, sc.exit_note,
         sc.visit_starts_at, sc.visit_ends_at,
         category.label_he AS category_label
    FROM service_call sc
    LEFT JOIN call_category category ON category.category_id = sc.category_id
   WHERE sc.requester_party_id = ANY($1::uuid[])
     AND sc.returned_at IS NULL
`;

function parties(ids: readonly string[]): string[] {
  return ids.map((id) => validId(id, 'party'));
}

function callNumber(value: number | string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) {
    throw new KernelError('invalid', 'call number is not a number', {
      field: 'call',
    });
  }
  return number;
}

function toCall(row: CallRow, replies: readonly PortalReply[]): PortalCall {
  const cancelled = row.exit_kind === 'CANCELLED' ? row.exit_note : null;
  return {
    id: row.service_call_id,
    number: callNumber(row.call_number),
    sourceChannel: row.source_channel,
    state: row.state,
    exitKind: row.exit_kind,
    description: row.description,
    categoryLabel: row.category_label,
    openedAt: row.opened_at,
    cancelNote:
      cancelled === null || cancelled.trim() === '' ? null : cancelled,
    visitStarts: row.visit_starts_at,
    visitEnds: row.visit_ends_at,
    replies,
  };
}

export async function listPortalCalls(
  db: Queryable,
  partyIds: readonly string[],
): Promise<PortalCall[]> {
  const ids = parties(partyIds);
  if (ids.length === 0) return [];
  const { rows } = await db.query<CallRow>(
    `${CALL_SQL} ORDER BY sc.opened_at DESC, sc.service_call_id DESC`,
    [ids],
  );
  return rows.map((row) => toCall(row, []));
}

export async function readPortalCall(
  db: Queryable,
  callId: string,
  partyIds: readonly string[],
): Promise<PortalCall | null> {
  const id = validId(callId, 'call');
  const ids = parties(partyIds);
  if (ids.length === 0) return null;
  const { rows } = await db.query<CallRow>(
    `${CALL_SQL} AND sc.service_call_id = $2`,
    [ids, id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const replies = await db.query<{ at: Date; note: string }>(
    `SELECT at, note
       FROM service_call_transition
      WHERE service_call_id = $1
        AND kind = 'REPLIED'
        AND note IS NOT NULL
      ORDER BY at, transition_id`,
    [id],
  );
  return toCall(
    row,
    replies.rows.map((reply) => ({ at: reply.at, body: reply.note })),
  );
}
