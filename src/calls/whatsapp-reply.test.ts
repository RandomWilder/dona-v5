// #257. WhatsApp copy and send. No brief, no draft. Send inside the window,
// copy only on the minute it closes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { receiveIncoming } from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';
import {
  csrfTokenFor,
  mintSession,
  SESSION_COOKIE,
} from '../staff/contract.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const TEXT = 'נבדוק את הנזילה מחר.';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('calls · WhatsApp copy and send', () => {
  it('sends staff-written text inside the window and copies only when it closes', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-wa-reply.test';
    const clock = fixedClock(AT);
    const sent: { to: string; body: string }[] = [];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      extractor: createFakeExtractor(() => {
        throw new Error('the model was called');
      }),
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      briefSchedule: () => {
        throw new Error('a brief was scheduled');
      },
      whatsappReply: async (reply) => {
        sent.push(reply);
        return { externalMessageId: `reply:${reply.to}` };
      },
    });
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const viewer = await signIn(pool, clock, {
      email: `view@${domain}`,
      role: 'VIEWER',
    });
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'נועה',
      familyName: 'וואטסאפ',
      preferredLanguage: 'he',
    });
    const client = asOperator(app, who);
    const looking = asOperator(app, viewer);
    let callId = '';
    try {
      const outcome = await receiveIncoming(
        pool,
        clock,
        {
          sorter: {
            async sort() {
              return { label: 'call', categoryCode: null, summary: 'נזילה' };
            },
            async translate() {
              return { bodyHe: null };
            },
          },
          matchesEmergency: async () => false,
        },
        {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-257-page',
          externalThreadId: '972501257010',
          senderAddress: '+972501257010',
          receivedAt: AT,
          subject: null,
          body: 'יש נזילה במטבח',
        },
      );
      assert.equal(outcome.kind, 'call');
      if (outcome.kind !== 'call') return;
      callId = outcome.callId;
      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);

      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(page.body, /data-brief/);
      assert.doesNotMatch(page.body, /כתבו טיוטה/);
      assert.match(page.body, /data-whatsapp="open"/);
      assert.match(page.body, /data-copy>העתקה/);
      assert.match(page.body, /data-send>שליחה/);
      assert.match(
        page.body,
        /<textarea name="body" data-draft rows="4"><\/textarea>/,
      );

      const copied = await looking.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(copied.body, /data-whatsapp="open"/);
      assert.match(copied.body, /data-copy>העתקה/);
      assert.doesNotMatch(copied.body, /data-send/);
      const refused = await looking.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: TEXT, to: '972500000000' }),
      });
      assert.equal(refused.statusCode, 403);
      assert.equal(sent.length, 0);

      const posted = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: TEXT, to: '972500000000' }),
      });
      assert.equal(posted.statusCode, 303);
      assert.deepEqual(sent, [{ to: '972501257010', body: TEXT }]);

      const after = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(after.body, /data-reply="as_written"/);
      assert.match(after.body, /נבדוק את הנזילה מחר/);

      clock.advance(DAY);
      const fresh = await mintSession(pool, clock, who.staffAccountId);
      const later = asOperator(app, {
        ...who,
        cookie: `${SESSION_COOKIE}=${fresh.token}`,
        csrf: csrfTokenFor(fresh.token),
        token: fresh.token,
      });
      const closed = await later.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(closed.statusCode, 200);
      assert.match(closed.body, /data-whatsapp="closed"/);
      assert.match(closed.body, /חלון 24 השעות נסגר/);
      assert.match(closed.body, /data-copy>העתקה/);
      assert.doesNotMatch(closed.body, /data-send/);
      const blocked = await later.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: TEXT, to: '972500000000' }),
      });
      assert.equal(blocked.statusCode, 400);
      assert.match(blocked.body, /חלון 24 השעות נסגר/);
      assert.equal(sent.length, 1);
    } finally {
      if (callId !== '') {
        await pool.query(
          `DELETE FROM audit_log WHERE subject_id = $1 OR actor_id = $2`,
          [callId, who.staffAccountId],
        );
        await pool.query(
          `DELETE FROM service_call_transition WHERE service_call_id = $1`,
          [callId],
        );
        await pool.query(`DELETE FROM message WHERE service_call_id = $1`, [
          callId,
        ]);
        await pool.query(
          `DELETE FROM service_call WHERE service_call_id = $1`,
          [callId],
        );
        await pool.query(
          `DELETE FROM conversation WHERE external_thread_id = '972501257010'`,
        );
      }
      await pool.query(`DELETE FROM party WHERE party_id = $1`, [party.id]);
      await signOutAll(pool, domain);
      await pool.end();
    }
  });
});
