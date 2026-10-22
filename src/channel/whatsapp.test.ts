// #193. The WhatsApp adapter, on recorded Cloud API payloads. No test calls Meta.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import {
  readEmergencySettings,
  saveEmergencySettings,
} from '../calls/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  listMessagesOnCall,
  readWhatsappWebhook,
  receiveIncoming,
  type Sorter,
  watchWhatsapp,
  whatsappFrom,
  whatsappWarning,
} from './contract.ts';

const SECRET = 'app-secret-test';
const VERIFY = 'verify-test';
const TOKEN = 'token-test';
const PHONE_ID = '106540352242922';
const SENDER = '+972599001193';
const BUSINESS = '+15550783881';
const THREAD = '972599001193';
const SUMMARY = 'קריאת וואטסאפ 193';
const WARNING = 'אין הד מהטלפון כבר שבעה ימים. וואטסאפ עלול להתנתק.';
const SEVEN = 7 * 24 * 60 * 60 * 1000;
const ENV_KEYS = [
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

const sorter: Sorter = {
  async sort() {
    return { label: 'call', categoryCode: null, summary: SUMMARY };
  },
  async translate() {
    return { bodyHe: null };
  },
};

function envelope(
  field: string,
  value: Record<string, unknown>,
  phoneNumberId = PHONE_ID,
): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: phoneNumberId,
              },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const INBOUND = envelope('messages', {
  contacts: [{ profile: { name: 'יעל' }, wa_id: THREAD }],
  messages: [
    {
      from: THREAD,
      id: 'wamid.t193.in',
      timestamp: '1759752900',
      type: 'text',
      text: { body: 'יש נזילה בכיור' },
    },
  ],
});

const REVOKE = envelope('smb_message_echoes', {
  message_echoes: [
    {
      from: '15550783881',
      to: THREAD,
      id: 'wamid.t193.revoke',
      timestamp: '1759753000',
      type: 'revoke',
      revoke: { original_message_id: 'wamid.t193.old' },
    },
  ],
});

const ECHO = envelope('smb_message_echoes', {
  message_echoes: [
    {
      from: '15550783881',
      to: THREAD,
      id: 'wamid.t193.echo',
      timestamp: '1759753000',
      type: 'text',
      text: { body: 'נבדוק מחר' },
    },
  ],
});

const MEDIA = envelope('messages', {
  contacts: [{ profile: { name: 'יעל' }, wa_id: THREAD }],
  messages: [
    {
      from: THREAD,
      id: 'wamid.t193.media',
      timestamp: '1759753100',
      type: 'image',
      image: {
        caption: 'הנזילה',
        mime_type: 'image/jpeg',
        sha256: 'abc',
        id: '1234567890',
      },
    },
  ],
});

const HISTORY = envelope('history', {
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 100 },
      threads: [
        {
          id: THREAD,
          messages: [
            {
              from: THREAD,
              id: 'wamid.t193.old',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'היסטוריה ישנה שלא תיכנס' },
            },
          ],
        },
      ],
    },
  ],
});

const STATUSES = envelope('messages', {
  statuses: [
    {
      id: 'wamid.t193.status',
      status: 'delivered',
      timestamp: '1759752900',
      recipient_id: THREAD,
    },
  ],
});

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function envOn(): void {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY;
  process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM message
      WHERE sender_address IN ($1, $2)
         OR conversation_id IN (
           SELECT conversation_id FROM conversation
            WHERE source_channel = 'WHATSAPP' AND external_thread_id = $3
         )`,
    [SENDER, BUSINESS, THREAD],
  );
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call WHERE sender_label = $1
      )`,
    [SENDER],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE subject_id IN (
        SELECT service_call_id::text FROM service_call WHERE sender_label = $1
      )`,
    [SENDER],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [
    SENDER,
  ]);
  await pool.query(
    `DELETE FROM conversation
      WHERE source_channel = 'WHATSAPP' AND external_thread_id = $1`,
    [THREAD],
  );
  await pool.query(`DELETE FROM whatsapp_health WHERE health_id = 'whatsapp'`);
  await signOutAll(pool, 'whatsapp.test');
}

function configured() {
  const config = whatsappFrom({
    WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: VERIFY,
    WHATSAPP_ACCESS_TOKEN: TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
  });
  if (config === null) throw new Error('whatsapp config');
  return config;
}

const unusedFetch = async () => {
  throw new Error('no media');
};

async function withEnv(run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  try {
    envOn();
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('channel · whatsapp', { concurrency: false }, () => {
  it('stays off unless the secret, the verify token, the access token and the phone number are all set', () => {
    const full = {
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY,
      WHATSAPP_ACCESS_TOKEN: TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
    };
    assert.deepEqual(whatsappFrom(full), {
      appSecret: SECRET,
      verifyToken: VERIFY,
      accessToken: TOKEN,
      phoneNumberId: PHONE_ID,
    });
    assert.equal(whatsappFrom({}), null);
    assert.equal(whatsappFrom({ ...full, WHATSAPP_APP_SECRET: ' ' }), null);
  });

  it('rejects an unsigned or wrongly signed webhook', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(new Date('2026-10-08T09:00:00.000Z')),
      sorter,
    });
    const body = JSON.stringify(INBOUND);
    try {
      await withEnv(async () => {
        const unsigned = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: { 'content-type': 'application/json' },
          payload: body,
        });
        assert.equal(unsigned.statusCode, 403);
        const wrong = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(body, 'other-secret'),
          },
          payload: body,
        });
        assert.equal(wrong.statusCode, 403);
        const stored = await pool.query(
          `SELECT message_id FROM message WHERE external_message_id = $1`,
          ['wamid.t193.in'],
        );
        assert.equal(stored.rowCount, 0);
      });
      const off = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': sign(body),
        },
        payload: body,
      });
      assert.equal(off.statusCode, 404);
    } finally {
      await pool.end();
    }
  });

  it('answers Meta only when the verify token matches', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(new Date('2026-10-08T09:00:00.000Z')),
    });
    try {
      await withEnv(async () => {
        const ok = await app.inject({
          method: 'GET',
          url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=challenge-193',
        });
        assert.equal(ok.statusCode, 200);
        assert.equal(ok.body, 'challenge-193');
        const bad = await app.inject({
          method: 'GET',
          url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=challenge-193',
        });
        assert.equal(bad.statusCode, 403);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a 1-on-1 message that is not text, and an address that is not a number', async () => {
    const config = configured();
    const batch = await readWhatsappWebhook(
      config,
      envelope('messages', {
        messages: [
          {
            from: 'not-a-number',
            id: 'wamid.t193.loc',
            timestamp: '1759752900',
            type: 'location',
            location: { name: 'הלובי' },
          },
        ],
      }),
      unusedFetch,
    );
    assert.equal(batch.messages.length, 1);
    assert.equal(batch.messages[0]?.body, 'הלובי');
    assert.equal(batch.messages[0]?.senderAddress, 'not-a-number');
    assert.equal(batch.messages[0]?.externalThreadId, 'not-a-number');
    const revoked = await readWhatsappWebhook(config, REVOKE, unusedFetch);
    assert.equal(revoked.messages.length, 0);
  });

  it('opens a call from a recorded inbound message, and an echo on that conversation attaches', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const config = configured();
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-08T09:00:00.000Z'));
        const deps = {
          sorter,
          matchesEmergency: async () => false,
        };
        const inbound = await readWhatsappWebhook(config, INBOUND, unusedFetch);
        assert.equal(inbound.messages.length, 1);
        assert.equal(inbound.messages[0]?.sourceChannel, 'WHATSAPP');
        assert.equal(inbound.messages[0]?.externalThreadId, THREAD);
        assert.equal(inbound.messages[0]?.senderAddress, SENDER);
        assert.equal(inbound.echoSeen, false);
        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          inbound.messages[0]!,
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        const echo = await readWhatsappWebhook(config, ECHO, unusedFetch);
        assert.equal(echo.echoSeen, true);
        assert.equal(echo.messages[0]?.echo, true);
        assert.equal(echo.messages[0]?.externalThreadId, THREAD);
        const stored = await receiveIncoming(
          db,
          clock,
          deps,
          echo.messages[0]!,
        );
        assert.equal(stored.kind, 'echo');
        if (stored.kind !== 'echo') return;
        assert.equal(stored.callId, opened.callId);
        const messages = await listMessagesOnCall(db, opened.callId);
        assert.equal(
          messages.some((message) => message.body === 'יש נזילה בכיור'),
          true,
        );
        const office = messages.find((message) => message.body === 'נבדוק מחר');
        assert.equal(office?.echo, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('fetches media on receipt and keeps it on the message', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetched: string[] = [];
    const config = configured();
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const batch = await readWhatsappWebhook(
          config,
          MEDIA,
          async (url, init) => {
            fetched.push(url);
            assert.equal(init?.headers?.Authorization, `Bearer ${TOKEN}`);
            if (url.startsWith('https://graph.facebook.com/')) {
              assert.equal(
                url,
                `https://graph.facebook.com/v25.0/1234567890?phone_number_id=${PHONE_ID}`,
              );
              return {
                ok: true,
                status: 200,
                async json() {
                  return {
                    url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1234567890',
                    mime_type: 'image/jpeg',
                    id: '1234567890',
                  };
                },
                async bytes() {
                  return Buffer.alloc(0);
                },
              };
            }
            return {
              ok: true,
              status: 200,
              async json() {
                return {};
              },
              async bytes() {
                return bytes;
              },
            };
          },
        );
        assert.equal(batch.messages.length, 1);
        const opened = await receiveIncoming(
          db,
          fixedClock(new Date('2026-10-08T09:00:00.000Z')),
          {
            sorter,
            matchesEmergency: async () => false,
            objects: createMemoryStore(),
            scanner: {
              async scan() {
                return 'clean' as const;
              },
            },
          },
          batch.messages[0]!,
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        const messages = await listMessagesOnCall(db, opened.callId);
        assert.equal(messages[0]?.body, 'הנזילה');
        assert.equal(messages[0]?.attachments[0]?.fileName, 'image.jpg');
        assert.equal(messages[0]?.attachments[0]?.byteSize, bytes.length);
        assert.equal(messages[0]?.attachments[0]?.openable, true);
        assert.equal(fetched.length, 2);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not download a media address Meta did not host', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const fetched: string[] = [];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(new Date('2026-10-08T09:00:00.000Z')),
      sorter,
      whatsappFetch: async (url) => {
        fetched.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              url: 'https://evil.example/file',
              mime_type: 'image/jpeg',
            };
          },
          async bytes() {
            return Buffer.from('nope');
          },
        };
      },
    });
    await cleanup(pool);
    try {
      await withEnv(async () => {
        const body = JSON.stringify(MEDIA);
        const posted = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(body),
          },
          payload: body,
        });
        assert.equal(posted.statusCode, 503);
        assert.equal(fetched.length, 1);
        const stored = await pool.query(
          `SELECT message_id FROM message WHERE external_message_id = $1`,
          ['wamid.t193.media'],
        );
        assert.equal(stored.rowCount, 0);
      });
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('acknowledges history and delivery receipts and stores neither', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(new Date('2026-10-08T09:00:00.000Z')),
      sorter,
    });
    await cleanup(pool);
    try {
      await withEnv(async () => {
        for (const payload of [HISTORY, STATUSES]) {
          const body = JSON.stringify(payload);
          const posted = await app.inject({
            method: 'POST',
            url: '/webhooks/whatsapp',
            headers: {
              'content-type': 'application/json',
              'x-hub-signature-256': sign(body),
            },
            payload: body,
          });
          assert.equal(posted.statusCode, 200);
        }
        const ignored = JSON.stringify(
          envelope(
            'messages',
            {
              messages: [
                {
                  from: THREAD,
                  id: 'wamid.t193.other',
                  timestamp: '1759752900',
                  type: 'text',
                  text: { body: 'מספר אחר' },
                },
              ],
            },
            '999',
          ),
        );
        const skipped = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(ignored),
          },
          payload: ignored,
        });
        assert.equal(skipped.statusCode, 200);
        const stored = await pool.query(
          `SELECT body_original FROM message
            WHERE body_original IN ('היסטוריה ישנה שלא תיכנס', 'מספר אחר')`,
        );
        assert.equal(stored.rowCount, 0);
      });
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('warns after seven days without an echo, and an echo clears it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2026-10-01T00:00:00.000Z'));
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      sorter,
    });
    await cleanup(pool);
    try {
      await withEnv(async () => {
        await watchWhatsapp(pool, clock);
        assert.equal(await whatsappWarning(pool, clock), false);
        clock.advance(SEVEN - 1);
        const who = await signIn(pool, clock, {
          email: 'ops@whatsapp.test',
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const quiet = await client.inject({ method: 'GET', url: '/calls' });
        assert.equal(quiet.statusCode, 200);
        assert.equal(quiet.body.includes(WARNING), false);
        clock.advance(1);
        assert.equal(await whatsappWarning(pool, clock), true);
        const warned = await client.inject({ method: 'GET', url: '/calls' });
        assert.equal(warned.body.includes(WARNING), true);

        const revoke = JSON.stringify(REVOKE);
        const ignored = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(revoke),
          },
          payload: revoke,
        });
        assert.equal(ignored.statusCode, 200);
        assert.equal(await whatsappWarning(pool, clock), true);
        const echo = JSON.stringify(ECHO);
        const posted = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(echo),
          },
          payload: echo,
        });
        assert.equal(posted.statusCode, 200);
        assert.equal(await whatsappWarning(pool, clock), false);
        const cleared = await client.inject({ method: 'GET', url: '/calls' });
        assert.equal(cleared.body.includes(WARNING), false);
        clock.advance(SEVEN);
        assert.equal(await whatsappWarning(pool, clock), true);
      });
      const later = await signIn(pool, clock, {
        email: 'ops@whatsapp.test',
        role: 'OPERATOR',
      });
      const hidden = await asOperator(app, later).inject({
        method: 'GET',
        url: '/calls',
      });
      assert.equal(hidden.statusCode, 200);
      assert.equal(hidden.body.includes(WARNING), false);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('sends one session reply when a message is flagged, and shows it on the call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2026-10-08T09:00:00.000Z'));
    const thread = '972599001197';
    const sender = '+972599001197';
    const sentence =
      'קריאת חירום. להתקשר לכונן: 050-194-0000. שעות כונן: א׳–ה׳ 08:00–20:00.';
    const posts: {
      url: string;
      init?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      };
    }[] = [];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      sorter,
      whatsappFetch: async (url, init) => {
        posts.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return { messages: [{ id: 'wamid.t194.reply' }] };
          },
          async bytes() {
            return Buffer.alloc(0);
          },
        };
      },
    });
    const before = await readEmergencySettings(pool);
    const who = await signIn(pool, clock, {
      email: 'reply@whatsapp.test',
      role: 'OPERATOR',
    });
    await saveEmergencySettings(pool, clock, {
      termsText: 'שריפה',
      phone: '050-194-0000',
      hours: 'א׳–ה׳ 08:00–20:00',
      actorId: who.staffAccountId,
    });
    try {
      await withEnv(async () => {
        const inbound = envelope('messages', {
          messages: [
            {
              from: thread,
              id: 'wamid.t194.in',
              timestamp: '1759752900',
              type: 'text',
              text: { body: 'יש שריפה בדירה' },
            },
          ],
        });
        const body = JSON.stringify(inbound);
        const posted = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(body),
          },
          payload: body,
        });
        assert.equal(posted.statusCode, 200);
        assert.equal(posts.length, 1);
        assert.equal(
          posts[0]?.url,
          `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
        );
        assert.equal(posts[0]?.init?.method, 'POST');
        assert.equal(posts[0]?.init?.headers?.Authorization, `Bearer ${TOKEN}`);
        assert.deepEqual(JSON.parse(posts[0]?.init?.body ?? '{}'), {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: thread,
          type: 'text',
          text: { preview_url: false, body: sentence },
        });

        const again = envelope('messages', {
          messages: [
            {
              from: thread,
              id: 'wamid.t194.in2',
              timestamp: '1759753000',
              type: 'text',
              text: { body: 'עדיין שריפה' },
            },
          ],
        });
        const second = JSON.stringify(again);
        const repeated = await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sign(second),
          },
          payload: second,
        });
        assert.equal(repeated.statusCode, 200);
        assert.equal(posts.length, 1);

        const { rows } = await pool.query<{ service_call_id: string }>(
          `SELECT service_call_id FROM service_call WHERE sender_label = $1`,
          [sender],
        );
        assert.equal(rows.length, 1);
        const callId = rows[0]?.service_call_id;
        assert.ok(callId);
        const messages = await listMessagesOnCall(pool, callId ?? '');
        const reply = messages.find((message) => message.echo);
        assert.equal(reply?.body, sentence);
        const page = await asOperator(app, who).inject({
          method: 'GET',
          url: `/calls/${callId}`,
        });
        assert.equal(page.statusCode, 200);
        assert.equal(page.body.includes(sentence), true);
        assert.equal(page.body.includes('data-echo="true"'), true);
      });
    } finally {
      await saveEmergencySettings(pool, clock, {
        termsText: before.termsText,
        phone: before.phone,
        hours: before.hours,
        actorId: who.staffAccountId,
      });
      await pool.query(
        `DELETE FROM message
          WHERE conversation_id IN (
            SELECT conversation_id FROM conversation
             WHERE source_channel = 'WHATSAPP' AND external_thread_id = $1
          )`,
        [thread],
      );
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE sender_label = $1
          )`,
        [sender],
      );
      await pool.query(
        `DELETE FROM audit_log
          WHERE subject_id IN (
            SELECT service_call_id::text FROM service_call WHERE sender_label = $1
          )
             OR actor_id = $2`,
        [sender, who.staffAccountId],
      );
      await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [
        sender,
      ]);
      await pool.query(
        `DELETE FROM conversation
          WHERE source_channel = 'WHATSAPP' AND external_thread_id = $1`,
        [thread],
      );
      await signOutAll(pool, 'whatsapp.test');
      await pool.end();
    }
  });
});
