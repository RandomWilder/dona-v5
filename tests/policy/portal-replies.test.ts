// POLICY — a PORTAL call is not returned to the filtered list. The command
// refuses, and the control is absent on the call page. #284.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import {
  exitCall,
  getCall,
  identifyCall,
  openIntakeCall,
  returnToFiltered,
  sendCallReply,
} from '../../src/calls/contract.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import {
  asOperator,
  asTenant,
  signIn,
  signOutAll,
} from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T10:00:00.000Z');
const DOMAIN = 'portal-284.test';
const SENDER = 'portal-284@tenant.test';

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call WHERE sender_label = $1
      )`,
    [SENDER],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [
    SENDER,
  ]);
  await signOutAll(pool, DOMAIN);
}

describe('policy · a portal call is not filtered', () => {
  it('refuses the return and leaves the control off the page', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });

    const opened = await openIntakeCall(pool, clock, {
      sourceChannel: 'PORTAL',
      description: 'דוד לא מחמם 284',
      senderAddress: SENDER,
      emergency: false,
      toReview: false,
      sorterLabel: 'call',
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    const who = await signIn(pool, clock, {
      email: `ops@${DOMAIN}`,
      role: 'OPERATOR',
    });
    await assert.rejects(
      () =>
        returnToFiltered(pool, clock, {
          callId: opened.id,
          actorId: who.staffAccountId,
          actorRole: 'OPERATOR',
        }),
      (error: unknown) =>
        error instanceof KernelError &&
        error.code === 'invalid' &&
        error.details?.reason === 'portal',
    );
    const still = await pool.query<{ returned_at: Date | null }>(
      `SELECT returned_at FROM service_call WHERE service_call_id = $1`,
      [opened.id],
    );
    assert.equal(still.rows[0]?.returned_at, null);

    const client = asOperator(app, who);
    const page = await client.inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.equal(page.statusCode, 200);
    assert.doesNotMatch(page.body, /החזרה למסוננות/);

    const posted = await client.inject({
      method: 'POST',
      url: `/calls/${opened.id}/return`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    assert.equal(posted.statusCode, 400);
    assert.match(posted.body, /קריאה מהפורטל לא חוזרת למסוננות/);
    const after = await pool.query<{ returned_at: Date | null }>(
      `SELECT returned_at FROM service_call WHERE service_call_id = $1`,
      [opened.id],
    );
    assert.equal(after.rows[0]?.returned_at, null);
  });
});

const PHONE = '052-000-2841';
const E164 = '+972520002841';
const CITY = 'פורטל 284';
const FOLLOW = 'המים עדיין קרים 284';
const REPLY = 'נבדוק את הדוד מחר 284';
const CANCEL = 'הדייר ביטל את הקריאה 284';

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function hiddenOf(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function categoryOf(html: string): string {
  const match = /data-code="PLUMBING" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

async function place(pool: Pool): Promise<{ partyId: string; unitId: string }> {
  const seeded = await seedOccupancy(pool, '8', {
    phone: E164,
    contactFrom: '2026-01-01',
    contactTo: null,
    tenancyFrom: '2026-01-01',
    tenancyTo: '2027-01-01',
    address: { line: 'רחוב 284', city: CITY },
  });
  await pool.query(
    `UPDATE building SET portal_enabled = true
      WHERE building_id IN (SELECT building_id FROM space WHERE space_id = $1)`,
    [seeded.unitId],
  );
  return { partyId: seeded.partyId, unitId: seeded.unitId };
}

async function clearTenant(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM attachment_hold
      WHERE owner_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [E164],
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM message WHERE sender_address = $1
       RETURNING conversation_id
     )
     DELETE FROM conversation
      WHERE conversation_id IN (SELECT conversation_id FROM gone)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call WHERE sender_label = $1
      )`,
    [E164],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [E164]);
  await pool.query(
    `DELETE FROM audit_log
      WHERE actor_id IN (
        SELECT portal_identity_id::text FROM portal_identity WHERE phone = $1
      )`,
    [E164],
  );
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [E164],
  );
  await pool.query(
    `DELETE FROM portal_session
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [E164],
  );
  await pool.query(`DELETE FROM portal_sign_in_code WHERE phone = $1`, [E164]);
  await pool.query(`DELETE FROM portal_identity WHERE phone = $1`, [E164]);
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = $1)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1
      )`,
    [CITY],
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = $1
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1
      )`,
    [CITY],
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city = $1)`,
    [CITY],
  );
  await pool.query(`DELETE FROM building WHERE city = $1`, [CITY]);
  await signOutAll(pool, DOMAIN);
}

describe('policy · replies both ways', { concurrency: 1 }, () => {
  it('threads a follow-up onto the open call', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await clearTenant(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await clearTenant(pool);
      await app.close();
      await pool.end();
    });
    const { partyId } = await place(pool);
    const who = await signIn(pool, clock, {
      email: `thread@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const opened = await openIntakeCall(pool, clock, {
      sourceChannel: 'PORTAL',
      description: 'דוד לא מחמם 284',
      senderAddress: E164,
      emergency: false,
      toReview: false,
      sorterLabel: 'call',
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: opened.id,
      partyId,
      actorId: who.staffAccountId,
      actorRole: 'OPERATOR',
    });
    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.284.0.1',
    });
    const page = await tenant.inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /עוד פרט לקריאה/);
    assert.match(page.body, /name="file"/);
    const posted = await tenant.inject({
      method: 'POST',
      url: `/calls/${opened.id}/follow-up`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `body=${encodeURIComponent(FOLLOW)}&key=${hiddenOf(page.body, 'key')}`,
    });
    assert.equal(posted.statusCode, 303);
    const again = await tenant.inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.match(again.body, new RegExp(FOLLOW));
    const calls = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_call WHERE sender_label = $1`,
      [E164],
    );
    assert.equal(calls.rows[0]?.n, 1);
    const onCall = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM message
        WHERE service_call_id = $1 AND body_original = $2 AND NOT is_echo`,
      [opened.id, FOLLOW],
    );
    assert.equal(onCall.rows[0]?.n, 1);
  });

  it('stores an office reply on the portal thread', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await clearTenant(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await clearTenant(pool);
      await app.close();
      await pool.end();
    });
    const { partyId } = await place(pool);
    const who = await signIn(pool, clock, {
      email: `reply@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const opened = await openIntakeCall(pool, clock, {
      sourceChannel: 'PORTAL',
      description: 'דוד לא מחמם 284',
      senderAddress: E164,
      emergency: false,
      toReview: false,
      sorterLabel: 'call',
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: opened.id,
      partyId,
      actorId: who.staffAccountId,
      actorRole: 'OPERATOR',
    });
    let sent = 0;
    await sendCallReply(
      pool,
      clock,
      {
        callId: opened.id,
        body: REPLY,
        actorId: who.staffAccountId,
        actorRole: 'OPERATOR',
      },
      async () => {
        sent += 1;
        return { externalMessageId: 'should-not-send' };
      },
    );
    assert.equal(sent, 0);
    const office = await asOperator(app, who).inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.match(office.body, /תשובה לדייר/);
    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.284.0.2',
    });
    const thread = await tenant.inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.match(thread.body, new RegExp(REPLY));
    assert.match(thread.body, /המשרד/);
  });

  it('opens a continuation from a closed call and shows the cancellation note', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await clearTenant(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await clearTenant(pool);
      await app.close();
      await pool.end();
    });
    const { partyId } = await place(pool);
    const who = await signIn(pool, clock, {
      email: `close@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const opened = await openIntakeCall(pool, clock, {
      sourceChannel: 'PORTAL',
      description: 'דוד לא מחמם 284',
      senderAddress: E164,
      emergency: false,
      toReview: false,
      sorterLabel: 'call',
      summary: null,
      proposedCategoryId: null,
      predecessorId: null,
      openedBy: null,
      sorterModel: null,
      sorterPrompt: null,
    });
    await identifyCall(pool, clock, {
      callId: opened.id,
      partyId,
      actorId: who.staffAccountId,
      actorRole: 'OPERATOR',
    });
    await exitCall(pool, clock, {
      callId: opened.id,
      kind: 'CANCELLED',
      note: CANCEL,
      actorId: who.staffAccountId,
      actorRole: 'OPERATOR',
    });
    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.284.0.3',
    });
    const thread = await tenant.inject({
      method: 'GET',
      url: `/calls/${opened.id}`,
    });
    assert.equal(thread.statusCode, 200);
    assert.match(thread.body, /בוטלה/);
    assert.match(thread.body, new RegExp(CANCEL));
    assert.match(thread.body, /פתיחת קריאה המשך/);
    assert.doesNotMatch(
      thread.body,
      /name="body"|עוד פרט לקריאה|class="tp-composer"/,
    );
    const report = await tenant.inject({
      method: 'GET',
      url: `/report?from=${opened.id}`,
    });
    assert.equal(report.statusCode, 200);
    assert.equal(hiddenOf(report.body, 'predecessor'), opened.id);
    const plumbing = categoryOf(report.body);
    const step1 = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        csrf: csrfOf(report.body),
        submission: hiddenOf(report.body, 'submission'),
        predecessor: opened.id,
        category: plumbing,
        description: '',
        entry: '',
        step: '1',
        action: 'next',
      }).toString(),
    });
    const step2 = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        csrf: csrfOf(step1.body),
        submission: hiddenOf(step1.body, 'submission'),
        predecessor: hiddenOf(step1.body, 'predecessor'),
        category: plumbing,
        description: 'הדוד שוב לא מחמם 284',
        entry: '',
        step: '2',
        action: 'next',
      }).toString(),
    });
    const sent = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        csrf: csrfOf(step2.body),
        submission: hiddenOf(step2.body, 'submission'),
        predecessor: hiddenOf(step2.body, 'predecessor'),
        category: plumbing,
        description: 'הדוד שוב לא מחמם 284',
        entry: 'ARRANGE',
        step: '3',
        action: 'send',
      }).toString(),
    });
    assert.equal(sent.statusCode, 200);
    const next = await pool.query<{ predecessor_id: string | null }>(
      `SELECT predecessor_id FROM service_call
        WHERE sender_label = $1 AND service_call_id <> $2`,
      [E164, opened.id],
    );
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0]?.predecessor_id, opened.id);
    const linked = await getCall(pool, next.rows[0]?.predecessor_id ?? '');
    assert.equal(linked?.id, opened.id);
  });
});
