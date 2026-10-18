// #256. The send control on an EMAIL call, and the timeline row it leaves.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { identifyCall } from '../calls/contract.ts';
import { receiveIncoming } from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';
import { appendCallDraft, beginCallThread } from '../staff/contract.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');
const DRAFT = 'שלום נועה,\n\nהנזילה בטיפול.';
const EDITED = 'שלום נועה,\n\nנבדוק מחר.';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('calls · send the reply', () => {
  it('sends the draft as written or edited, and a viewer only copies', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-reply.test';
    const clock = fixedClock(AT);
    const sent: { messageId: string; body: string }[] = [];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      graphReply: async (reply) => {
        sent.push(reply);
        return { externalMessageId: `reply:${reply.messageId}` };
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
      familyName: 'שליחה',
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
          sourceChannel: 'EMAIL',
          externalMessageId: 'msg-256-page',
          externalThreadId: 'thread-256-page',
          senderAddress: 'tenant@calls-reply.test',
          receivedAt: AT,
          subject: 'נזילה',
          body: 'יש נזילה במטבח',
        },
      );
      assert.equal(outcome.kind, 'call');
      if (outcome.kind !== 'call') return;
      callId = outcome.callId;
      await identifyCall(pool, clock, {
        callId,
        partyId: party.id,
        actorId: who.staffAccountId,
        actorRole: 'OPERATOR',
      });
      await beginCallThread(pool, clock, {
        callId,
        status: 'writing',
        skipReason: null,
      });
      await appendCallDraft(pool, clock, {
        callId,
        asker: 'copilot',
        question: 'נזילה',
        answer: DRAFT,
        rendering: null,
        refused: false,
        citations: [],
        hitIds: [],
      });

      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /data-send>שליחה/);
      assert.match(page.body, /data-copy>העתקה/);

      const copied = await looking.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(copied.statusCode, 200);
      assert.match(copied.body, /data-copy>העתקה/);
      assert.doesNotMatch(copied.body, /data-send/);
      const refused = await looking.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: DRAFT, to: 'stranger@evil.test' }),
      });
      assert.equal(refused.statusCode, 403);
      assert.equal(sent.length, 0);

      const posted = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: DRAFT, to: 'stranger@evil.test' }),
      });
      assert.equal(posted.statusCode, 303);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.messageId, 'msg-256-page');
      assert.equal(sent[0]?.body, DRAFT);

      const edited = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/send`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ body: EDITED }),
      });
      assert.equal(edited.statusCode, 303);
      assert.equal(sent.length, 2);
      assert.equal(sent[1]?.body, EDITED);
      assert.equal(sent[1]?.messageId, 'msg-256-page');

      const after = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(after.body, /data-reply="as_written"/);
      assert.match(after.body, /data-reply="edited"/);
      assert.match(after.body, /הנזילה בטיפול/);
      assert.match(after.body, /נבדוק מחר/);
      assert.match(after.body, new RegExp(who.email));

      const { rows } = await pool.query<{
        actor_id: string;
        inputs: { mark: string; text: string };
      }>(
        `SELECT actor_id, inputs
           FROM audit_log
          WHERE action = 'calls.reply' AND subject_id = $1`,
        [callId],
      );
      assert.equal(rows.length, 2);
      const asWritten = rows.find((row) => row.inputs.mark === 'as_written');
      const editedRow = rows.find((row) => row.inputs.mark === 'edited');
      assert.equal(asWritten?.actor_id, who.staffAccountId);
      assert.equal(asWritten?.inputs.text, DRAFT);
      assert.equal(editedRow?.actor_id, who.staffAccountId);
      assert.equal(editedRow?.inputs.text, EDITED);
      assert.equal(JSON.stringify(rows).includes('stranger@evil.test'), false);
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
          `DELETE FROM conversation WHERE external_thread_id = 'thread-256-page'`,
        );
      }
      await pool.query(`DELETE FROM party WHERE party_id = $1`, [party.id]);
      await signOutAll(pool, domain);
      await pool.end();
    }
  });
});
