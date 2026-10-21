// POLICY — the portal opens in the party's language when it is Hebrew, English
// or Russian, and the tenant's later choice is what the next request shows.
// #285.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { PORTAL_LANG_COOKIE } from '../../src/portal/contract.ts';
import { asTenant } from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T08:00:00.000Z');
const HOST = { host: 'tenant.localhost' };
const PHONE = '+972520002850';
const NATIONAL = '052-000-2850';

function hidden(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function csrfOf(html: string): string {
  return hidden(html, 'csrf');
}

function pairNamed(header: unknown, name: string): string | null {
  const values = Array.isArray(header)
    ? header.map(String)
    : typeof header === 'string'
      ? [header]
      : [];
  for (const value of values) {
    const pair = value.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log
      WHERE actor_id IN (
        SELECT portal_identity_id::text FROM portal_identity WHERE phone = $1
      )
      OR subject_id IN (
        SELECT party_id::text FROM party_contact WHERE value = $1
      )`,
    [PHONE],
  );
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [PHONE],
  );
  await pool.query(
    `DELETE FROM portal_opt_in
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [PHONE],
  );
  await pool.query(
    `DELETE FROM portal_session
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = $1
      )`,
    [PHONE],
  );
  await pool.query(`DELETE FROM portal_sign_in_code WHERE phone = $1`, [PHONE]);
  await pool.query(`DELETE FROM portal_identity WHERE phone = $1`, [PHONE]);
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = $1)`,
    [PHONE],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = 'פורטל 285'
      )`,
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = $1
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [PHONE],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = 'פורטל 285'
      )`,
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city = 'פורטל 285')`,
  );
  await pool.query(`DELETE FROM building WHERE city = 'פורטל 285'`);
}

describe('policy · portal language', { concurrency: 1 }, () => {
  it('opens in the party language and keeps a later choice', async (t) => {
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

    const seeded = await seedOccupancy(pool, '12', {
      phone: PHONE,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-03-01',
      tenancyTo: '2027-02-28',
      address: { line: 'רחוב 285', city: 'פורטל 285' },
    });
    await pool.query(
      `UPDATE party SET given_name = 'נועה', preferred_language = 'ru' WHERE party_id = $1`,
      [seeded.partyId],
    );
    const building = await pool.query(
      `SELECT building_id FROM space WHERE space_id = $1`,
      [seeded.unitId],
    );
    await pool.query(
      `UPDATE building SET portal_enabled = true WHERE building_id = $1`,
      [building.rows[0]?.building_id],
    );

    const tenant = await asTenant(app, NATIONAL, sender, {
      remoteAddress: '10.285.0.1',
    });
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200, String(home.headers.location ?? ''));
    assert.match(home.body, /lang="ru"/);
    assert.match(home.body, /dir="ltr"/);
    assert.match(home.body, /Доброе утро, נועה/);
    assert.doesNotMatch(home.body, /בוקר טוב/);

    const switched = await tenant.inject({
      method: 'POST',
      url: '/language',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'language=en&next=/',
    });
    assert.equal(switched.statusCode, 303);
    const kept = pairNamed(switched.headers['set-cookie'], PORTAL_LANG_COOKIE);
    assert.ok(kept?.startsWith(`${PORTAL_LANG_COOKIE}=en`));
    const cookie = `${tenant.cookie}; ${kept}`;
    const notice = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { ...HOST, cookie },
    });
    assert.equal(notice.statusCode, 200);
    assert.match(notice.body, /lang="en"/);
    assert.match(notice.body, /Privacy notice/);
    const accepted = await app.inject({
      method: 'POST',
      url: '/notice',
      headers: {
        ...HOST,
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `csrf=${csrfOf(notice.body)}&privacy=${hidden(notice.body, 'privacy')}&terms=${hidden(notice.body, 'terms')}`,
    });
    assert.equal(accepted.statusCode, 303);
    const english = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie },
    });
    assert.match(english.body, /lang="en"/);
    assert.match(english.body, /Good morning, נועה/);
    assert.doesNotMatch(english.body, /Доброе утро/);

    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const form = pairNamed(page.headers['set-cookie'], 'dona_portal_form');
    assert.ok(form);
    const chosen = await app.inject({
      method: 'POST',
      url: '/language',
      headers: {
        ...HOST,
        cookie: form,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `language=en&next=/&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(chosen.statusCode, 303);
    const saved = pairNamed(chosen.headers['set-cookie'], PORTAL_LANG_COOKIE);
    assert.ok(saved?.startsWith(`${PORTAL_LANG_COOKIE}=en`));
    const again = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: `${form}; ${saved}` },
    });
    assert.match(again.body, /lang="en"/);
    assert.match(again.body, /Enter the mobile number/);
  });
});
