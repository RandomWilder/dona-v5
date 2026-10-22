// #288. The reply target, the share over a chosen period, and the line tenants
// see only once an administrator switches it on. A person's reply counts. The
// fixed emergency reply does not, and a call sent back to filtered is not in
// the share.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import {
  asOperator,
  asTenant,
  signIn,
  signOutAll,
} from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { identifyCall } from '../calls/contract.ts';
import {
  createRecordingCodeSender,
  receiveIncoming,
} from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';

const OPEN = new Date('2040-03-07T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = 'from=2040-03-07&to=2040-03-07';

function form(fields: Record<string, string>): {
  headers: { 'content-type': string };
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  };
}

function inputTag(html: string, name: string): string {
  return (
    html.match(new RegExp(`<input\\b(?=[^>]*name="${name}")[^>]*>`))?.[0] ?? ''
  );
}

function fieldValue(html: string, name: string): string | undefined {
  return inputTag(html, name).match(/value="([^"]*)"/)?.[1];
}

function boxChecked(html: string, name: string): boolean {
  return /\bchecked\b/.test(inputTag(html, name));
}

async function shownAudits(pool: Pool, actorId: string): Promise<boolean[]> {
  const { rows } = await pool.query<{ inputs: { shown?: boolean } }>(
    `SELECT inputs FROM audit_log
      WHERE action = 'calls.reply_target' AND actor_id = $1
      ORDER BY at, id`,
    [actorId],
  );
  return rows.map((row) => row.inputs.shown === true);
}

describe('calls · the reply target', () => {
  it('counts a person within the target, and not the duty reply or a returned call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'reply-target.test';
    const clock = fixedClock(OPEN);
    const sent: string[] = [];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      graphReply: async () => {
        sent.push('sent');
        return { externalMessageId: `reply-${sent.length}` };
      },
    });
    const lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock(288)');
    await signOutAll(pool, domain);
    const admin = await signIn(pool, clock, {
      email: `admin@${domain}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const asAdmin = asOperator(app, admin);
    let asOps = asOperator(app, operator);
    await pool.query(
      `DELETE FROM audit_log WHERE actor_id = $1 AND action = 'calls.reply_target'`,
      [admin.staffAccountId],
    );
    const db = pool;
    const party = await createParty(db, {
      kind: 'PERSON',
      givenName: 'נועה',
      familyName: 'יעד',
      preferredLanguage: 'he',
    });
    const threads: string[] = [];
    let restore: { days: string; shown: boolean } | undefined;
    try {
      const before = await asAdmin.inject({ method: 'GET', url: '/settings' });
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /action="\/settings\/answer-target"/);
      assert.match(before.body, /מענה של אדם/);
      restore = {
        days: fieldValue(before.body, 'days') ?? '2',
        shown: boxChecked(before.body, 'shown'),
      };

      const refused = await asOps.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '1', shown: 'true' }),
      });
      assert.equal(refused.statusCode, 403);
      const looking = await asOps.inject({
        method: 'GET',
        url: `/settings?${PERIOD}`,
      });
      assert.doesNotMatch(looking.body, /action="\/settings\/answer-target"/);
      assert.match(looking.body, /אין קריאות בתקופה/);

      const bad = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '999' }),
      });
      assert.equal(bad.statusCode, 400);

      const saved = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '1' }),
      });
      assert.equal(saved.statusCode, 303);
      clock.advance(1000);
      const on = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '1', shown: 'true' }),
      });
      assert.equal(on.statusCode, 303);
      clock.advance(1000);
      const off = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '1' }),
      });
      assert.equal(off.statusCode, 303);
      assert.deepEqual(await shownAudits(pool, admin.staffAccountId), [
        false,
        true,
        false,
      ]);

      const sorter = {
        async sort() {
          return {
            label: 'call' as const,
            categoryCode: null,
            summary: 'נזילה',
          };
        },
        async translate() {
          return { bodyHe: null };
        },
      };
      async function openEmail(
        id: string,
        emergency: boolean,
      ): Promise<string> {
        threads.push(id);
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter,
            matchesEmergency: async () => emergency,
            replyOnEmail: async () => ({ externalMessageId: `duty-${id}` }),
          },
          {
            sourceChannel: 'EMAIL',
            externalMessageId: id,
            externalThreadId: id,
            senderAddress: `${id}@${domain}`,
            receivedAt: clock.now(),
            subject: 'נזילה',
            body: 'יש נזילה במטבח',
          },
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return '';
        return outcome.callId;
      }
      async function reply(callId: string): Promise<void> {
        await identifyCall(db, clock, {
          callId,
          partyId: party.id,
          actorId: operator.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const posted = await asOps.inject({
          method: 'POST',
          url: `/calls/${callId}/send`,
          ...form({ body: 'נבדוק מחר' }),
        });
        assert.equal(posted.statusCode, 303);
        assert.match(String(posted.headers.location), /^\/calls\//);
      }

      const sameDay = await openEmail('same-day', false);
      await reply(sameDay);
      const silent = await openEmail('silent', false);
      await identifyCall(db, clock, {
        callId: silent,
        partyId: party.id,
        actorId: operator.staffAccountId,
        actorRole: 'OPERATOR',
      });
      await openEmail('duty-only', true);
      const returned = await openEmail('returned', false);
      await reply(returned);
      const back = await asOps.inject({
        method: 'POST',
        url: `/calls/${returned}/return`,
        ...form({}),
      });
      assert.equal(back.statusCode, 303);
      const onTime = await openEmail('on-time', false);
      const late = await openEmail('late', false);

      clock.advance(DAY);
      const nextDay = await signIn(pool, clock, {
        email: `ops@${domain}`,
        role: 'OPERATOR',
      });
      asOps = asOperator(app, nextDay);
      await reply(onTime);
      clock.advance(3 * DAY);
      const later = await signIn(pool, clock, {
        email: `ops@${domain}`,
        role: 'OPERATOR',
      });
      asOps = asOperator(app, later);
      await reply(late);
      const outside = await openEmail('outside', false);
      await identifyCall(db, clock, {
        callId: outside,
        partyId: party.id,
        actorId: operator.staffAccountId,
        actorRole: 'OPERATOR',
      });

      const stillAdmin = await signIn(pool, clock, {
        email: `admin@${domain}`,
        role: 'ADMIN',
      });
      const share = await asOperator(app, stillAdmin).inject({
        method: 'GET',
        url: `/settings?${PERIOD}`,
      });
      assert.equal(share.statusCode, 200);
      assert.match(
        share.body,
        /2<\/span> מתוך <span dir="ltr">5<\/span> נענו בתוך היעד/,
      );
      assert.match(share.body, /value="2040-03-07"/);
      assert.doesNotMatch(share.body, /3 מתוך/);
    } finally {
      if (restore !== undefined) {
        const restoring = asOperator(
          app,
          await signIn(pool, clock, {
            email: `admin@${domain}`,
            role: 'ADMIN',
          }),
        );
        const restored = await restoring.inject({
          method: 'POST',
          url: '/settings/answer-target',
          ...form({
            days: restore.days,
            ...(restore.shown ? { shown: 'true' } : {}),
          }),
        });
        assert.equal(restored.statusCode, 303);
      }
      if (threads.length > 0) {
        await pool.query(
          `DELETE FROM service_call_transition
            WHERE service_call_id IN (
              SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
            )`,
          [`%@${domain}`],
        );
        await pool.query(
          `DELETE FROM message
            WHERE conversation_id IN (
              SELECT conversation_id FROM conversation
               WHERE external_thread_id = ANY($1::text[])
            )`,
          [threads],
        );
        await pool.query(
          `DELETE FROM service_call WHERE sender_label LIKE $1`,
          [`%@${domain}`],
        );
        await pool.query(
          `DELETE FROM conversation WHERE external_thread_id = ANY($1::text[])`,
          [threads],
        );
      }
      await pool.query(`DELETE FROM audit_log WHERE actor_id = $1`, [
        admin.staffAccountId,
      ]);
      await pool.query(`DELETE FROM audit_log WHERE actor_id = $1`, [
        operator.staffAccountId,
      ]);
      await pool.query(`DELETE FROM party WHERE party_id = $1`, [party.id]);
      await signOutAll(pool, domain);
      await lock.query('SELECT pg_advisory_unlock(288)');
      lock.release();
      await app.close();
      await pool.end();
    }
  });

  it('names a reply time on the home page and the report confirmation only when switched on', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'reply-line.test';
    const clock = fixedClock(new Date('2026-10-21T09:00:00.000Z'));
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      codeSender: sender,
    });
    const lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock(288)');
    await signOutAll(pool, domain);
    const admin = await signIn(pool, clock, {
      email: `admin@${domain}`,
      role: 'ADMIN',
    });
    const asAdmin = asOperator(app, admin);
    await pool.query(
      `DELETE FROM audit_log WHERE actor_id = $1 AND action = 'calls.reply_target'`,
      [admin.staffAccountId],
    );
    let restore: { days: string; shown: boolean } | undefined;
    let phone = '';
    let e164 = '';
    try {
      const local = String(Math.floor(Math.random() * 10_000_000)).padStart(
        7,
        '0',
      );
      phone = `052-${local.slice(0, 3)}-${local.slice(3)}`;
      e164 = `+97252${local}`;
      const before = await asAdmin.inject({ method: 'GET', url: '/settings' });
      restore = {
        days: fieldValue(before.body, 'days') ?? '2',
        shown: boxChecked(before.body, 'shown'),
      };
      const off = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '2' }),
      });
      assert.equal(off.statusCode, 303);

      const stamp = crypto.randomUUID().slice(0, 8);
      const seeded = await seedOccupancy(pool, stamp, {
        phone: e164,
        contactFrom: '2026-01-01',
        contactTo: null,
        tenancyFrom: '2026-03-01',
        tenancyTo: '2027-02-28',
        address: { line: `רחוב ${stamp}`, city: `פורטל ${stamp}` },
      });
      await pool.query(
        `UPDATE building SET portal_enabled = true
          WHERE building_id IN (
            SELECT building_id FROM space WHERE space_id = $1
          )`,
        [seeded.unitId],
      );
      const tenant = await asTenant(app, phone, sender, {
        remoteAddress: `10.288.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
      });
      const quiet = /ימי עסקים|business days|рабочих дней/;
      async function sendReport(text: string) {
        const start = await tenant.inject({ method: 'GET', url: '/report' });
        const csrf = /name="csrf" value="([^"]+)"/.exec(start.body)?.[1] ?? '';
        const submission =
          /name="submission" value="([^"]+)"/.exec(start.body)?.[1] ?? '';
        const category =
          /data-code="PLUMBING" value="([^"]+)"/.exec(start.body)?.[1] ?? '';
        const step = async (payload: string) =>
          tenant.inject({
            method: 'POST',
            url: '/report',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload,
          });
        const details = await step(
          `csrf=${csrf}&submission=${submission}&category=${category}&description=&entry=&step=1&action=next`,
        );
        const told = await step(
          `csrf=${/name="csrf" value="([^"]+)"/.exec(details.body)?.[1]}&submission=${submission}&category=${category}&description=${encodeURIComponent(text)}&entry=&step=2&action=next`,
        );
        return step(
          `csrf=${/name="csrf" value="([^"]+)"/.exec(told.body)?.[1]}&submission=${submission}&category=${category}&description=${encodeURIComponent(text)}&entry=YES&step=3&action=send`,
        );
      }
      for (const path of [
        '/',
        '/calls',
        '/report',
        '/ask',
        `/flat/${seeded.tenancyId}`,
      ]) {
        const page = await tenant.inject({ method: 'GET', url: path });
        assert.equal(page.statusCode, 200, path);
        assert.doesNotMatch(page.body, quiet);
      }
      const withheld = await sendReport('נזילה שקטה');
      assert.equal(withheld.statusCode, 200);
      assert.match(withheld.body, /הדיווח התקבל/);
      assert.doesNotMatch(withheld.body, quiet);

      clock.advance(1000);
      const on = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '2', shown: 'true' }),
      });
      assert.equal(on.statusCode, 303);
      const home = await tenant.inject({ method: 'GET', url: '/' });
      assert.match(home.body, /class="tp-reply"/);
      assert.match(home.body, /M12 6v6l4 2/);
      assert.match(home.body, /אנחנו עונים בתוך 2 ימי עסקים/);
      assert.doesNotMatch(home.body, /למה|הבטחה/);
      for (const path of [
        '/calls',
        '/report',
        '/ask',
        `/flat/${seeded.tenancyId}`,
      ]) {
        const page = await tenant.inject({ method: 'GET', url: path });
        assert.doesNotMatch(page.body, quiet);
      }

      const sent = await sendReport('נזילה מתחת לכיור');
      assert.equal(sent.statusCode, 200);
      assert.match(sent.body, /class="tp-reply-pill"/);
      assert.match(sent.body, /אדם מהמשרד יענה בתוך 2 ימי עסקים/);
      assert.doesNotMatch(sent.body, /למה|הבטחה/);

      clock.advance(1000);
      const again = await asAdmin.inject({
        method: 'POST',
        url: '/settings/answer-target',
        ...form({ days: '2' }),
      });
      assert.equal(again.statusCode, 303);
      const hidden = await tenant.inject({ method: 'GET', url: '/' });
      assert.doesNotMatch(hidden.body, quiet);
      assert.deepEqual(await shownAudits(pool, admin.staffAccountId), [
        false,
        true,
        false,
      ]);
    } finally {
      if (restore !== undefined) {
        await asAdmin.inject({
          method: 'POST',
          url: '/settings/answer-target',
          ...form({
            days: restore.days,
            ...(restore.shown ? { shown: 'true' } : {}),
          }),
        });
      }
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE sender_label = $1
          )`,
        [e164],
      );
      await pool.query(`DELETE FROM message WHERE sender_address = $1`, [e164]);
      await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [
        e164,
      ]);
      await pool.query(
        `DELETE FROM audit_log WHERE actor_id = $1 OR subject_id IN (
           SELECT portal_identity_id::text FROM portal_identity WHERE phone = $2
         )`,
        [admin.staffAccountId, e164],
      );
      await signOutAll(pool, domain);
      await lock.query('SELECT pg_advisory_unlock(288)');
      lock.release();
      await app.close();
      await pool.end();
    }
  });
});
