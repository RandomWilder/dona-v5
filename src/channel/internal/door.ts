// The intake door. #186.
//
// Every channel will hand this one shape. The order is the spec's: the message
// is stored once, before the emergency check, so a failed check leaves it
// held. An emergency is decided before the sorter is asked. A thread with an
// open call stops there, and only then does a verdict become a call or a
// filtered message. A later delivery of a held message finishes that one row.
// One party from the isolation join moves a new call to IDENTIFIED. None, or
// more than one, leaves it in NEW. A service provider's open contact is the
// one party the join does not return who is still identified. An echo is the
// office's own message:
// stored, not sorted, and never a new call.

import {
  ADDRESS_MAX,
  callIsAttachable,
  composeDutyReply,
  DESCRIPTION_MAX,
  emergencyTermMatches,
  flagCallByTerms,
  getCall,
  identifyByAddress,
  listCategories,
  openIntakeCall,
  readEmergencySettings,
  type SorterLabel,
} from '../../calls/contract.ts';
import { listProvidersForParties } from '../../estate/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import { type Clock, today } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import { optionalText, requireText, validId } from '../../kernel/validate.ts';
import {
  normaliseEmail,
  normalisePhone,
  partyHoldingContact,
  resolveUnitsByEmail,
  resolveUnitsByPhone,
} from '../../scope/contract.ts';
import {
  keepAttachmentBytes,
  type ListedAttachment,
  listedAttachments,
} from './attachments.ts';
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
  /** The file itself, when the adapter fetched it. Not stored in the row. */
  bytes?: Buffer;
}

/**
 * An embedded file at least this large is a photo the sender pasted into the
 * body, and is kept; below it is a logo or an icon. SPEC-channel, Attachments.
 */
export const EMBEDDED_FILE_MIN_BYTES = 64 * 1024;

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

export interface SortCategory {
  code: string;
  label: string;
}

export interface SortInput {
  subject: string;
  body: string;
  categories: readonly SortCategory[];
}

export interface TranslateInput {
  subject: string;
  body: string;
}

export interface Translation {
  /** Null when the message is already Hebrew. */
  bodyHe: string | null;
}

export interface SortVerdict {
  label: SorterLabel;
  categoryCode: string | null;
  summary: string | null;
  modelId?: string | null;
  promptVersion?: string | null;
}

export interface Sorter {
  sort(input: SortInput): Promise<SortVerdict>;
  translate(input: TranslateInput): Promise<Translation>;
}

export interface DutyReply {
  to: string;
  body: string;
}

export interface EmailDutyReply {
  messageId: string;
  body: string;
}

export interface IntakeDeps {
  sorter: Sorter;
  matchesEmergency: (text: string) => Promise<boolean>;
  /** Where an attachment's bytes are kept. Required when a message carries any. */
  objects?: ObjectStore;
  /**
   * Sends the fixed duty reply on WhatsApp. Absent, an emergency is still
   * flagged and nothing is sent — the dev form has no Meta number.
   */
  replyOnWhatsapp?: (
    reply: DutyReply,
  ) => Promise<{ externalMessageId: string }>;
  /**
   * The one Outlook reply, on this message. The duty reply is one caller.
   * Absent, an emergency is still flagged and nothing is sent.
   */
  replyOnEmail?: (
    reply: EmailDutyReply,
  ) => Promise<{ externalMessageId: string }>;
  /**
   * A new call was stored. The brief starts here, after the duty reply, and
   * the callback returns before any model call. Absent in tests.
   */
  onCallIdentified?: (callId: string) => Promise<void>;
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
  /** The Hebrew rendering, when the message was not Hebrew. */
  bodyHe: string | null;
  subject: string | null;
  echo: boolean;
  attachments: readonly ListedAttachment[];
}

export interface NoiseMessage {
  id: string;
  title: string;
  body: string;
  bodyHe: string | null;
  sender: string;
  at: Date;
  channel: 'EMAIL' | 'WHATSAPP';
  sorterModel: string | null;
  sorterPrompt: string | null;
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
    bytes: Buffer | null;
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
  modelId: string | null;
  promptVersion: string | null;
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
  const outcome = await intake(db, clock, deps, message);
  await recordDutyReply(db, clock, message, outcome);
  if (outcome.kind === 'call') {
    await deps.onCallIdentified?.(outcome.callId);
  }
  return outcome;
}

async function intake(
  db: Queryable,
  clock: Clock,
  deps: IntakeDeps,
  message: Normalized,
): Promise<IntakeOutcome> {
  const already = await settledOutcome(db, message);
  if (already) return already;

  if (message.echo) return storeEcho(db, clock, deps.objects, message);

  const messageId = await ensureMessage(db, clock, deps.objects, message);
  const raced = await settledOutcome(db, message);
  if (raced) return raced;

  const emergency = await deps.matchesEmergency(messageText(message));
  const thread = await threadOf(db, message);
  await prepareDutyReply(
    db,
    clock,
    deps,
    message,
    messageId,
    emergency,
    thread.openCallId,
  );
  const bodyHe = await askTranslator(deps.sorter, message);
  if (thread.openCallId !== null) {
    const attached = await settleAttach(
      db,
      clock,
      messageId,
      thread.openCallId,
      emergency,
      bodyHe,
    );
    if (attached) return attached;
  }

  const verdict = await askSorter(db, deps.sorter, message);
  const predecessorId =
    thread.openCallId === null
      ? thread.predecessorId
      : (await threadOf(db, message)).predecessorId;
  return settleVerdict(
    db,
    clock,
    message,
    messageId,
    emergency,
    verdict,
    predecessorId,
    bodyHe,
  );
}

/** Claimed, not yet accepted by the provider. A real id replaces it. */
const DUTY_REPLY_PENDING = '';

/**
 * Sends the duty reply before the translator or the sorter run. The inbound
 * row keeps the provider's id, and an open call is marked before the send, so
 * a second delivery does not send again. A blank claim is a send that never
 * finished: the next delivery takes it and sends. A hand-flagged call, and a
 * call that already has its reply, send nothing.
 */
async function prepareDutyReply(
  db: Queryable,
  clock: Clock,
  deps: IntakeDeps,
  message: Normalized,
  messageId: string,
  emergency: boolean,
  openCallId: string | null,
): Promise<void> {
  if (!emergency) return;
  if (message.sourceChannel === 'WHATSAPP') {
    const send = deps.replyOnWhatsapp;
    const to = whatsappTo(message.senderAddress);
    if (!send || to === null) return;
    await sendDutyReply(db, clock, message, messageId, openCallId, (body) =>
      send({ to, body }),
    );
    return;
  }
  if (message.sourceChannel === 'EMAIL') {
    const send = deps.replyOnEmail;
    if (!send) return;
    await sendDutyReply(db, clock, message, messageId, openCallId, (body) =>
      send({ messageId: message.externalMessageId, body }),
    );
  }
}

async function sendDutyReply(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  messageId: string,
  openCallId: string | null,
  send: (body: string) => Promise<{ externalMessageId: string }>,
): Promise<void> {
  const claimedAt = clock.now();
  const body = await inTransaction(db, async (tx) => {
    if (
      openCallId !== null &&
      !(await dutyReplyOwed(tx, openCallId, message.sourceChannel))
    ) {
      return null;
    }
    const held = await tx.query<{ duty_reply_id: string | null }>(
      `SELECT duty_reply_id FROM message WHERE message_id = $1 FOR UPDATE`,
      [messageId],
    );
    const current = held.rows[0]?.duty_reply_id ?? null;
    if (current !== null && current !== DUTY_REPLY_PENDING) return null;
    await tx.query(
      `UPDATE message SET duty_reply_id = $2 WHERE message_id = $1`,
      [messageId, DUTY_REPLY_PENDING],
    );
    if (openCallId !== null) {
      await tx.query(
        `UPDATE service_call
            SET duty_reply_at = $2
          WHERE service_call_id = $1
            AND duty_reply_at IS NULL`,
        [openCallId, claimedAt],
      );
    }
    const settings = await readEmergencySettings(tx);
    return composeDutyReply({ phone: settings.phone, hours: settings.hours });
  });
  if (body === null) return;

  let externalMessageId: string;
  try {
    const sent = await send(body);
    externalMessageId = requireText(
      sent.externalMessageId,
      'externalMessageId',
      EXTERNAL_ID_MAX,
    );
  } catch (error) {
    await releaseDutyClaim(db, messageId, openCallId, claimedAt);
    throw error;
  }

  await db.query(
    `UPDATE message
        SET duty_reply_id = $2
      WHERE message_id = $1
        AND duty_reply_id = $3`,
    [messageId, externalMessageId, DUTY_REPLY_PENDING],
  );
  await insertMessage(
    db,
    clock,
    undefined,
    {
      sourceChannel: message.sourceChannel,
      externalMessageId,
      externalThreadId: message.externalThreadId,
      senderAddress: message.sourceChannel,
      receivedAt: claimedAt,
      subject: null,
      body,
      attachments: [],
      echo: true,
    },
    {
      callId: openCallId,
      label: null,
      summary: null,
      categoryId: null,
    },
  );
}

async function releaseDutyClaim(
  db: Queryable,
  messageId: string,
  openCallId: string | null,
  claimedAt: Date,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE message
          SET duty_reply_id = NULL
        WHERE message_id = $1
          AND duty_reply_id = $2`,
      [messageId, DUTY_REPLY_PENDING],
    );
    if (openCallId === null) return;
    await tx.query(
      `UPDATE service_call
          SET duty_reply_at = NULL
        WHERE service_call_id = $1
          AND duty_reply_at = $2`,
      [openCallId, claimedAt],
    );
  });
}

async function dutyReplyOwed(
  db: Queryable,
  callId: string,
  channel: Normalized['sourceChannel'],
): Promise<boolean> {
  const { rows } = await db.query<{
    source_channel: string;
    emergency: boolean;
    emergency_by: string | null;
    duty_reply_at: Date | null;
    state: string;
    returned_at: Date | null;
  }>(
    `SELECT source_channel, emergency, emergency_by, duty_reply_at, state,
            returned_at
       FROM service_call
      WHERE service_call_id = $1
      FOR UPDATE`,
    [callId],
  );
  const call = rows[0];
  if (!call) return false;
  if (call.source_channel !== channel) return false;
  if (call.state === 'CLOSED' || call.returned_at !== null) return false;
  if (call.duty_reply_at !== null) return false;
  if (call.emergency && call.emergency_by !== 'TERMS') return false;
  return true;
}

function whatsappTo(address: string): string | null {
  const digits = address.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  const compact = address.replace(/[\s\-().+]/g, '');
  if (compact !== digits) return null;
  return digits;
}

/** Stores the reply already accepted by the provider on the call, once. */
async function recordDutyReply(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  outcome: IntakeOutcome,
): Promise<void> {
  if (
    message.echo ||
    (message.sourceChannel !== 'WHATSAPP' && message.sourceChannel !== 'EMAIL')
  ) {
    return;
  }
  const channel = message.sourceChannel;
  const callId = outcome.kind === 'filtered' ? null : outcome.callId;
  if (callId === null) return;
  const found = await db.query<{ duty_reply_id: string | null }>(
    `SELECT duty_reply_id
       FROM message
      WHERE source_channel = $1
        AND external_message_id = $2`,
    [channel, message.externalMessageId],
  );
  const replyId = found.rows[0]?.duty_reply_id ?? null;
  if (replyId === null || replyId === DUTY_REPLY_PENDING) return;

  await inTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE service_call
          SET duty_reply_at = $2
        WHERE service_call_id = $1
          AND duty_reply_at IS NULL
          AND source_channel = $3
          AND emergency = true
          AND emergency_by = 'TERMS'`,
      [callId, clock.now(), channel],
    );
    await tx.query(
      `UPDATE message
          SET service_call_id = $2
        WHERE source_channel = $3
          AND external_message_id = $1
          AND is_echo
          AND service_call_id IS NULL`,
      [replyId, callId, channel],
    );
    const onCall = await tx.query(
      `SELECT 1 FROM message
        WHERE source_channel = $3
          AND external_message_id = $1
          AND service_call_id = $2
          AND is_echo`,
      [replyId, callId, channel],
    );
    if (!onCall.rows[0]) return;
    const audited = await tx.query(
      `SELECT 1 FROM audit_log
        WHERE action = 'channel.duty_reply'
          AND subject_id = $1
          AND outcome = 'ok'`,
      [callId],
    );
    if (audited.rows[0]) return;
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'system',
        action: 'channel.duty_reply',
        subjectId: callId,
        inputs: { channel },
      },
      { outcome: 'ok' },
    );
  });
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
    body_he: string | null;
    subject: string | null;
    is_echo: boolean;
    attachments: unknown;
  }>(
    `SELECT message_id, received_at, body_original, body_he, subject, is_echo,
            attachments
       FROM message
      WHERE service_call_id = $1
      ORDER BY received_at, message_id`,
    [id],
  );
  return rows.map((row) => ({
    id: row.message_id,
    at: row.received_at,
    body: row.body_original,
    bodyHe: row.body_he,
    subject: row.subject,
    echo: row.is_echo,
    attachments: listedAttachments(row.attachments),
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
    body_he: string | null;
    source_channel: 'EMAIL' | 'WHATSAPP';
    sorter_model: string | null;
    sorter_prompt: string | null;
  }>(
    `SELECT message_id, subject, body_original, body_he, sender_address,
            received_at, source_channel, sorter_model, sorter_prompt
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
    channel: row.source_channel,
    bodyHe: row.body_he,
    sorterModel: row.sorter_model,
    sorterPrompt: row.sorter_prompt,
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
      sorter_model: string | null;
      sorter_prompt: string | null;
    }>(
      `SELECT source_channel, sender_address, subject, body_original, is_echo,
              service_call_id, sorter_label, sorter_summary, proposed_category_id,
              sorter_model, sorter_prompt
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
      sorterModel: row.sorter_model,
      sorterPrompt: row.sorter_prompt,
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
    const bytes = bufferOf(item.bytes);
    return {
      fileName: requireText(item.fileName, 'fileName', FILE_NAME_MAX),
      contentType: optionalText(item.contentType, 'contentType', 200),
      byteSize: bytes === null ? (byteSize ?? null) : bytes.length,
      bytes,
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

async function askTranslator(
  sorter: Sorter,
  message: Normalized,
): Promise<string | null> {
  try {
    const result = await sorter.translate({
      subject: message.subject ?? '',
      body: message.body,
    });
    if (result === null || typeof result !== 'object') return null;
    if (typeof result.bodyHe !== 'string') return null;
    const text = result.bodyHe.trim();
    return text === '' ? null : text.slice(0, BODY_MAX);
  } catch {
    return null;
  }
}

async function askSorter(
  db: Queryable,
  sorter: Sorter,
  message: Normalized,
): Promise<ReadyVerdict | null> {
  const categories = await listCategories(db, { activeOnly: true });
  try {
    const verdict = await sorter.sort({
      subject: message.subject ?? '',
      body: message.body,
      categories: categories.map((row) => ({
        code: row.code,
        label: row.labelHe,
      })),
    });
    return readyVerdict(verdict);
  } catch {
    return null;
  }
}

function clip(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, 200);
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
  return {
    label: value.label,
    categoryCode,
    summary,
    modelId: clip(value.modelId),
    promptVersion: clip(value.promptVersion),
  };
}

function isSettled(row: StoredRow): boolean {
  return (
    row.is_echo || row.service_call_id !== null || row.sorter_label !== null
  );
}

async function lookupRow(
  db: Queryable,
  message: Normalized,
): Promise<StoredRow | null> {
  const { rows } = await db.query<StoredRow>(
    `SELECT message_id, service_call_id, is_echo, sorter_label
       FROM message
      WHERE source_channel = $1 AND external_message_id = $2`,
    [message.sourceChannel, message.externalMessageId],
  );
  return rows[0] ?? null;
}

/** A held row has no call and no verdict yet. The next delivery finishes it. */
async function settledOutcome(
  db: Queryable,
  message: Normalized,
): Promise<IntakeOutcome | null> {
  const row = await lookupRow(db, message);
  if (!row || !isSettled(row)) return null;
  return outcomeOf(row);
}

async function lockMessage(
  db: Queryable,
  messageId: string,
): Promise<StoredRow> {
  const { rows } = await db.query<StoredRow>(
    `SELECT message_id, service_call_id, is_echo, sorter_label
       FROM message
      WHERE message_id = $1
      FOR UPDATE`,
    [messageId],
  );
  const row = rows[0];
  if (!row) throw new KernelError('conflict', 'message was not stored');
  return row;
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

async function ensureMessage(
  db: Queryable,
  clock: Clock,
  objects: ObjectStore | undefined,
  message: Normalized,
): Promise<string> {
  return inTransaction(db, async (tx) => {
    const existing = await lookupRow(tx, message);
    if (existing) return existing.message_id;
    const messageId = await insertMessage(tx, clock, objects, message, {
      callId: null,
      label: null,
      summary: null,
      categoryId: null,
    });
    if (messageId) return messageId;
    const raced = await lookupRow(tx, message);
    if (raced) return raced.message_id;
    throw new KernelError('conflict', 'message was not stored');
  });
}

async function storeEcho(
  db: Queryable,
  clock: Clock,
  objects: ObjectStore | undefined,
  message: Normalized,
): Promise<IntakeOutcome> {
  return inTransaction(db, async (tx) => {
    const already = await settledOutcome(tx, message);
    if (already) return already;
    const thread = await threadOf(tx, message);
    const callId =
      thread.openCallId !== null &&
      (await callIsAttachable(tx, thread.openCallId))
        ? thread.openCallId
        : null;
    const messageId = await insertMessage(tx, clock, objects, message, {
      callId,
      label: null,
      summary: null,
      categoryId: null,
    });
    if (messageId === null) {
      const raced = await settledOutcome(tx, message);
      if (raced) return raced;
      throw new KernelError('conflict', 'message was not stored');
    }
    return { kind: 'echo', messageId, callId };
  });
}

/**
 * Links the held message to the open call. Null means that call can no
 * longer take it, so the door goes on to sort.
 */
async function settleAttach(
  db: Queryable,
  clock: Clock,
  messageId: string,
  callId: string,
  emergency: boolean,
  bodyHe: string | null,
): Promise<IntakeOutcome | null> {
  return inTransaction(db, async (tx) => {
    const row = await lockMessage(tx, messageId);
    if (isSettled(row)) return outcomeOf(row);
    if (!(await callIsAttachable(tx, callId))) return null;
    await tx.query(
      `UPDATE message
          SET service_call_id = $2, body_he = $3
        WHERE message_id = $1`,
      [messageId, callId, bodyHe],
    );
    if (emergency) await flagCallByTerms(tx, clock, callId);
    return { kind: 'attached', messageId, callId };
  });
}

async function settleVerdict(
  db: Queryable,
  clock: Clock,
  message: Normalized,
  messageId: string,
  emergency: boolean,
  verdict: ReadyVerdict | null,
  predecessorId: string | null,
  bodyHe: string | null,
): Promise<IntakeOutcome> {
  const noise = verdict?.label === 'noise' && !emergency;
  return inTransaction(db, async (tx) => {
    const row = await lockMessage(tx, messageId);
    if (isSettled(row)) return outcomeOf(row);
    const categoryId =
      verdict === null ? null : await categoryIdOf(tx, verdict.categoryCode);
    if (noise && verdict) {
      await tx.query(
        `UPDATE message
            SET sorter_label = 'noise',
                sorter_summary = $2,
                proposed_category_id = $3,
                body_he = $4,
                sorter_model = $5,
                sorter_prompt = $6
          WHERE message_id = $1`,
        [
          messageId,
          verdict.summary,
          categoryId,
          bodyHe,
          verdict.modelId,
          verdict.promptVersion,
        ],
      );
      return { kind: 'filtered', messageId };
    }
    const toReview =
      verdict === null ||
      verdict.label === 'unsure' ||
      (emergency && verdict.label !== 'call');
    const parties = await partiesFor(tx, clock, message);
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
      sorterModel: verdict?.modelId ?? null,
      sorterPrompt: verdict?.promptVersion ?? null,
    });
    if (parties.length === 1 && parties[0] !== undefined) {
      try {
        await identifyByAddress(tx, clock, {
          callId: call.id,
          partyId: parties[0],
        });
      } catch (error) {
        // A guarantor is not a match, even when the party is also a provider.
        // The calls constraint refuses the link; the call stays NEW and the
        // message is kept.
        const guarantor =
          error instanceof KernelError &&
          error.code === 'invalid' &&
          error.details?.reason === 'guarantor';
        if (!guarantor) throw error;
      }
    }
    await tx.query(
      `UPDATE message
          SET service_call_id = $2,
              sorter_label = $3,
              sorter_summary = $4,
              proposed_category_id = $5,
              body_he = $6,
              sorter_model = $7,
              sorter_prompt = $8
        WHERE message_id = $1`,
      [
        messageId,
        call.id,
        verdict?.label ?? null,
        verdict?.summary ?? null,
        categoryId,
        bodyHe,
        verdict?.modelId ?? null,
        verdict?.promptVersion ?? null,
      ],
    );
    return { kind: 'call', messageId, callId: call.id };
  });
}

async function partiesFor(
  db: Queryable,
  clock: Clock,
  message: Normalized,
): Promise<string[]> {
  try {
    const rows =
      message.sourceChannel === 'EMAIL'
        ? await resolveUnitsByEmail(db, message.senderAddress, clock, {
            actor: { actorKind: 'system' },
          })
        : await resolveUnitsByPhone(db, message.senderAddress, clock, {
            actor: { actorKind: 'system' },
          });
    const ids: string[] = [];
    for (const row of rows) {
      if (!ids.includes(row.party_id)) ids.push(row.party_id);
    }
    if (ids.length > 0) return ids;
    const email = message.sourceChannel === 'EMAIL';
    const value = email
      ? normaliseEmail(message.senderAddress)
      : normalisePhone(message.senderAddress);
    const holder = await partyHoldingContact(db, {
      channel: email ? 'EMAIL' : 'PHONE',
      value,
      day: today(clock),
    });
    if (holder === null) return [];
    const providers = await listProvidersForParties(db, [holder]);
    return providers.length === 1 ? [holder] : [];
  } catch (error) {
    if (error instanceof KernelError && error.code === 'invalid') return [];
    throw error;
  }
}

async function categoryIdOf(
  db: Queryable,
  code: string | null,
): Promise<string | null> {
  if (code === null) return null;
  const categories = await listCategories(db, { activeOnly: true });
  return categories.find((row) => row.code === code)?.id ?? null;
}

function bufferOf(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  throw new KernelError('invalid', 'attachment is not a file', {
    field: 'attachments',
  });
}

async function insertMessage(
  db: Queryable,
  clock: Clock,
  objects: ObjectStore | undefined,
  message: Normalized,
  link: {
    callId: string | null;
    label: SorterLabel | null;
    summary: string | null;
    categoryId: string | null;
  },
): Promise<string | null> {
  const conversationId = await conversationOf(db, clock, message);
  const messageId = newId(clock);
  const attachments = await keepAttachmentBytes(
    objects,
    messageId,
    message.attachments,
  );
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
      messageId,
      conversationId,
      message.sourceChannel,
      message.externalMessageId,
      message.senderAddress,
      message.receivedAt,
      message.subject,
      message.body,
      message.echo,
      JSON.stringify(attachments),
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
