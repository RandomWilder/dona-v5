// #196. Gmail is the standby. A recorded Gmail API message becomes the same
// incoming mail Outlook would hand the door. Nothing here is configured,
// polled, or allowed to send.

import type { IncomingAttachment, IncomingMessage } from './door.ts';

/** The only Gmail scope this standby may hold. Nothing here mints a token. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function normaliseGmailMessage(
  message: unknown,
): IncomingMessage | null {
  const row = objectOf(message);
  const payload = objectOf(row.payload);
  const id = stringOf(row.id).trim();
  const thread = stringOf(row.threadId).trim();
  const sender = addressOf(header(payload, 'from'));
  const subject = header(payload, 'subject').trim();
  const receivedAt = receivedOf(row.internalDate);
  const found = collect(payload);
  let body = found.plain.trim();
  if (body === '') body = htmlToText(found.html);
  if (body === '') body = subject;
  if (body === '' && found.attachments[0]) body = found.attachments[0].fileName;
  if (
    id === '' ||
    thread === '' ||
    sender === '' ||
    body === '' ||
    receivedAt === null
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
    attachments: found.attachments,
    echo: false,
  };
}

function collect(payload: Record<string, unknown>): {
  plain: string;
  html: string;
  attachments: IncomingAttachment[];
} {
  const found = {
    plain: '',
    html: '',
    attachments: [] as IncomingAttachment[],
  };
  walk(payload, found);
  return found;
}

function walk(
  part: Record<string, unknown>,
  found: { plain: string; html: string; attachments: IncomingAttachment[] },
): void {
  const filename = stringOf(part.filename).trim();
  const disposition = header(part, 'content-disposition').trim().toLowerCase();
  const mime = stringOf(part.mimeType).toLowerCase();
  if (filename !== '') {
    if (!disposition.startsWith('inline')) {
      found.attachments.push(fileOf(part, filename, mime));
    }
    return;
  }
  const text = decode(stringOf(objectOf(part.body).data));
  if (mime === 'text/plain' && found.plain === '') found.plain = text;
  if (mime === 'text/html' && found.html === '') found.html = text;
  const parts = Array.isArray(part.parts) ? part.parts : [];
  for (const child of parts) walk(objectOf(child), found);
}

function fileOf(
  part: Record<string, unknown>,
  filename: string,
  mime: string,
): IncomingAttachment {
  const body = objectOf(part.body);
  const bytes = bytesOf(stringOf(body.data));
  const declared = typeof body.size === 'number' ? body.size : null;
  return {
    fileName: filename,
    contentType: mime === '' ? null : mime,
    byteSize: bytes === null ? declared : bytes.length,
    ...(bytes === null ? {} : { bytes }),
  };
}

function htmlToText(content: string): string {
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

function header(payload: Record<string, unknown>, name: string): string {
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  for (const item of headers) {
    const row = objectOf(item);
    if (stringOf(row.name).toLowerCase() === name) return stringOf(row.value);
  }
  return '';
}

function addressOf(from: string): string {
  const angled = from.match(/<([^<>\s]+)>/);
  if (angled?.[1]) return angled[1].trim();
  const bare = from.match(/[^\s<>]+@[^\s<>]+/);
  if (bare?.[0]) return bare[0];
  return from.trim();
}

function receivedOf(value: unknown): Date | null {
  const raw = stringOf(value);
  if (!/^\d+$/.test(raw)) return null;
  const date = new Date(Number(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function decode(data: string): string {
  const bytes = bytesOf(data);
  return bytes === null ? '' : bytes.toString('utf8');
}

function bytesOf(data: string): Buffer | null {
  const raw = data.replace(/\s/g, '');
  if (raw === '') return null;
  const bytes = Buffer.from(raw, 'base64url');
  return bytes.length === 0 ? null : bytes;
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
