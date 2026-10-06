// #186. Rescue, return, and the dev-only door, the way the office clicks them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import {
  type IncomingMessage,
  receiveIncoming,
  type SortVerdict,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');

const CALL: SortVerdict = {
  label: 'call',
  categoryCode: 'PLUMBING',
  summary: 'נזילה בצינור',
};

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function incoming(
  domain: string,
  over: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    receivedAt: AT,
    subject: null,
    body: 'יש נזילה במטבח',
    senderAddress: `tenant@${domain}`,
    ...over,
    externalMessageId: `${domain}-${over.externalMessageId ?? '1'}`,
    externalThreadId: `${domain}-${over.externalThreadId ?? 'thread'}`,
  };
}

async function cleanup(pool: Pool, domain: string): Promise<void> {
  const like = `%@${domain}`;
  await pool.query(
    `DELETE FROM message
      WHERE sender_address LIKE $1
         OR service_call_id IN (
           SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
         )`,
    [like],
  );
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
      )
         OR duplicate_of IN (
           SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
         )`,
    [like],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE subject_id IN (
        SELECT service_call_id::text FROM service_call WHERE sender_label LIKE $1
      )`,
    [like],
  );
  await pool.query(
    `DELETE FROM service_call
      WHERE sender_label LIKE $1
        AND (duplicate_of IS NOT NULL OR predecessor_id IS NOT NULL)`,
    [like],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label LIKE $1`, [
    like,
  ]);
  await pool.query(
    `DELETE FROM conversation
      WHERE external_thread_id LIKE $1
         OR external_thread_id LIKE 'door-routes-%'
         OR external_thread_id = 'door-dev-thread'`,
    [`${domain}-%`],
  );
  await signOutAll(pool, domain);
}

describe('channel · the filtered list and the dev door', () => {
  it('rescues a filtered message and returns a call without closing it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'door-rescue.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool, 'door-routes.test');
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    try {
      const noise = await receiveIncoming(
        pool,
        clock,
        {
          sorter: {
            async sort() {
              return { label: 'noise', categoryCode: null, summary: null };
            },
          },
          matchesEmergency: async () => false,
        },
        incoming(domain, {
          externalMessageId: 'noise',
          externalThreadId: 'noise',
          body: 'ניוזלטר של החנות',
        }),
      );
      assert.equal(noise.kind, 'filtered');

      const filtered = await client.inject({
        method: 'GET',
        url: '/calls/filtered',
      });
      assert.equal(filtered.statusCode, 200);
      assert.match(filtered.body, /ניוזלטר של החנות/);
      assert.match(filtered.body, /data-sorter="noise"/);
      assert.match(filtered.body, /הצלה/);

      const rescued = await client.inject({
        method: 'POST',
        url: '/calls/filtered',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          message_id: noise.kind === 'filtered' ? noise.messageId : '',
        }),
      });
      assert.equal(rescued.statusCode, 303);
      const callId = String(rescued.headers.location).replace('/calls/', '');
      const call = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(call.body, /ניוזלטר של החנות/);
      assert.match(call.body, /data-sorter="noise"/);
      assert.match(call.body, /data-kind="MESSAGE"/);

      const afterRescue = await client.inject({
        method: 'GET',
        url: '/calls/filtered',
      });
      assert.doesNotMatch(afterRescue.body, /ניוזלטר של החנות/);

      const returned = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/return`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(returned.statusCode, 303);
      assert.equal(returned.headers.location, '/calls/filtered');
      const aside = await client.inject({
        method: 'GET',
        url: '/calls/filtered',
      });
      assert.match(aside.body, /data-sorter="noise"/);
      assert.match(aside.body, /data-office="returned"/);
      const open = await client.inject({ method: 'GET', url: '/calls' });
      assert.doesNotMatch(open.body, /ניוזלטר של החנות/);
      const closed = await client.inject({
        method: 'GET',
        url: '/calls?state=CLOSED',
      });
      assert.doesNotMatch(closed.body, /ניוזלטר של החנות/);

      const restored = await client.inject({
        method: 'POST',
        url: '/calls/filtered',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ call_id: callId }),
      });
      assert.equal(restored.statusCode, 303);
      const back = await client.inject({ method: 'GET', url: '/calls' });
      assert.match(back.body, /ניוזלטר של החנות/);
    } finally {
      await cleanup(pool, domain);
      await pool.end();
    }
  });

  it('shows both messages on the call the duplicate repeats', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'door-dup.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const deps = {
      sorter: {
        async sort() {
          return CALL;
        },
      },
      matchesEmergency: async () => false,
    };
    try {
      const kept = await receiveIncoming(
        pool,
        clock,
        deps,
        incoming(domain, {
          externalMessageId: 'kept',
          externalThreadId: 'kept',
          body: 'הקריאה שנשארת',
          subject: 'נשארת',
        }),
      );
      const copy = await receiveIncoming(
        pool,
        clock,
        deps,
        incoming(domain, {
          externalMessageId: 'copy',
          externalThreadId: 'copy',
          body: 'הקריאה הכפולה',
          subject: 'כפולה',
          receivedAt: new Date(AT.getTime() + 60_000),
        }),
      );
      assert.equal(kept.kind, 'call');
      assert.equal(copy.kind, 'call');
      if (kept.kind !== 'call' || copy.kind !== 'call') return;
      const closed = await client.inject({
        method: 'POST',
        url: `/calls/${copy.callId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'DUPLICATE', duplicate_of: kept.callId }),
      });
      assert.equal(closed.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/calls/${kept.callId}`,
      });
      assert.match(page.body, /הקריאה שנשארת/);
      assert.match(page.body, /הקריאה הכפולה/);
    } finally {
      await cleanup(pool, domain);
      await pool.end();
    }
  });

  it('pushes a fabricated message through the dev door, and nowhere else', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'door-dev.test';
    const clock = fixedClock(AT);
    const hidden = buildApp({ pool, version: '9.9.9-test', clock });
    const shown = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      devMockups: true,
    });
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    try {
      const missing = await asOperator(hidden, who).inject({
        method: 'POST',
        url: '/dev/intake',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'EMAIL',
          sender: `tenant@${domain}`,
          body: 'x',
          verdict: 'call',
        }),
      });
      assert.equal(missing.statusCode, 404);

      const client = asOperator(shown, who);
      const page = await client.inject({ method: 'GET', url: '/dev/intake' });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /הודעת בדיקה/);
      const sent = await client.inject({
        method: 'POST',
        url: '/dev/intake',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WHATSAPP',
          sender: `tenant@${domain}`,
          thread: 'door-dev.test-form',
          subject: 'ברז',
          body: 'הברז במטבח נוטף',
          verdict: 'unsure',
          category: 'PLUMBING',
          summary: 'ברז נוטף',
          file: 'tap.jpg',
        }),
      });
      assert.equal(sent.statusCode, 303);
      const location = String(sent.headers.location);
      assert.match(location, /^\/calls\/[0-9a-f-]{36}$/);
      const call = await client.inject({ method: 'GET', url: location });
      assert.match(call.body, /ברז נוטף/);
      assert.match(call.body, /data-review="true"/);
      assert.match(call.body, /data-proposal="PLUMBING"/);
      assert.match(call.body, /הברז במטבח נוטף/);
      assert.match(call.body, /tap\.jpg/);
      assert.match(call.body, /וואטסאפ/);
      const list = await client.inject({
        method: 'GET',
        url: '/calls?review=1',
      });
      assert.match(list.body, /ברז נוטף/);
    } finally {
      await cleanup(pool, domain);
      await pool.end();
    }
  });
});
