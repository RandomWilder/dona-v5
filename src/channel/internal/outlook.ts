// #188. Outlook, through Microsoft Graph. Reading never deletes, moves, or
// marks mail as read. #195. Mail.Send is one function, used for the fixed
// emergency reply and nothing else. The reply is posted on that message, so
// it stays on the thread and lands in the mailbox's Sent Items.
//
// A mailbox is read from the cursor it starts at. The first read asks Graph
// for a delta link as of now and imports nothing that arrived earlier. The
// link is stored only after the page has been handed to the door, so a
// restart resumes there.

import { addDays, type Clock, today } from '../../kernel/clock.ts';
import {
  EMBEDDED_FILE_MIN_BYTES,
  type EmailDutyReply,
  type IncomingMessage,
} from './door.ts';
import type { Queryable } from './types.ts';

const CURSOR_ID = 'outlook';
const HOUR_MS = 60 * 60 * 1000;
/** #198. The secret warns this many days before it expires. */
const SECRET_WARN_DAYS = 30;
/** Inside the one-to-two minute window the spec allows. */
export const OUTLOOK_POLL_MS = 90_000;

const defaultGraphFetch: GraphFetch = async (url, init) => fetch(url, init);

export interface OutlookItem {
  message: unknown;
  attachments: readonly unknown[];
}

export interface OutlookPage {
  items: readonly OutlookItem[];
  link: string;
  roundComplete: boolean;
}

export interface OutlookReader {
  start(): Promise<{ link: string }>;
  page(link: string): Promise<OutlookPage>;
}

export interface GraphMailbox {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  /** #198. The secret's expiry, `YYYY-MM-DD`, or null when unset or not a date. */
  secretExpires: string | null;
}

export type SecretWarning =
  | { kind: 'renew'; expires: string }
  | { kind: 'unknown' };

export interface GraphResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type GraphFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<GraphResponse>;

export function graphMailboxFrom(
  env: Record<string, string | undefined>,
): GraphMailbox | null {
  const tenantId = env.GRAPH_TENANT_ID?.trim() ?? '';
  const clientId = env.GRAPH_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GRAPH_CLIENT_SECRET?.trim() ?? '';
  const mailbox = env.GRAPH_MAILBOX?.trim() ?? '';
  if (
    tenantId === '' ||
    clientId === '' ||
    clientSecret === '' ||
    mailbox === ''
  ) {
    return null;
  }
  return {
    tenantId,
    clientId,
    clientSecret,
    mailbox,
    secretExpires: calendarDate(env.GRAPH_SECRET_EXPIRES?.trim() ?? ''),
  };
}

/** From 30 days before the secret expires, and whenever its date is unknown. */
export function secretWarning(
  config: GraphMailbox,
  clock: Clock,
): SecretWarning | null {
  if (config.secretExpires === null) return { kind: 'unknown' };
  if (today(clock) < addDays(config.secretExpires, -SECRET_WARN_DAYS)) {
    return null;
  }
  return { kind: 'renew', expires: config.secretExpires };
}

function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

export function createGraphReader(
  config: GraphMailbox,
  fetchImpl: GraphFetch = defaultGraphFetch,
): OutlookReader {
  const mailbox = config.mailbox.trim();
  let inboxFolderId: string | null = null;
  // Exchange's Mail.Read reaches this mailbox's folders but not the
  // directory, so a link naming the user by id is checked by the inbox's
  // folder id, which belongs to this mailbox alone.
  const assertInboxDelta = async (link: string, token: string) => {
    const cursor = readDeltaLink(link);
    if (isNamedInbox(cursor, mailbox)) return;
    if (cursor.folder.toLowerCase() === 'inbox') {
      throw new Error('outlook cursor is not the inbox delta');
    }
    if (inboxFolderId === null) {
      inboxFolderId = await readInboxFolderId(fetchImpl, mailbox, token);
    }
    if (cursor.folder !== inboxFolderId) {
      throw new Error('outlook cursor is not the inbox delta');
    }
  };
  return {
    async start() {
      const token = await accessToken(config, fetchImpl);
      const url =
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
        '/mailFolders/inbox/messages/delta?$deltatoken=latest' +
        '&$select=id,conversationId,subject,body,from,receivedDateTime,hasAttachments';
      const body = await graphGet(fetchImpl, url, token);
      const link = stringOf(objectOf(body)['@odata.deltaLink']);
      if (link === '') throw new Error('graph did not return a cursor');
      await assertInboxDelta(link, token);
      return { link };
    },
    async page(link) {
      // A link that is not a Graph inbox delta is refused before a token is asked for.
      readDeltaLink(link);
      const token = await accessToken(config, fetchImpl);
      await assertInboxDelta(link, token);
      const body = objectOf(await graphGet(fetchImpl, link, token));
      const value = Array.isArray(body.value) ? body.value : [];
      const items: OutlookItem[] = [];
      for (const message of value) {
        const row = objectOf(message);
        if ('@removed' in row) {
          items.push({ message, attachments: [] });
          continue;
        }
        const id = stringOf(row.id);
        const full = isComplete(row)
          ? message
          : await readMessage(fetchImpl, mailbox, id, token);
        const fullRow = objectOf(full);
        // Not gated on hasAttachments: Graph reports false for a message whose
        // only file is a photo pasted into the body.
        const attachments =
          stringOf(fullRow.id) !== ''
            ? await listAttachments(
                fetchImpl,
                mailbox,
                stringOf(fullRow.id),
                token,
              )
            : [];
        items.push({ message: full ?? message, attachments });
      }
      const delta = stringOf(body['@odata.deltaLink']);
      const next = stringOf(body['@odata.nextLink']);
      if (delta !== '') {
        await assertInboxDelta(delta, token);
        return { items, link: delta, roundComplete: true };
      }
      if (next !== '') {
        await assertInboxDelta(next, token);
        return { items, link: next, roundComplete: false };
      }
      throw new Error('graph page had no cursor');
    },
  };
}

const DELTA_PATH =
  /^\/v1\.0\/users(?:\/([^/]+)|\('([^']*)'\))\/mailfolders(?:\/([^/]+)|\('([^']*)'\))\/messages\/delta$/i;

function readDeltaLink(link: string): { user: string; folder: string } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('outlook cursor is not a link');
  }
  const match = decodeURIComponent(url.pathname).match(DELTA_PATH);
  const user = match?.[1] ?? match?.[2] ?? '';
  const folder = match?.[3] ?? match?.[4] ?? '';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'graph.microsoft.com' ||
    user === '' ||
    folder === ''
  ) {
    throw new Error('outlook cursor is not the inbox delta');
  }
  return { user, folder };
}

function isNamedInbox(
  cursor: { user: string; folder: string },
  mailbox: string,
): boolean {
  return (
    cursor.user.toLowerCase() === mailbox.toLowerCase() &&
    cursor.folder.toLowerCase() === 'inbox'
  );
}

async function readInboxFolderId(
  fetchImpl: GraphFetch,
  mailbox: string,
  token: string,
): Promise<string> {
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
    '/mailFolders/inbox?$select=id';
  const id = stringOf(objectOf(await graphGet(fetchImpl, url, token)).id);
  if (id === '') throw new Error('graph did not name the inbox');
  return id;
}

function isComplete(row: Record<string, unknown>): boolean {
  const from = objectOf(objectOf(row.from).emailAddress);
  return (
    stringOf(row.id) !== '' &&
    stringOf(row.conversationId) !== '' &&
    stringOf(from.address) !== '' &&
    stringOf(row.receivedDateTime) !== ''
  );
}

async function readMessage(
  fetchImpl: GraphFetch,
  mailbox: string,
  messageId: string,
  token: string,
): Promise<unknown> {
  if (messageId === '') return null;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
    `/messages/${encodeURIComponent(messageId)}` +
    '?$select=id,conversationId,subject,body,from,receivedDateTime,hasAttachments';
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      prefer: 'outlook.body-content-type="text"',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`graph read failed: ${response.status}`);
  return response.json();
}

async function listAttachments(
  fetchImpl: GraphFetch,
  mailbox: string,
  messageId: string,
  token: string,
): Promise<unknown[]> {
  const files: unknown[] = [];
  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
    // No $select: contentBytes is on fileAttachment, not on the attachment
    // type the collection is declared as, and Graph refuses the whole request.
    `/messages/${encodeURIComponent(messageId)}/attachments`;
  for (let page = 0; url !== null && page < 10; page += 1) {
    const body = objectOf(await graphGet(fetchImpl, url, token));
    if (Array.isArray(body.value)) files.push(...body.value);
    const next = stringOf(body['@odata.nextLink']);
    url =
      next !== '' &&
      next.startsWith('https://graph.microsoft.com/') &&
      next.includes('/attachments')
        ? next
        : null;
  }
  return files;
}

async function accessToken(
  config: GraphMailbox,
  fetchImpl: GraphFetch,
): Promise<string> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`graph sign-in failed: ${response.status}`);
  const token = stringOf(objectOf(await response.json()).access_token);
  if (token === '') throw new Error('graph sign-in returned no token');
  return token;
}

/**
 * The one mail send. A reply on the inbound message, from this mailbox only.
 * Graph answers 202 and returns no id, so the id we keep names that inbound.
 */
export async function sendOutlookReply(
  config: GraphMailbox,
  reply: EmailDutyReply,
  fetchImpl: GraphFetch = defaultGraphFetch,
): Promise<{ externalMessageId: string }> {
  const messageId = reply.messageId.trim();
  const text = reply.body.trim();
  if (
    messageId === '' ||
    messageId !== reply.messageId ||
    /\s/.test(messageId) ||
    `reply:${messageId}`.length > 500 ||
    text === ''
  ) {
    throw new Error('outlook reply was not sent');
  }
  const token = await accessToken(config, fetchImpl);
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}` +
    `/messages/${encodeURIComponent(messageId)}/reply`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ comment: text }),
  });
  if (!response.ok) throw new Error('outlook reply was not sent');
  return { externalMessageId: `reply:${messageId}` };
}

async function graphGet(
  fetchImpl: GraphFetch,
  url: string,
  token: string,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      prefer: 'outlook.body-content-type="text"',
    },
  });
  if (!response.ok) throw new Error(`graph read failed: ${response.status}`);
  return response.json();
}

export function normaliseOutlookMessage(
  message: unknown,
  attachments: readonly unknown[],
): IncomingMessage | null {
  const row = objectOf(message);
  if ('@removed' in row) return null;
  const from = objectOf(row.from);
  const address = objectOf(from.emailAddress);
  const receivedAt = new Date(stringOf(row.receivedDateTime));
  const id = stringOf(row.id).trim();
  const thread = stringOf(row.conversationId).trim();
  const sender = stringOf(address.address).trim();
  const files = attachmentsOf(attachments) ?? [];
  const subject = stringOf(row.subject).trim();
  let body = textOf(objectOf(row.body)).trim();
  if (body === '') body = subject;
  if (body === '' && files[0]) body = files[0].fileName;
  if (
    id === '' ||
    thread === '' ||
    sender === '' ||
    body === '' ||
    Number.isNaN(receivedAt.getTime())
  ) {
    return null;
  }
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: id,
    externalThreadId: thread,
    senderAddress: sender,
    receivedAt,
    subject: subject === '' ? null : subject,
    body,
    attachments: files,
    echo: false,
  };
}

function attachmentsOf(
  attachments: readonly unknown[],
): IncomingMessage['attachments'] {
  const files = [];
  for (const item of attachments) {
    const row = objectOf(item);
    const fileName = stringOf(row.name).trim();
    if (fileName === '') continue;
    const contentType = stringOf(row.contentType).trim();
    const bytes = bytesOf(row);
    const declared = typeof row.size === 'number' ? row.size : null;
    const size = bytes?.length ?? declared ?? 0;
    if (row.isInline === true && size < EMBEDDED_FILE_MIN_BYTES) continue;
    files.push({
      fileName,
      contentType: contentType === '' ? null : contentType,
      byteSize: bytes === null ? declared : bytes.length,
      ...(bytes === null ? {} : { bytes }),
    });
  }
  return files;
}

function bytesOf(row: Record<string, unknown>): Buffer | null {
  const raw = stringOf(row.contentBytes).replace(/\s/g, '');
  if (raw === '') return null;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length === 0 ? null : bytes;
}

function textOf(body: Record<string, unknown>): string {
  const content = stringOf(body.content);
  if (stringOf(body.contentType).toLowerCase() !== 'html') return content;
  const stripped = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return stripped.replace(/\s+/g, ' ').trim();
}

export function startOutlookPolling(deps: {
  db: Queryable;
  clock: Clock;
  reader: OutlookReader;
  deliver: (message: IncomingMessage) => Promise<void>;
  onError?: (error: unknown) => void;
}): { stop(): void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    pollOutlook(deps.db, deps.clock, deps.reader, deps.deliver)
      .catch((error: unknown) => {
        deps.onError?.(error);
      })
      .finally(() => {
        running = false;
      });
  };
  run();
  timer = setInterval(run, OUTLOOK_POLL_MS);
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export async function pollOutlook(
  db: Queryable,
  clock: Clock,
  reader: OutlookReader,
  deliver: (message: IncomingMessage) => Promise<void>,
): Promise<void> {
  await ensureWatching(db, clock);
  const cursor = await readCursor(db);
  if (cursor.deltaLink === null) {
    const started = await reader.start();
    await saveSuccess(db, clock, started.link);
    return;
  }
  let link = cursor.deltaLink;
  const seen = new Set<string>();
  while (!seen.has(link)) {
    seen.add(link);
    const page = await reader.page(link);
    for (const item of page.items) {
      const message = normaliseOutlookMessage(item.message, item.attachments);
      if (message === null) continue;
      await deliver(message);
    }
    await saveSuccess(db, clock, page.link);
    if (page.roundComplete) return;
    link = page.link;
  }
}

export async function mailboxWarning(
  db: Queryable,
  clock: Clock,
): Promise<boolean> {
  const { rows } = await db.query<{
    last_success_at: Date | null;
    watching_since: Date;
  }>(
    `SELECT last_success_at, watching_since
       FROM email_cursor WHERE cursor_id = $1`,
    [CURSOR_ID],
  );
  const row = rows[0];
  if (!row) return false;
  const since = row.last_success_at ?? row.watching_since;
  return clock.now().getTime() - since.getTime() >= HOUR_MS;
}

async function ensureWatching(db: Queryable, clock: Clock): Promise<void> {
  await db.query(
    `INSERT INTO email_cursor (cursor_id, watching_since)
     VALUES ($1, $2)
     ON CONFLICT (cursor_id) DO NOTHING`,
    [CURSOR_ID, clock.now()],
  );
}

async function readCursor(
  db: Queryable,
): Promise<{ deltaLink: string | null }> {
  const { rows } = await db.query<{ delta_link: string | null }>(
    `SELECT delta_link FROM email_cursor WHERE cursor_id = $1`,
    [CURSOR_ID],
  );
  const row = rows[0];
  if (!row) throw new Error('outlook cursor was not stored');
  return { deltaLink: row.delta_link };
}

async function saveSuccess(
  db: Queryable,
  clock: Clock,
  link: string,
): Promise<void> {
  await db.query(
    `UPDATE email_cursor
        SET delta_link = $2, last_success_at = $3
      WHERE cursor_id = $1`,
    [CURSOR_ID, link, clock.now()],
  );
}

function objectOf(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
