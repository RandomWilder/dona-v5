// #193. WhatsApp, through the Cloud API with coexistence. The webhook
// verifies Meta's signature and rejects anything unsigned. Inbound
// messages go through the door. Echoes from the receptionist's phone are
// stored and never open a call. Media is fetched when the message arrives.
// The history webhook is acknowledged and discarded.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import {
  emergencyMatch,
  type IncomingMessage,
  receiveIncoming,
  type Sorter,
} from './door.ts';
import type { Queryable } from './types.ts';

/** Seven days, the warning ahead of Meta's roughly fourteen-day disconnect. */
const ECHO_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
const WHATSAPP_GRAPH_VERSION = 'v25.0';
const FILE_BYTES_MAX = 100 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

export interface WhatsappConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
}

export interface WhatsappResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  bytes(): Promise<Buffer>;
}

export type WhatsappFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<WhatsappResponse>;

interface WhatsappIntake {
  messages: IncomingMessage[];
  echoSeen: boolean;
}

interface ReadContent {
  body: string;
  attachment: {
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
    bytes?: Buffer;
  } | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    whatsappRaw: Buffer | null;
  }
}

const defaultFetch: WhatsappFetch = async (url, init) => {
  const response = await fetch(url, { headers: init?.headers });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
    async bytes() {
      return Buffer.from(await response.arrayBuffer());
    },
  };
};

export function whatsappFrom(
  env: Record<string, string | undefined>,
): WhatsappConfig | null {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim() ?? '';
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim() ?? '';
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim() ?? '';
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
  if (
    appSecret === '' ||
    verifyToken === '' ||
    accessToken === '' ||
    phoneNumberId === ''
  ) {
    return null;
  }
  return { appSecret, verifyToken, accessToken, phoneNumberId };
}

export function hubChallenge(
  config: WhatsappConfig,
  query: Record<string, unknown>,
): string | null {
  if (stringOf(query['hub.mode']) !== 'subscribe') return null;
  const challenge = stringOf(query['hub.challenge']);
  if (challenge === '') return null;
  if (!sameText(stringOf(query['hub.verify_token']), config.verifyToken)) {
    return null;
  }
  return challenge;
}

export function signatureOk(
  config: WhatsappConfig,
  raw: Buffer,
  header: string,
): boolean {
  const given = header.startsWith('sha256=')
    ? header.slice('sha256='.length)
    : '';
  const expected = createHmac('sha256', config.appSecret)
    .update(raw)
    .digest('hex');
  return sameText(given, expected);
}

export async function readWhatsappWebhook(
  config: WhatsappConfig,
  body: unknown,
  fetchImpl: WhatsappFetch,
): Promise<WhatsappIntake> {
  const root = objectOf(body);
  if (stringOf(root.object) !== 'whatsapp_business_account') {
    return { messages: [], echoSeen: false };
  }
  const messages: IncomingMessage[] = [];
  let echoSeen = false;
  for (const entry of arrayOf(root.entry)) {
    for (const change of arrayOf(objectOf(entry).changes)) {
      const field = stringOf(objectOf(change).field);
      const value = objectOf(objectOf(change).value);
      if (!ourNumber(value, config.phoneNumberId)) continue;
      if (field === 'history') continue;
      if (field === 'smb_message_echoes') {
        const echoes = arrayOf(value.message_echoes);
        if (echoes.length > 0) echoSeen = true;
        for (const echo of echoes) {
          const message = await incomingFrom(config, echo, true, fetchImpl);
          if (message) messages.push(message);
        }
        continue;
      }
      if (field !== 'messages') continue;
      for (const item of arrayOf(value.messages)) {
        const message = await incomingFrom(config, item, false, fetchImpl);
        if (message) messages.push(message);
      }
    }
  }
  return { messages, echoSeen };
}

export async function watchWhatsapp(
  db: Queryable,
  clock: Clock,
): Promise<void> {
  await db.query(
    `INSERT INTO whatsapp_health (health_id, watching_since)
     VALUES ('whatsapp', $1)
     ON CONFLICT (health_id) DO NOTHING`,
    [clock.now()],
  );
}

export async function noteWhatsappEcho(
  db: Queryable,
  clock: Clock,
): Promise<void> {
  const now = clock.now();
  await db.query(
    `INSERT INTO whatsapp_health (health_id, last_echo_at, watching_since)
     VALUES ('whatsapp', $1, $1)
     ON CONFLICT (health_id)
     DO UPDATE SET last_echo_at = EXCLUDED.last_echo_at`,
    [now],
  );
}

export async function whatsappWarning(
  db: Queryable,
  clock: Clock,
): Promise<boolean> {
  const { rows } = await db.query<{
    last_echo_at: Date | null;
    watching_since: Date;
  }>(
    `SELECT last_echo_at, watching_since
       FROM whatsapp_health WHERE health_id = 'whatsapp'`,
  );
  const row = rows[0];
  if (!row) return false;
  const since = row.last_echo_at ?? row.watching_since;
  return clock.now().getTime() - since.getTime() >= ECHO_QUIET_MS;
}

export function registerWhatsappWebhook(
  app: FastifyInstance,
  deps: {
    pool: Pool;
    clock: Clock;
    objects?: ObjectStore;
    sorter?: Sorter;
    fetch?: WhatsappFetch;
  },
): void {
  app.decorateRequest('whatsappRaw', null);
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.method !== 'POST') return payload;
    const path = request.url.split('?')[0] ?? '';
    if (path !== '/webhooks/whatsapp') return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(asBuffer(chunk));
    }
    const raw = Buffer.concat(chunks);
    request.whatsappRaw = raw;
    return Readable.from(raw);
  });

  const open = { config: { staff: 'public' as const } };

  app.get('/webhooks/whatsapp', open, async (request, reply) => {
    const config = whatsappFrom(process.env);
    if (!config) throw new KernelError('not_found', 'route not found');
    const challenge = hubChallenge(
      config,
      request.query as Record<string, unknown>,
    );
    if (challenge === null) {
      throw new KernelError('not_allowed', 'not allowed');
    }
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .send(challenge);
  });

  app.post('/webhooks/whatsapp', open, async (request) => {
    const config = whatsappFrom(process.env);
    if (!config) throw new KernelError('not_found', 'route not found');
    const raw = request.whatsappRaw;
    const header = headerOf(request.headers['x-hub-signature-256']);
    if (!raw || !signatureOk(config, raw, header)) {
      throw new KernelError('not_allowed', 'not allowed');
    }
    const batch = await readWhatsappWebhook(
      config,
      request.body,
      deps.fetch ?? defaultFetch,
    );
    const sorter = deps.sorter ?? unconfiguredSorter();
    let storedEcho = false;
    for (const message of batch.messages) {
      await receiveIncoming(
        deps.pool,
        deps.clock,
        {
          sorter,
          matchesEmergency: emergencyMatch(deps.pool),
          objects: deps.objects,
        },
        message,
      );
      if (message.echo) storedEcho = true;
    }
    if (storedEcho) await noteWhatsappEcho(deps.pool, deps.clock);
    return { ok: true };
  });
}

function unconfiguredSorter(): Sorter {
  return {
    async sort() {
      throw new Error('sorter unconfigured');
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

async function incomingFrom(
  config: WhatsappConfig,
  raw: unknown,
  echo: boolean,
  fetchImpl: WhatsappFetch,
): Promise<IncomingMessage | null> {
  const message = objectOf(raw);
  const id = stringOf(message.id);
  const at = receivedAt(message.timestamp);
  if (id === '' || at === null) return null;
  const customer = addressOf(echo ? message.to : message.from);
  const sender = addressOf(message.from);
  if (customer === null || sender === null) return null;
  const content = await contentOf(config, message, fetchImpl);
  if (content === null) return null;
  return {
    sourceChannel: 'WHATSAPP',
    externalMessageId: id,
    externalThreadId: customer.thread,
    senderAddress: sender.sender,
    receivedAt: at,
    body: content.body,
    echo,
    attachments: content.attachment ? [content.attachment] : [],
  };
}

async function contentOf(
  config: WhatsappConfig,
  message: Record<string, unknown>,
  fetchImpl: WhatsappFetch,
): Promise<ReadContent | null> {
  const type = stringOf(message.type);
  if (type === 'text') {
    const body = stringOf(objectOf(message.text).body).trim();
    if (body === '') return null;
    return { body, attachment: null };
  }
  if (!MEDIA_TYPES.has(type)) {
    const body = otherBody(message, type);
    if (body === null) return null;
    return { body, attachment: null };
  }
  const media = objectOf(message[type]);
  const caption = stringOf(media.caption).trim();
  const mime = stringOf(media.mime_type);
  const mediaId = stringOf(media.id);
  const named = fileNameOf(type, mime, stringOf(media.filename));
  if (mediaId === '') {
    if (caption === '') return null;
    return { body: caption, attachment: null };
  }
  if (!/^[A-Za-z0-9]+$/.test(mediaId)) {
    throw new KernelError('unavailable', 'whatsapp media was not fetched');
  }
  const bytes = await fetchMedia(config, mediaId, fetchImpl);
  if (bytes.length === 0) {
    throw new KernelError('unavailable', 'whatsapp media was not fetched');
  }
  const kept = bytes.length <= FILE_BYTES_MAX ? bytes : null;
  return {
    body: caption === '' ? named : caption,
    attachment: {
      fileName: named,
      contentType: mime === '' ? null : mime,
      byteSize: kept ? kept.length : bytes.length,
      bytes: kept ?? undefined,
    },
  };
}

async function fetchMedia(
  config: WhatsappConfig,
  mediaId: string,
  fetchImpl: WhatsappFetch,
): Promise<Buffer> {
  const metaUrl =
    `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${mediaId}` +
    `?phone_number_id=${encodeURIComponent(config.phoneNumberId)}`;
  const meta = await fetchImpl(metaUrl, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!meta.ok) {
    throw new KernelError('unavailable', 'whatsapp media was not fetched');
  }
  const url = stringOf(objectOf(await meta.json()).url);
  if (!hostedByMeta(url)) {
    throw new KernelError('unavailable', 'whatsapp media was not fetched');
  }
  const file = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!file.ok) {
    throw new KernelError('unavailable', 'whatsapp media was not fetched');
  }
  return file.bytes();
}

function hostedByMeta(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'lookaside.fbsbx.com' ||
    host === 'graph.facebook.com' ||
    host.endsWith('.fbcdn.net')
  );
}

function fileNameOf(type: string, mime: string, named: string): string {
  const clean = named.replace(/[/\\]/g, '').trim();
  if (clean !== '' && clean.length <= 200) return clean;
  const known = EXT[mime];
  if (known) return `${type}.${known}`;
  const subtype = mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? '';
  return `${type}.${subtype === '' ? 'bin' : subtype}`;
}

function ourNumber(
  value: Record<string, unknown>,
  phoneNumberId: string,
): boolean {
  return stringOf(objectOf(value.metadata).phone_number_id) === phoneNumberId;
}

function receivedAt(value: unknown): Date | null {
  const seconds = typeof value === 'number' ? value : Number(stringOf(value));
  if (!Number.isFinite(seconds) || seconds < 1_000_000_000) return null;
  return new Date(seconds * 1000);
}

function addressOf(value: unknown): { thread: string; sender: string } | null {
  const raw = stringOf(value).trim();
  if (raw === '') return null;
  const compact = raw.replace(/[\s\-().]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (/^\+?\d{8,15}$/.test(compact) && digits === compact.replace(/^\+/, '')) {
    return { thread: digits, sender: `+${digits}` };
  }
  if (raw.length > 500) return null;
  return { thread: raw, sender: raw };
}

function otherBody(
  message: Record<string, unknown>,
  type: string,
): string | null {
  if (type === 'location') {
    const loc = objectOf(message.location);
    return (
      stringOf(loc.name).trim() || stringOf(loc.address).trim() || 'location'
    );
  }
  if (type === 'reaction') {
    return stringOf(objectOf(message.reaction).emoji).trim() || 'reaction';
  }
  if (type === 'button') {
    return stringOf(objectOf(message.button).text).trim() || 'button';
  }
  if (type === 'edit') {
    const inner = objectOf(objectOf(message.edit).message);
    const text = stringOf(objectOf(inner.text).body).trim();
    if (text !== '') return text;
    const kind = stringOf(inner.type);
    return stringOf(objectOf(inner[kind]).caption).trim() || null;
  }
  if (type === 'interactive' || type === 'contacts' || type === 'order') {
    return type;
  }
  return null;
}

function sameText(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function headerOf(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.alloc(0);
}

function objectOf(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
