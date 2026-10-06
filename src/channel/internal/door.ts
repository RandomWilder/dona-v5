// The intake door. #186.
//
// Every channel will hand this one shape. The order is the spec's: a message
// is stored once, an emergency is decided before the sorter is asked, a thread
// with an open call stops there, and only then does a verdict become a call
// or a filtered message. Identifying the sender is #189, so a call opened
// here waits in NEW. An echo is the office's own message: stored, not sorted,
// and never a new call.

import {
  ADDRESS_MAX,
  callIsAttachable,
  DESCRIPTION_MAX,
  emergencyTermMatches,
  flagCallByTerms,
  getCall,
  listCategories,
  openIntakeCall,
  readEmergencySettings,
  type SorterLabel,
} from '../../calls/contract.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { optionalText, requireText, validId } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

const BODY_MAX = 100_000;
const SUBJECT_MAX = 500;
const EXTERNAL_ID_MAX = 500;
const ATTACHMENT_MAX = 20;
const FILE_NAME_MAX = 200;

export interface IncomingAttachment {
  fileName: string;
  contentType?: string | null;
  byteSize?: number | null;
}

export interface IncomingMessage {
  sourceChannel: string;
  externalMessageId: string;
  externalThreadId: string;
  senderAddress: string;
  receivedAt: Date;
  subject?: string | null;
  body: string;
  attachments?: readonly IncomingAttachment[];
  echo?: boolean;
}

export interface SortInput {
  subject: string;
  body: string;
}

export interface SortVerdict {
  label: SorterLabel;
  categoryCode: string | null;
  summary: string | null;
}

export interface Sorter {
  sort(input: SortInput): Promise<SortVerdict>;
}

export interface IntakeDeps {
  sorter: Sorter;
  matchesEmergency: (text: string) => Promise<boolean>;
}

export type IntakeOutcome =
  | { kind: 'duplicate'; messageId: string; callId: string | null }
  | { kind: 'echo'; messageId: string; callId: string | null }
  | { kind: 'attached'; messageId: string; callId: string }
  | { kind: 'call'; messageId: string; callId: string }
  | { kind: 'filtered'; messageId: string };

export interface StoredMessage {
  id: string;
  at: Date;
  body: string;
  subject: string | null;
  echo: boolean;
  attachments: readonly { fileName: string }[];
}

export interface NoiseMessage {
  id: string;
  title: string;
  body: string;
  sender: string;
  at: Date;
}

interface Normalized {
  sourceChannel: 'EMAIL' | 'WHATSAPP';
  externalMessageId: string;
  externalThreadId: string;
  senderAddress: string;
  receivedAt: Date;
  subject: string | null;
  body: string;
  attachments: readonly {
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
  }[];
  echo: boolean;
}

interface StoredRow {
  message_id: string;
  service_call_id: string | null;
  is_echo: boolean;
  sorter_label: string | null;
}

interface ReadyVerdict {
  label: SorterLabel;
  categoryCode: string | null;
  summary: string | null;
}

/** The real emergency check. Tests that must prove the order pass their own. */
export function emergencyMatch(
  db: Queryable,
): (text: string) => Promise<boolean> {
  return async (text) => {
    const settings = await readEmergencySettings(db);
    return emergencyTermMatches(text, settings.terms);
  };
}

export async function receiveIncoming(
  db: Queryable,
  clock: Clock,
  deps: IntakeDeps,
  raw: IncomingMessage,
): Promise<IntakeOutcome> {
  const message = normalize(raw);
  const already = await lookup(db, message);
  if (already) return already;

  if (message.echo) return storeEcho(db, clock, message);

  const emergency = await deps.matchesEmergency(messageText(message));
  const thread = await threadOf(db, message);
  if (thread.openCallId !== null) {
    const attached = await storeAttach(
      db,
      clock,
      message,
      thread.openCallId,
      emergency,
    );
    if (attached) return attached;
  }

  const verdict = await askSorter(deps.sorter, message);
  const predecessorId =
    thread.openCallId === null
      ? thread.predecessorId
      : (await threadOf(db, message)).predecessorId;
  return storeVerdict(db, clock, message, emergency, verdict, predecessorId);
}

export async function listMessagesOnCall(
  db: Queryable,
  callId: string,
): Promise<StoredMessage[]> {
  const id = validId(callId, 'call');
  const { rows } = await db.query<{
    message_id: string;
    received_at: Date;
    body_original: string;
    subject: string | null;
    is_echo: boolean;
    attachments: unknown;
  }>(
    `SELECT message_id, received_at, body_original, subject, is_echo, attachments
       FROM message
      WHERE service_call_id = $1
      ORDER BY received_at, message_id`,
    [id],
  );
  return rows.map((row) => ({
    id: row.message_id,
    at: row.received_at,
    body: row.body_original,
    subject: row.subject,
    echo: row.is_echo,
    attachments: fileNames(row.attachments),
  }));
}

export async function listNoiseMessages(
  db: Queryable,
): Promise<NoiseMessage[]> {
  const { rows } = await db.query<{
    message_id: string;
    subject: string | null;
    body_original: string;
    sender_address: string;
    received_at: Date;
  }>(
    `SELECT message_id, subject, body_original, sender_address, received_at
       FROM message
      WHERE service_call_id IS NULL
        AND NOT is_echo
        AND sorter_label = 'noise'
      ORDER BY received_at DESC, message_id DESC`,
  );
  return rows.map((row) => ({
    id: row.message_id,
    title: row.subject ?? firstLine(row.body_original),
    body: row.body_original,
    sender: row.sender_address,
    at: row.received_at,
  }));
}

/**
 * A filtered message becomes a call. The sorter's label stays, so a rescue
 * is still a labelled case. The person who rescued it is who opened the call.
 */
export async function rescueNoise(
  db: Queryable,
  clock: Clock,
  spec: { messageId: string; actorId: string; actorRole?: string | null },
): Promise<{ callId: string }> {
  const messageId = validId(spec.messageId, 'message');
  const actorId = validId(spec.actorId, 'actor');
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{
      source_channel: 'EMAIL' | 'WHATSAPP';
      sender_address: string;
      subject: string | null;
      body_original: string;
      is_echo: boolean;
      service_call_id: string | null;
      sorter_label: string | null;
      sorter_summary: string | null;
      proposed_category_id: string | null;
    }>(
      `SELECT source_channel, sender_address, subject, body_original, is_echo,
              service_call_id, sorter_label, sorter_summary, proposed_category_id
         FROM message
        WHERE message_id = $1
        FOR UPDATE`,
      [messageId],
    );
    const row = rows[0];
    if (!row || row.is_echo || row.sorter_label !== 'noise') {
      throw new KernelError('invalid', 'message is not filtered', {
        field: 'message',
      });
    }
    if (row.service_call_id !== null) {
      throw new KernelError('conflict', 'message is already a call', {
        field: 'message',
      });
    }
    const text = row.subject
      ? `${row.subject}\n${row.body_original}`
      : row.body_original;
    const emergency = await emergencyMatch(tx)(text);
    const call = await openIntakeCall(tx, clock, {
      sourceChannel: row.source_channel,
      description: heading(row.sorter_summary, row.subject, row.body_original),
      senderAddress: row.sender_address,
      emergency,
      toReview: false,
      sorterLabel: 'noise',
      summary: row.sorter_summary,
      proposedCategoryId: row.proposed_category_id,
      predecessorId: null,
      openedBy: actorId,
      actorRole: spec.actorRole,
    });
    await tx.query(
      `UPDATE message SET service_call_id = $2 WHERE message_id = $1`,
      [messageId, call.id],
    );
    return { callId: call.id };
  });
}

function normalize(raw: IncomingMessage): Normalized {
  const sourceChannel = intakeChannel(raw.sourceChannel);
  if (
    !(raw.receivedAt instanceof Date) ||
    Number.isNaN(raw.receivedAt.getTime())
  ) {
    throw new KernelError('invalid', 'receivedAt is not a time', {
      field: 'receivedAt',
    });
  }
  if (raw.echo !== undefined && typeof raw.echo !== 'boolean') {
    throw new KernelError('invalid', 'echo is not a boolean', {
      field: 'echo',
    });
  }
  return {
    sourceChannel,
    externalMessageId: requireText(
      raw.externalMessageId,
      'externalMessageId',
      EXTERNAL_ID_MAX,
    ),
    externalThreadId: requireText(
      raw.externalThreadId,
      'externalThreadId',
      EXTERNAL_ID_MAX,
    ),
    senderAddress: requireText(raw.senderAddress, 'sender', ADDRESS_MAX),
    receivedAt: raw.receivedAt,
    subject:
      raw.subject == null ||
      (typeof raw.subject === 'string' && raw.subject.trim() === '')
        ? null
        : requireText(raw.subject, 'subject', SUBJECT_MAX),
    body: requireText(raw.body, 'body', BODY_MAX),
    attachments: attachmentsOf(raw.attachments),
    echo: raw.echo === true,
  };
}

function intakeChannel(value: string): 'EMAIL' | 'WHATSAPP' {
  if (value === 'EMAIL' || value === 'WHATSAPP') return value;
  throw new KernelError('invalid', 'channel is not an intake channel', {
    field: 'channel',
  });
}

function attachmentsOf(
  value: readonly IncomingAttachment[] | undefined,
): Normalized['attachments'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ATTACHMENT_MAX) {
    throw new KernelError('invalid', 'attachments are not a short list', {
      field: 'attachments',
    });
  }
  return value.map((item) => {
    const byteSize = item.byteSize;
    if (
      byteSize !== undefined &&
      byteSize !== null &&
      (!Number.isInteger(byteSize) || byteSize < 0)
    ) {
      throw new KernelError('invalid', 'byteSize is not a size', {
        field: 'attachments',
      });
    }
    return {
      fileName: requireText(item.fileName, 'fileName', FILE_NAME_MAX),
      contentType: optionalText(item.contentType, 'contentType', 200),
      byteSize: byteSize ?? null,
    };
  });
}

function messageText(message: Normalized): string {
  return message.subject === null
    ? message.body
    : `${message.subject}\n${message.body}`;
}

function heading(
  summary: string | null,
  subject: string | null,
  body: string,
): string {
  const chosen = (summary ?? subject ?? body).trim();
  return chosen.slice(0, DESCRIPTION_MAX);
}

function firstLine(body: string): string {
  const line = body.split('\n', 1)[0] ?? body;
  return line.slice(0, 120);
}

async function askSorter(
  sorter: Sorter,
  message: Normalized,
): Promise<ReadyVerdict | null> {
  try {
    const verdict = await sorter.sort({
      subject: message.subject ?? '',
      body: message.body,
    });
    return readyVerdict(verdict);
  } catch {
    return null;
  }
}

function readyVerdict(value: SortVerdict): ReadyVerdict | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value.label !== 'call' &&
      value.label !== 'unsure' &&
      value.label !== 'noise')
  ) {
    return null;
  }
  const summary =
    typeof value.summary === 'string' && value.summary.trim() !== ''
      ? value.summary.trim().slice(0, DESCRIPTION_MAX)
      : null;
  const categoryCode =
    typeof value.categoryCode === 'string' && value.categoryCode.trim() !== ''
      ? value.categoryCode.trim().toUpperCase()
      : null;
  return { label: value.label, categoryCode, summary };
}

async function lookup(
  db: Queryable,
  message: Normalized,
): Promise<IntakeOutcome | null> {
  const { rows } = await db.query<StoredRow>(
    `SELECT message_id, service_call_id, is_echo, sorter_label
       FROM message
      WHERE source_channel = $1 AND external_message_id = $2`,
    [message.sourceChannel, message.externalMessageId],
  );
  const row = rows[0];
  if (!row) return null;
  return outcomeOf(row);
}

function outcomeOf(row: StoredRow): IntakeOutcome {
  if (row.is_echo) {
    return {
      kind: 'echo',
      messageId: row.message_id,
      callId: row.service_call_id,
    };
  }
  if (row.service_call_id !== null) {
    return {
      kind: 'duplicate',
      messageId: row.message_id,
      callId: row.service_call_id,
    };
  }
  return { kind: 'duplicate', messageId: row.message_id, callId: null };
}

async function threadOf(
  db: Queryable,
  message: Normalized,
): Promise<{ openCallId: string | null; predecessorId: string | null }> {
  const { rows } = await db.query<{ service_call_id: string }>(
    `SELECT m.service_call_id
       FROM message m
       JOIN conversation c ON c.conversation_id = m.conversation_id
      WHERE c.source_channel = $1
        AND c.external_thread_id = $2
        AND m.service_call_id IS NOT NULL
      GROUP BY m.service_call_id
      ORDER BY max(m.received_at) DESC`,
    [message.sourceChannel, message.externalThreadId],
  );
  let openCallId: string | null = null;
  let predecessorId: string | null = null;
  for (const row of rows) {
    const call = await getCall(db, row.service_call_id);
    if (!call) continue;
    if (call.state !== 'CLOSED' && !call.returned) {
      openCallId = call.id;
      break;
    }
    if (call.state === 'CLOSED' && predecessorId === null) {
      predecessorId = call.id;
    }
  }
  return {
    openCallId,
    predecessorId: openCallId === null ? predecessorId : null,
  };
}

async function storeEcho(
  db: Queryable,
  clock: Clock,
  message: Normalized,
): Promise<IntakeOutcome> {
  return inTransaction(db, async (tx) => {
    const already = await lookup(tx, message);
    if (already) return already;
    const thread = await threadOf(tx, message);
    const callId =
      thread.openCallId !== null &&
      (await callIsAttachable(tx, thread.openCallId))
        ? thread.openCallId
        : null;
    const messageId = await insertMessage(tx, clock, message, {
      callId,
      label: null,
      summary: null,
      categoryId: null,
    });
    if (messageId === null) {
      const raced = await lookup(tx, message);
      if (raced) return raced;
      throw new KernelError('conflict', 'message was not stored');
    }
    return { kind: 'echo', messageId, callId };
  });
}

async function storeAttach(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  callId: string,
  emergency: boolean,
): Promise<IntakeOutcome | null> {
  return inTransaction(db, async (tx) => {
    const already = await lookup(tx, message);
    if (already) return already;
    if (!(await callIsAttachable(tx, callId))) return null;
    const messageId = await insertMessage(tx, clock, message, {
      callId,
      label: null,
      summary: null,
      categoryId: null,
    });
    if (messageId === null) {
      const raced = await lookup(tx, message);
      if (raced) return raced;
      throw new KernelError('conflict', 'message was not stored');
    }
    if (emergency) await flagCallByTerms(tx, clock, callId);
    return { kind: 'attached', messageId, callId };
  });
}

async function storeVerdict(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  emergency: boolean,
  verdict: ReadyVerdict | null,
  predecessorId: string | null,
): Promise<IntakeOutcome> {
  const noise = verdict?.label === 'noise' && !emergency;
  return inTransaction(db, async (tx) => {
    const already = await lookup(tx, message);
    if (already) return already;
    const categoryId =
      verdict === null ? null : await categoryIdOf(tx, verdict.categoryCode);
    if (noise && verdict) {
      const messageId = await insertMessage(tx, clock, message, {
        callId: null,
        label: 'noise',
        summary: verdict.summary,
        categoryId,
      });
      if (messageId === null) {
        const raced = await lookup(tx, message);
        if (raced) return raced;
        throw new KernelError('conflict', 'message was not stored');
      }
      return { kind: 'filtered', messageId };
    }
    const toReview =
      verdict === null ||
      verdict.label === 'unsure' ||
      (emergency && verdict.label !== 'call');
    const call = await openIntakeCall(tx, clock, {
      sourceChannel: message.sourceChannel,
      description: heading(
        verdict?.summary ?? null,
        message.subject,
        message.body,
      ),
      senderAddress: message.senderAddress,
      emergency,
      toReview,
      sorterLabel: verdict?.label ?? null,
      summary: verdict?.summary ?? null,
      proposedCategoryId: categoryId,
      predecessorId,
      openedBy: null,
      actorRole: null,
    });
    const messageId = await insertMessage(tx, clock, message, {
      callId: call.id,
      label: verdict?.label ?? null,
      summary: verdict?.summary ?? null,
      categoryId,
    });
    if (messageId === null) {
      throw new KernelError('conflict', 'message was not stored');
    }
    return { kind: 'call', messageId, callId: call.id };
  });
}

async function categoryIdOf(
  db: Queryable,
  code: string | null,
): Promise<string | null> {
  if (code === null) return null;
  const categories = await listCategories(db, { activeOnly: true });
  return categories.find((row) => row.code === code)?.id ?? null;
}

async function insertMessage(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  link: {
    callId: string | null;
    label: SorterLabel | null;
    summary: string | null;
    categoryId: string | null;
  },
): Promise<string | null> {
  const conversationId = await conversationOf(db, clock, message);
  const { rows } = await db.query<{ message_id: string }>(
    `INSERT INTO message
       (message_id, conversation_id, source_channel, external_message_id,
        sender_address, received_at, subject, body_original, body_he, is_echo,
        attachments, service_call_id, sorter_label, sorter_summary,
        proposed_category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10::jsonb, $11, $12, $13, $14)
     ON CONFLICT (source_channel, external_message_id) DO NOTHING
     RETURNING message_id`,
    [
      newId(clock),
      conversationId,
      message.sourceChannel,
      message.externalMessageId,
      message.senderAddress,
      message.receivedAt,
      message.subject,
      message.body,
      message.echo,
      JSON.stringify(message.attachments),
      link.callId,
      link.label,
      link.summary,
      link.categoryId,
    ],
  );
  return rows[0]?.message_id ?? null;
}

async function conversationOf(
  db: Queryable,
  clock: Clock,
  message: Normalized,
): Promise<string> {
  const inserted = await db.query<{ conversation_id: string }>(
    `INSERT INTO conversation (conversation_id, source_channel, external_thread_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (source_channel, external_thread_id) DO NOTHING
     RETURNING conversation_id`,
    [newId(clock), message.sourceChannel, message.externalThreadId],
  );
  if (inserted.rows[0]) return inserted.rows[0].conversation_id;
  const found = await db.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversation
      WHERE source_channel = $1 AND external_thread_id = $2`,
    [message.sourceChannel, message.externalThreadId],
  );
  const row = found.rows[0];
  if (!row) throw new KernelError('conflict', 'conversation was not stored');
  return row.conversation_id;
}

function fileNames(value: unknown): { fileName: string }[] {
  if (!Array.isArray(value)) return [];
  const names: { fileName: string }[] = [];
  for (const item of value) {
    if (
      item !== null &&
      typeof item === 'object' &&
      'fileName' in item &&
      typeof item.fileName === 'string'
    ) {
      names.push({ fileName: item.fileName });
    }
  }
  return names;
}
