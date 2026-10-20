// POLICY — a portal question is an ordinary call on PORTAL. A verified number
// with no party stays unidentified and carries no tenancy. The same form
// twice is one call. An emergency word flags the call. #278.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { addPartyContact, createParty } from '../../src/parties/contract.ts';
import { asTenant, signIn, signOutAll } from '../support/session.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-20T16:00:00.000Z');
const HOST = { host: 'tenant.localhost' };
const PHONE = '052-000-2781';
const E164 = '+972520002781';
const KNOWN = '052-000-2782';
const KNOWN_E164 = '+972520002782';
const DOMAIN = 'ask-278.test';

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function submissionOf(html: string): string {
  const match = /name="submission" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function callNumberOf(html: string): string {
  const match = /data-call-number="(\d+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(
    `WITH gone AS (
       DELETE FROM message WHERE sender_address IN ($1, $2)
       RETURNING conversation_id
     )
     DELETE FROM conversation
      WHERE conversation_id IN (SELECT conversation_id FROM gone)`,
    [E164, KNOWN_E164],
  );
  await pool.query(
    `DELETE FROM service_call_transition WHERE service_call_id IN (
       SELECT service_call_id FROM service_call WHERE sender_label IN ($1, $2)
     )`,
    [E164, KNOWN_E164],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label IN ($1, $2)`, [
    E164,
    KNOWN_E164,
  ]);
  await pool.query(
    `DELETE FROM portal_session WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone IN ($1, $2))`,
    [E164, KNOWN_E164],
  );
  await pool.query(`DELETE FROM portal_sign_in_code WHERE phone IN ($1, $2)`, [
    E164,
    KNOWN_E164,
  ]);
  await pool.query(`DELETE FROM portal_identity WHERE phone IN ($1, $2)`, [
    E164,
    KNOWN_E164,
  ]);
  await pool.query(
    `WITH dropped AS (
       DELETE FROM party_contact WHERE value IN ($1, $2)
       RETURNING party_id
     )
     DELETE FROM party
      WHERE party_id IN (SELECT party_id FROM dropped)`,
    [E164, KNOWN_E164],
  );
  await signOutAll(pool as never, DOMAIN);
}

describe('policy · ask the office', { concurrency: 1 }, () => {
  it('opens one PORTAL call, flags an emergency word, and leaves an unknown number with no tenancy', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });

    const anon = await app.inject({
      method: 'POST',
      url: '/ask',
      headers: {
        ...HOST,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload:
        'question=יש+שריפה&submission=00000000-0000-4000-8000-000000000278&csrf=no',
    });
    assert.equal(anon.statusCode, 303);

    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.278.0.1',
    });
    const form = await tenant.inject({ method: 'GET', url: '/ask' });
    assert.equal(form.statusCode, 200);
    assert.match(form.body, /השאלה מגיעה לאדם במשרד, ונשמרת עם הקריאות שלכם/);
    assert.match(form.body, /שליחה/);
    const payload = `question=${encodeURIComponent('יש שריפה במטבח')}&submission=${submissionOf(form.body)}&csrf=${csrfOf(form.body)}`;
    const sent = await tenant.inject({
      method: 'POST',
      url: '/ask',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });
    assert.equal(sent.statusCode, 200);
    assert.match(sent.body, /התקבלה/);
    const number = callNumberOf(sent.body);
    assert.match(sent.body, /קריאת חירום/);
    const again = await tenant.inject({
      method: 'POST',
      url: '/ask',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });
    assert.equal(again.statusCode, 200);
    assert.equal(callNumberOf(again.body), number);

    const rows = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_call WHERE sender_label = $1`,
      [E164],
    );
    assert.equal(rows.rows[0]?.n, 1);
    const stored = await pool.query<{
      source_channel: string;
      emergency: boolean;
      state: string;
      requester_party_id: string | null;
    }>(
      `SELECT source_channel, emergency, state, requester_party_id
         FROM service_call WHERE sender_label = $1`,
      [E164],
    );
    assert.equal(stored.rows[0]?.source_channel, 'PORTAL');
    assert.equal(stored.rows[0]?.emergency, true);
    assert.equal(stored.rows[0]?.state, 'NEW');
    assert.equal(stored.rows[0]?.requester_party_id, null);

    const staff = await signIn(pool, clock, {
      email: `office@${DOMAIN}`,
      role: 'ADMIN',
    });
    const list = await app.inject({
      method: 'GET',
      url: '/calls',
      headers: { cookie: staff.cookie },
    });
    assert.equal(list.statusCode, 200);
    assert.match(list.body, /יש שריפה במטבח/);
    assert.match(list.body, /פורטל/);

    const id = await pool.query<{ service_call_id: string }>(
      `SELECT service_call_id FROM service_call WHERE sender_label = $1`,
      [E164],
    );
    const page = await app.inject({
      method: 'GET',
      url: `/calls/${id.rows[0]?.service_call_id}`,
      headers: { cookie: staff.cookie },
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /data-verified-number="true"/);
    assert.match(page.body, /מספר מאומת/);
    assert.doesNotMatch(page.body, /שכירות/);
  });

  it('identifies a party the number resolves to, and still shows no tenancy', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'נועה',
      familyName: 'שאלה',
      preferredLanguage: 'he',
    });
    await addPartyContact(pool, {
      partyId: party.id,
      channel: 'PHONE',
      value: KNOWN_E164,
      label: null,
      validFrom: '2026-01-01',
    });

    const tenant = await asTenant(app, KNOWN, sender, {
      remoteAddress: '10.278.0.2',
    });
    const form = await tenant.inject({ method: 'GET', url: '/ask' });
    const sent = await tenant.inject({
      method: 'POST',
      url: '/ask',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `question=${encodeURIComponent('אפשר העתק של החוזה')}&submission=${submissionOf(form.body)}&csrf=${csrfOf(form.body)}`,
    });
    assert.equal(sent.statusCode, 200);
    assert.match(sent.body, /התקבלה/);

    const stored = await pool.query<{
      state: string;
      requester_party_id: string | null;
    }>(
      `SELECT state, requester_party_id FROM service_call WHERE sender_label = $1`,
      [KNOWN_E164],
    );
    assert.equal(stored.rows[0]?.state, 'IDENTIFIED');
    assert.equal(stored.rows[0]?.requester_party_id, party.id);

    const staff = await signIn(pool, clock, {
      email: `known@${DOMAIN}`,
      role: 'ADMIN',
    });
    const id = await pool.query<{ service_call_id: string }>(
      `SELECT service_call_id FROM service_call WHERE sender_label = $1`,
      [KNOWN_E164],
    );
    const page = await app.inject({
      method: 'GET',
      url: `/calls/${id.rows[0]?.service_call_id}`,
      headers: { cookie: staff.cookie },
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /נועה/);
    assert.doesNotMatch(page.body, /שכירות/);
    assert.doesNotMatch(page.body, /data-verified-number="true"/);
  });
});
