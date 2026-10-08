// #188. The Outlook adapter, on recorded Graph payloads. No test calls Microsoft.
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  createGraphReader,
  type GraphFetch,
  graphMailboxFrom,
  mailboxWarning,
  normaliseOutlookMessage,
  OUTLOOK_POLL_MS,
  type OutlookReader,
  pollOutlook,
  secretWarning,
  sendOutlookReply,
} from './contract.ts';

const HOUR = 60 * 60 * 1000;
const MAILBOX_WARNING = 'תיבת הדואר לא נקראה כבר שעה.';
const SECRET_RENEW = 'יש לבקש סוד חדש';
const SECRET_UNKNOWN = 'תאריך התפוגה של הסוד לא הוגדר';

const MAILBOX = 'box@test';
const CURSOR =
  'https://graph.microsoft.com/v1.0/users/box@test/mailFolders/inbox/messages/delta?$deltatoken=now';
const AFTER =
  'https://graph.microsoft.com/v1.0/users/box@test/mailFolders/inbox/messages/delta?$deltatoken=next';

const OLD = {
  id: 'AAMkAG-old',
  conversationId: 'AAQkAG-old',
  subject: 'לפני',
  body: { contentType: 'text', content: 'זה הגיע לפני החיבור' },
  from: { emailAddress: { address: 'old@tenant.test' } },
  receivedDateTime: '2026-09-01T08:00:00Z',
  hasAttachments: false,
};

const FIRST = {
  id: 'AAMkAG-first',
  conversationId: 'AAQkAG-thread-1',
  subject: 'נזילה בכיור',
  body: { contentType: 'text', content: 'יש נזילה מתחת לכיור' },
  from: { emailAddress: { name: 'יעל', address: 'yael@tenant.test' } },
  receivedDateTime: '2026-10-06T09:15:00Z',
  hasAttachments: false,
};

const REPLY = {
  id: 'AAMkAG-reply',
  conversationId: 'AAQkAG-thread-1',
  subject: 'RE: נזילה בכיור',
  body: { contentType: 'html', content: '<p>עדיין נוזל</p>' },
  from: { emailAddress: { address: 'yael@tenant.test' } },
  receivedDateTime: '2026-10-06T10:00:00Z',
  hasAttachments: false,
};

const WITH_FILE = {
  id: 'AAMkAG-file',
  conversationId: 'AAQkAG-thread-2',
  subject: 'חשבון',
  body: { contentType: 'text', content: 'מצורף החשבון' },
  from: { emailAddress: { address: 'dana@tenant.test' } },
  receivedDateTime: '2026-10-06T11:00:00Z',
  hasAttachments: true,
};

const FILE = {
  '@odata.type': '#microsoft.graph.fileAttachment',
  id: 'att-1',
  name: 'cheshbon.pdf',
  contentType: 'application/pdf',
  size: 2048,
  isInline: false,
};

describe('channel · outlook', { concurrency: false }, () => {
  it('stays off unless the tenant, the app, its secret and the mailbox are all set', () => {
    const full = {
      GRAPH_TENANT_ID: 'tenant',
      GRAPH_CLIENT_ID: 'client',
      GRAPH_CLIENT_SECRET: 'secret',
      GRAPH_MAILBOX: 'box@test',
    };
    assert.deepEqual(graphMailboxFrom(full), {
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      mailbox: 'box@test',
      secretExpires: null,
    });
    assert.equal(graphMailboxFrom({}), null);
    assert.equal(graphMailboxFrom({ ...full, GRAPH_CLIENT_SECRET: ' ' }), null);
    assert.ok(OUTLOOK_POLL_MS >= 60_000);
    assert.ok(OUTLOOK_POLL_MS <= 120_000);
  });

  it('normalises a recorded message into an incoming email', () => {
    const message = normaliseOutlookMessage(FIRST, []);
    assert.ok(message);
    assert.equal(message.sourceChannel, 'EMAIL');
    assert.equal(message.externalMessageId, 'AAMkAG-first');
    assert.equal(message.externalThreadId, 'AAQkAG-thread-1');
    assert.equal(message.senderAddress, 'yael@tenant.test');
    assert.equal(message.receivedAt.toISOString(), '2026-10-06T09:15:00.000Z');
    assert.equal(message.subject, 'נזילה בכיור');
    assert.equal(message.body, 'יש נזילה מתחת לכיור');
    assert.equal(message.echo, false);
    assert.deepEqual(message.attachments ?? [], []);
  });

  it('normalises a reply on the same conversation as the same thread', () => {
    const first = normaliseOutlookMessage(FIRST, []);
    const reply = normaliseOutlookMessage(REPLY, []);
    assert.ok(first);
    assert.ok(reply);
    assert.equal(reply.externalThreadId, first.externalThreadId);
    assert.notEqual(reply.externalMessageId, first.externalMessageId);
    assert.equal(reply.externalMessageId, 'AAMkAG-reply');
    assert.equal(reply.body, 'עדיין נוזל');
    assert.equal(reply.subject, 'RE: נזילה בכיור');
  });

  it('normalises an email with an attachment', () => {
    const message = normaliseOutlookMessage(WITH_FILE, [FILE]);
    assert.ok(message);
    assert.equal(message.body, 'מצורף החשבון');
    assert.equal(message.senderAddress, 'dana@tenant.test');
    assert.deepEqual(message.attachments, [
      {
        fileName: 'cheshbon.pdf',
        contentType: 'application/pdf',
        byteSize: 2048,
      },
    ]);
  });

  it('keeps an attachment’s bytes and skips an image embedded in the message', () => {
    const pdf = Buffer.from('%PDF-1.4\n');
    const message = normaliseOutlookMessage(WITH_FILE, [
      { ...FILE, contentBytes: pdf.toString('base64') },
      {
        ...FILE,
        id: 'att-logo',
        name: 'logo.png',
        isInline: true,
        contentBytes: pdf.toString('base64'),
      },
    ]);
    assert.ok(message);
    assert.equal(message.attachments?.length, 1);
    assert.equal(message.attachments?.[0]?.fileName, 'cheshbon.pdf');
    assert.equal(message.attachments?.[0]?.byteSize, pdf.length);
    assert.equal(message.attachments?.[0]?.bytes?.equals(pdf), true);
  });

  it('keeps an email that is only an attachment', () => {
    const message = normaliseOutlookMessage(
      {
        ...WITH_FILE,
        subject: '   ',
        body: { contentType: 'text', content: '  ' },
      },
      [FILE],
    );
    assert.ok(message);
    assert.equal(message.subject, null);
    assert.equal(message.body, 'cheshbon.pdf');
  });

  it('ignores a message Graph says was removed', () => {
    const removed = normaliseOutlookMessage(
      { id: 'AAMkAG-gone', '@removed': { reason: 'deleted' } },
      [],
    );
    assert.equal(removed, null);
  });

  it('keeps the delta cursor across a restart: nothing read twice, nothing skipped', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const handed: string[] = [];
        const deliver = async (message: { externalMessageId: string }) => {
          handed.push(message.externalMessageId);
        };
        const first = scriptedReader();
        await pollOutlook(db, clock, first, deliver);
        assert.deepEqual(handed, []);
        assert.deepEqual(first.asked, ['start']);

        await pollOutlook(db, clock, first, deliver);
        assert.deepEqual(handed, ['AAMkAG-first']);
        assert.deepEqual(first.asked, ['start', 'L1']);

        const resumed = scriptedReader({
          refuseStart: true,
          refuseLinks: ['L1'],
        });
        await pollOutlook(db, clock, resumed, deliver);
        assert.deepEqual(handed, ['AAMkAG-first', 'AAMkAG-reply']);
        assert.deepEqual(resumed.asked, ['L2']);
      });
    } finally {
      await pool.end();
    }
  });

  it('retries a page that failed and does not skip its message', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = scriptedReader();
        const handed: string[] = [];
        await pollOutlook(db, clock, reader, async () => {});
        let down = true;
        await assert.rejects(
          () =>
            pollOutlook(db, clock, reader, async (message) => {
              if (down) throw new Error('door down');
              handed.push(message.externalMessageId);
            }),
          /door down/,
        );
        assert.equal(handed.length, 0);
        down = false;
        await pollOutlook(db, clock, reader, async (message) => {
          handed.push(message.externalMessageId);
        });
        assert.deepEqual(handed, ['AAMkAG-first']);
        assert.deepEqual(reader.asked, ['start', 'L1', 'L1']);
      });
    } finally {
      await pool.end();
    }
  });

  it('reads from the cursor it starts at and imports nothing earlier', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const calls: { method: string; url: string }[] = [];
    const fetchImpl: GraphFetch = async (url, init) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({
          value: [OLD],
          '@odata.deltaLink': CURSOR,
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
    };
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = createGraphReader(graphConfig(), fetchImpl);
        const handed: string[] = [];
        await pollOutlook(db, clock, reader, async (message) => {
          handed.push(message.externalMessageId);
        });
        assert.deepEqual(handed, []);
        const mail = calls.filter(
          (call) => !call.url.startsWith('https://login.microsoftonline.com/'),
        );
        assert.equal(mail.length, 1);
        assert.equal(mail[0]?.method, 'GET');
        assert.match(mail[0]?.url ?? '', /\$deltatoken=latest/);
        assert.match(
          mail[0]?.url ?? '',
          /\/users\/box%40test\/mailFolders\/inbox\/messages\/delta/,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('reads the next page, including an attachment, and never writes to the mailbox', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const calls: { method: string; url: string; body: string | null }[] = [];
    const fetchImpl: GraphFetch = async (url, init) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ?? null,
      });
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({ value: [], '@odata.deltaLink': CURSOR });
      }
      if (url === CURSOR) {
        return jsonResponse({
          value: [
            WITH_FILE,
            { id: 'AAMkAG-gone', '@removed': { reason: 'deleted' } },
          ],
          '@odata.deltaLink': AFTER,
        });
      }
      if (url.includes('/attachments')) {
        return jsonResponse({ value: [FILE] });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
    };
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = createGraphReader(graphConfig(), fetchImpl);
        const handed: { id: string; file: string | undefined }[] = [];
        const deliver = async (message: {
          externalMessageId: string;
          attachments?: readonly { fileName: string }[];
        }) => {
          handed.push({
            id: message.externalMessageId,
            file: message.attachments?.[0]?.fileName,
          });
        };
        await pollOutlook(db, clock, reader, deliver);
        await pollOutlook(db, clock, reader, deliver);
        assert.deepEqual(handed, [{ id: 'AAMkAG-file', file: 'cheshbon.pdf' }]);
        const mail = calls.filter(
          (call) => !call.url.startsWith('https://login.microsoftonline.com/'),
        );
        assert.ok(mail.length >= 2);
        for (const call of mail) {
          assert.equal(call.method, 'GET');
          assert.equal(call.body, null);
          assert.doesNotMatch(call.url, /\/move/);
          assert.equal(call.url.includes('isRead'), false);
        }
        assert.ok(
          mail.some(
            (call) =>
              call.url.includes('/attachments') &&
              call.url.includes('contentBytes'),
          ),
        );
        assert.equal(
          calls.some(
            (call) => call.method === 'PATCH' || call.method === 'DELETE',
          ),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('stores the cursor Graph returns when it names the inbox by folder id', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const folderId = 'AQMkADNkNAAAgEMAAAA';
    const graphCursor =
      "https://graph.microsoft.com/v1.0/users/box@test/mailfolders('AQMkADNkNAAAgEMAAAA')/messages/delta?$deltatoken=GwcBoTmPuoGNlgXgF1nyUNMXY";
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({
          value: [OLD],
          '@odata.deltaLink': graphCursor,
        });
      }
      if (url.includes('/mailFolders/inbox')) {
        return jsonResponse({ id: folderId });
      }
      if (url === graphCursor) {
        return jsonResponse({
          value: [FIRST],
          '@odata.deltaLink': graphCursor,
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = createGraphReader(graphConfig(), fetchImpl);
        const handed: string[] = [];
        const deliver = async (message: { externalMessageId: string }) => {
          handed.push(message.externalMessageId);
        };
        await pollOutlook(db, clock, reader, deliver);
        assert.deepEqual(handed, []);
        await pollOutlook(db, clock, reader, deliver);
        assert.deepEqual(handed, ['AAMkAG-first']);
        assert.ok(calls.includes(graphCursor));
      });
    } finally {
      await pool.end();
    }
  });

  it('stores the cursor when Graph rewrites the mailbox to its id', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const userId = '48d31887-5fad-4d73-a9f5-3c356e68a038';
    const folderId = 'AQMkADNkNAAAgEMAAAA';
    const graphCursor = `https://graph.microsoft.com/v1.0/users/${userId}/mailFolders/${folderId}/messages/delta?$deltatoken=P4lmXpjPRrjB6haA`;
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({
          value: [],
          '@odata.deltaLink': graphCursor,
        });
      }
      if (url.includes('/mailFolders/inbox')) {
        return jsonResponse({ id: folderId });
      }
      if (url === graphCursor) {
        return jsonResponse({
          value: [FIRST],
          '@odata.deltaLink': graphCursor,
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = createGraphReader(graphConfig(), fetchImpl);
        const handed: string[] = [];
        const deliver = async (message: { externalMessageId: string }) => {
          handed.push(message.externalMessageId);
        };
        await pollOutlook(db, clock, reader, deliver);
        assert.deepEqual(handed, []);
        await pollOutlook(db, clock, reader, deliver);
        assert.deepEqual(handed, ['AAMkAG-first']);
        assert.ok(calls.includes(graphCursor));
        // Mail.Read scoped by Exchange cannot read the directory.
        assert.equal(
          calls.some((url) => /\/users\/[^/?]+\?/.test(url)),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('does not follow a cursor that is not the inbox delta', async () => {
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({
          value: [],
          '@odata.deltaLink': 'https://evil.example/messages',
        });
      }
      if (url.includes('/mailFolders/inbox')) {
        return jsonResponse({ id: 'AQMkADNkNAAAgEMAAAA' });
      }
      throw new Error(`fetched ${url}`);
    };
    const reader = createGraphReader(graphConfig(), fetchImpl);
    await assert.rejects(() => reader.start(), /inbox delta/);
    const otherFolder =
      'https://graph.microsoft.com/v1.0/users/box@test/mailFolders/AAMkOTHER/messages/delta?$deltatoken=no';
    const otherMailbox =
      'https://graph.microsoft.com/v1.0/users/someone-else@test/mailFolders/inbox/messages/delta?$deltatoken=no';
    await assert.rejects(
      () => reader.page('https://evil.example/messages'),
      /inbox delta/,
    );
    await assert.rejects(() => reader.page(otherFolder), /inbox delta/);
    await assert.rejects(() => reader.page(otherMailbox), /inbox delta/);
    assert.equal(calls.includes(otherFolder), false);
    assert.equal(calls.includes(otherMailbox), false);
    assert.equal(
      calls.some((url) => url.includes('evil.example')),
      false,
    );
  });

  it('warns after an hour without a successful read, and a success clears it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const down: OutlookReader = {
          async start() {
            throw new Error('graph down');
          },
          async page() {
            throw new Error('graph down');
          },
        };
        await assert.rejects(
          () => pollOutlook(db, clock, down, async () => {}),
          /graph down/,
        );
        assert.equal(await mailboxWarning(db, clock), false);
        clock.advance(HOUR - 60_000);
        assert.equal(await mailboxWarning(db, clock), false);
        clock.advance(60_000);
        assert.equal(await mailboxWarning(db, clock), true);

        await pollOutlook(db, clock, scriptedReader(), async () => {});
        assert.equal(await mailboxWarning(db, clock), false);
        clock.advance(HOUR);
        assert.equal(await mailboxWarning(db, clock), true);
      });
    } finally {
      await pool.end();
    }
  });

  it('reads a partial delta row in full and does not let a thin one block the page', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url, init) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.includes('$deltatoken=latest')) {
        return jsonResponse({ value: [], '@odata.deltaLink': CURSOR });
      }
      if (url === CURSOR) {
        return jsonResponse({
          value: [{ id: 'AAMkAG-first' }, { id: 'AAMkAG-thin' }, REPLY],
          '@odata.deltaLink': AFTER,
        });
      }
      if (url.includes('/messages/AAMkAG-first')) return jsonResponse(FIRST);
      if (url.includes('/messages/AAMkAG-thin')) {
        return jsonResponse({ id: 'AAMkAG-thin' });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
    };
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
        const reader = createGraphReader(graphConfig(), fetchImpl);
        const handed: string[] = [];
        await pollOutlook(db, clock, reader, async (message) => {
          handed.push(message.externalMessageId);
        });
        await pollOutlook(db, clock, reader, async (message) => {
          handed.push(message.externalMessageId);
        });
        assert.deepEqual(handed, ['AAMkAG-first', 'AAMkAG-reply']);
        assert.ok(calls.some((url) => url.includes('/messages/AAMkAG-first')));
      });
    } finally {
      await pool.end();
    }
  });

  it('reads the secret expiry date with the mailbox, and only a real date', () => {
    const env = {
      GRAPH_TENANT_ID: 'tenant',
      GRAPH_CLIENT_ID: 'client',
      GRAPH_CLIENT_SECRET: 'secret',
      GRAPH_MAILBOX: 'box@test',
    };
    assert.equal(graphMailboxFrom(env)?.secretExpires, null);
    assert.equal(
      graphMailboxFrom({ ...env, GRAPH_SECRET_EXPIRES: ' 2028-10-07 ' })
        ?.secretExpires,
      '2028-10-07',
    );
    for (const bad of [
      '2028-02-30',
      '07.10.2028',
      '2028-10-07T00:00',
      'soon',
    ]) {
      assert.equal(
        graphMailboxFrom({ ...env, GRAPH_SECRET_EXPIRES: bad })?.secretExpires,
        null,
        bad,
      );
    }
    assert.equal(
      graphMailboxFrom({ GRAPH_SECRET_EXPIRES: '2028-10-07' }),
      null,
    );
  });

  it('warns from 30 days before the secret expires, and when the date is unknown', () => {
    const config = { ...graphConfig(), secretExpires: '2028-10-07' };
    // Office days, not UTC days: Israel is UTC+3 in September.
    const at = (iso: string) => fixedClock(new Date(iso));
    assert.equal(secretWarning(config, at('2028-09-06T20:59:59.000Z')), null);
    assert.deepEqual(secretWarning(config, at('2028-09-06T21:00:00.000Z')), {
      kind: 'renew',
      expires: '2028-10-07',
    });
    assert.deepEqual(secretWarning(config, at('2028-11-01T00:00:00.000Z')), {
      kind: 'renew',
      expires: '2028-10-07',
    });
    assert.deepEqual(
      secretWarning(
        { ...config, secretExpires: null },
        at('2026-10-07T00:00:00.000Z'),
      ),
      { kind: 'unknown' },
    );
  });

  it('shows the secret warning on the קריאות tab only when a mailbox is configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2028-09-27T09:00:00.000Z'));
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const keys = [
      'GRAPH_TENANT_ID',
      'GRAPH_CLIENT_ID',
      'GRAPH_CLIENT_SECRET',
      'GRAPH_MAILBOX',
      'GRAPH_SECRET_EXPIRES',
    ] as const;
    const savedEnv = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    const domain = 'outlook-secret.test';
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    try {
      for (const key of keys) delete process.env[key];
      const off = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(off.statusCode, 200);
      assert.equal(off.body.includes(SECRET_RENEW), false);
      assert.equal(off.body.includes(SECRET_UNKNOWN), false);

      process.env.GRAPH_TENANT_ID = 'tenant';
      process.env.GRAPH_CLIENT_ID = 'client';
      process.env.GRAPH_CLIENT_SECRET = 'secret';
      process.env.GRAPH_MAILBOX = 'box@test';
      const unknown = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(unknown.body.includes(SECRET_UNKNOWN), true);

      process.env.GRAPH_SECRET_EXPIRES = '2028-10-07';
      const renew = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(renew.body.includes(SECRET_RENEW), true);
      assert.equal(renew.body.includes('07.10.2028'), true);

      process.env.GRAPH_SECRET_EXPIRES = '2028-09-20';
      const expired = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(expired.body.includes('פג ב-20.09.2028'), true);

      process.env.GRAPH_SECRET_EXPIRES = '2029-10-07';
      const fine = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(fine.body.includes(SECRET_RENEW), false);
      assert.equal(fine.body.includes(SECRET_UNKNOWN), false);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await signOutAll(pool, domain);
      await pool.end();
    }
  });

  it('shows the mailbox warning on the קריאות tab, and a successful read clears it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const savedEnv = {
      GRAPH_TENANT_ID: process.env.GRAPH_TENANT_ID,
      GRAPH_CLIENT_ID: process.env.GRAPH_CLIENT_ID,
      GRAPH_CLIENT_SECRET: process.env.GRAPH_CLIENT_SECRET,
      GRAPH_MAILBOX: process.env.GRAPH_MAILBOX,
    };
    const domain = 'outlook-warning.test';
    await pool.query(`DELETE FROM email_cursor WHERE cursor_id = 'outlook'`);
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const down: OutlookReader = {
      async start() {
        throw new Error('graph down');
      },
      async page() {
        throw new Error('graph down');
      },
    };
    try {
      const before = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(before.statusCode, 200);
      assert.equal(before.body.includes(MAILBOX_WARNING), false);

      await assert.rejects(() =>
        pollOutlook(pool, clock, down, async () => {}),
      );
      clock.advance(HOUR);
      const quiet = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(quiet.body.includes(MAILBOX_WARNING), false);
      process.env.GRAPH_TENANT_ID = 'tenant';
      process.env.GRAPH_CLIENT_ID = 'client';
      process.env.GRAPH_CLIENT_SECRET = 'secret';
      process.env.GRAPH_MAILBOX = 'box@test';
      const warned = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(warned.statusCode, 200);
      assert.equal(warned.body.includes(MAILBOX_WARNING), true);

      await pollOutlook(pool, clock, scriptedReader(), async () => {});
      const cleared = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(cleared.statusCode, 200);
      assert.equal(cleared.body.includes(MAILBOX_WARNING), false);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await pool.query(`DELETE FROM email_cursor WHERE cursor_id = 'outlook'`);
      await signOutAll(pool, domain);
      await pool.end();
    }
  });
});

describe('outlook · the duty reply', () => {
  it('replies once on the configured mailbox thread', async () => {
    const calls: {
      url: string;
      method: string;
      body: string | null;
      authorization: string | null;
    }[] = [];
    const fetchImpl: GraphFetch = async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ?? null,
        authorization: init?.headers?.authorization ?? null,
      });
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok' });
      }
      return {
        ok: true,
        status: 202,
        async json() {
          return {};
        },
      };
    };
    const sent = await sendOutlookReply(
      graphConfig(),
      {
        messageId: 'AAMkAG-first',
        body: 'קריאת חירום. להתקשר לכונן: 050-195-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
      },
      fetchImpl,
    );
    const mail = calls.filter((call) =>
      call.url.startsWith('https://graph.microsoft.com/'),
    );
    assert.equal(mail.length, 1);
    assert.equal(
      mail[0]?.url,
      'https://graph.microsoft.com/v1.0/users/box%40test/messages/AAMkAG-first/reply',
    );
    assert.equal(mail[0]?.method, 'POST');
    assert.equal(mail[0]?.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(mail[0]?.body ?? ''), {
      comment:
        'קריאת חירום. להתקשר לכונן: 050-195-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
    });
    assert.equal(sent.externalMessageId, 'reply:AAMkAG-first');
  });

  it('sends nothing when Graph refuses, and nothing else in the process can send mail', async () => {
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok' });
      }
      return {
        ok: false,
        status: 403,
        async json() {
          return {};
        },
      };
    };
    await assert.rejects(
      () =>
        sendOutlookReply(
          graphConfig(),
          { messageId: 'AAMkAG-first', body: 'קריאת חירום.' },
          fetchImpl,
        ),
      /outlook reply was not sent/,
    );
    await assert.rejects(
      () =>
        sendOutlookReply(
          graphConfig(),
          { messageId: 'AAMkAG-first', body: '  ' },
          fetchImpl,
        ),
      /outlook reply was not sent/,
    );
    assert.equal(
      calls.filter((url) => url.startsWith('https://graph.microsoft.com/'))
        .length,
      1,
    );

    const root = path.dirname(fileURLToPath(import.meta.url));
    const src = path.dirname(root);
    const replyFiles: string[] = [];
    const sendMailFiles: string[] = [];
    const callers: string[] = [];
    for await (const entry of glob('**/*.ts', { cwd: src })) {
      if (entry.endsWith('.test.ts')) continue;
      const source = await readFile(path.join(src, entry), 'utf8');
      if (source.includes('/reply')) replyFiles.push(entry);
      if (source.includes('sendMail')) sendMailFiles.push(entry);
      if (source.includes('sendOutlookReply')) callers.push(entry);
    }
    assert.deepEqual(replyFiles, ['channel/internal/outlook.ts']);
    assert.deepEqual(sendMailFiles, []);
    assert.deepEqual(callers.sort(), [
      'channel/contract.ts',
      'channel/internal/outlook.ts',
      'serve.ts',
    ]);
  });

  it('keeps a slashed message id inside this mailbox', async () => {
    const calls: string[] = [];
    const fetchImpl: GraphFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        return jsonResponse({ access_token: 'tok' });
      }
      return {
        ok: true,
        status: 202,
        async json() {
          return {};
        },
      };
    };
    await sendOutlookReply(
      graphConfig(),
      { messageId: 'AAMkAG+195/abc=', body: 'קריאת חירום.' },
      fetchImpl,
    );
    const mail = calls.find((url) =>
      url.startsWith('https://graph.microsoft.com/'),
    );
    assert.equal(
      mail,
      'https://graph.microsoft.com/v1.0/users/box%40test/messages/AAMkAG%2B195%2Fabc%3D/reply',
    );
  });
});

function graphConfig() {
  return {
    tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    mailbox: MAILBOX,
    secretExpires: null,
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

function scriptedReader(options?: {
  refuseStart?: boolean;
  refuseLinks?: readonly string[];
}): OutlookReader & { asked: string[] } {
  const asked: string[] = [];
  const refuse = new Set(options?.refuseLinks ?? []);
  return {
    asked,
    async start() {
      asked.push('start');
      if (options?.refuseStart) throw new Error('restarted from the beginning');
      return { link: 'L1' };
    },
    async page(link) {
      asked.push(link);
      if (refuse.has(link)) throw new Error(`replayed ${link}`);
      if (link === 'L1') {
        return {
          items: [{ message: FIRST, attachments: [] }],
          link: 'L2',
          roundComplete: true,
        };
      }
      if (link === 'L2') {
        return {
          items: [{ message: REPLY, attachments: [] }],
          link: 'L3',
          roundComplete: true,
        };
      }
      throw new Error(`unexpected link ${link}`);
    },
  };
}
