// Opening a service call by hand. #182.
//
// PHONE and WALK_IN skip the sorter. The channel is written once; nothing in this
// module updates it, and the database trigger refuses a later write that tries.
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { validId } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

export const SOURCE_CHANNELS = [
  'WHATSAPP',
  'EMAIL',
  'PHONE',
  'WALK_IN',
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const CALL_STATES = [
  'NEW',
  'IDENTIFIED',
  'TRIAGED',
  'RESPONSIBILITY_SET',
  'WINDOWS_COLLECTED',
  'OFFERED',
  'SCHEDULED',
  'CLOSED',
] as const;
export type CallState = (typeof CALL_STATES)[number];

const MANUAL_CHANNELS = ['PHONE', 'WALK_IN'] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

export type CallSender = { kind: 'named'; name: string } | { kind: 'unknown' };

export interface ServiceCall {
  id: string;
  sourceChannel: SourceChannel;
  state: CallState;
  description: string;
  sender: CallSender;
  openedAt: Date;
}

export interface OpenCallSpec {
  sourceChannel: string;
  description: string;
  sender: CallSender;
  openedBy: string;
  actorRole?: string | null;
}

export const DESCRIPTION_MAX = 4000;
export const SENDER_MAX = 200;

function refuse(field: 'channel' | 'description' | 'sender'): never {
  throw new KernelError('invalid', `${field} is required`, { field });
}

function requiredText(
  value: string,
  field: 'description' | 'sender',
  max: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) refuse(field);
  return trimmed;
}

function manualChannel(value: string): ManualChannel {
  if (value === 'PHONE' || value === 'WALK_IN') return value;
  return refuse('channel');
}

interface CallRow {
  service_call_id: string;
  source_channel: SourceChannel;
  state: CallState;
  description: string;
  sender_label: string | null;
  sender_unknown: boolean;
  opened_at: Date;
}

function toCall(row: CallRow): ServiceCall {
  return {
    id: row.service_call_id,
    sourceChannel: row.source_channel,
    state: row.state,
    description: row.description,
    sender: row.sender_unknown
      ? { kind: 'unknown' }
      : { kind: 'named', name: row.sender_label ?? '' },
    openedAt: row.opened_at,
  };
}

export async function openCall(
  db: Queryable,
  clock: Clock,
  spec: OpenCallSpec,
): Promise<ServiceCall> {
  const sourceChannel = manualChannel(spec.sourceChannel);
  const description = requiredText(
    spec.description,
    'description',
    DESCRIPTION_MAX,
  );
  const openedBy = validId(spec.openedBy, 'openedBy');
  const senderLabel =
    spec.sender.kind === 'unknown'
      ? null
      : requiredText(spec.sender.name, 'sender', SENDER_MAX);
  const senderUnknown = senderLabel === null;
  const id = newId(clock);
  const openedAt = clock.now();

  await inTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO service_call
         (service_call_id, source_channel, state, description, sender_label,
          sender_unknown, opened_at, opened_by)
       VALUES ($1, $2, 'NEW', $3, $4, $5, $6, $7)`,
      [
        id,
        sourceChannel,
        description,
        senderLabel,
        senderUnknown,
        openedAt,
        openedBy,
      ],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId: openedBy,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.open',
        subjectId: id,
        inputs: {
          sourceChannel,
          sender: senderUnknown ? 'unknown' : 'named',
        },
      },
      { outcome: 'ok' },
    );
  });

  return {
    id,
    sourceChannel,
    state: 'NEW',
    description,
    sender:
      senderLabel === null
        ? { kind: 'unknown' }
        : { kind: 'named', name: senderLabel },
    openedAt,
  };
}

export async function listOpenCalls(db: Queryable): Promise<ServiceCall[]> {
  const { rows } = await db.query<CallRow>(
    `SELECT service_call_id, source_channel, state, description, sender_label,
            sender_unknown, opened_at
       FROM service_call
      WHERE state <> 'CLOSED'
      ORDER BY opened_at DESC, service_call_id DESC`,
  );
  return rows.map(toCall);
}
