// POLICY — a tenant sees their own flat, and only while the building is in the
// portal and the tenancy is still open. Another tenancy's id is not found.
// A guarantor, a past tenant and a verified non-tenant see no tenancy data.
// #279.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { asTenant } from '../support/session.ts';
import { seedOccupancy, seedUnit } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T08:00:00.000Z');
const DAY_BEFORE = new Date('2026-10-20T08:00:00.000Z');
const HOST = 'tenant.localhost';
const PHONES = [
  '+972520002791',
  '+972520002792',
  '+972520002793',
  '+972520002794',
  '+972520002795',
  '+972520002796',
] as const;
const [A, B, GUARANTOR, PAST, NONE, ENDS] = PHONES;

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function choiceOf(header: unknown): string | null {
  const values = Array.isArray(header)
    ? header.map(String)
    : typeof header === 'string'
      ? [header]
      : [];
  for (const value of values) {
    const pair = value.split(';')[0] ?? '';
    if (pair.startsWith('dona_portal_choice=')) return pair;
  }
  return null;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log
      WHERE actor_id IN (
        SELECT portal_identity_id::text FROM portal_identity WHERE phone = ANY($1::text[])
      )
      OR subject_id IN (
        SELECT party_id::text FROM party_contact WHERE value = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_opt_in
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_session
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_identity WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = ANY($1::text[]))`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 279%'
      )`,
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = ANY($1::text[])
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 279%'
      )`,
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city LIKE 'פורטל 279%')`,
  );
  await pool.query(`DELETE FROM building WHERE city LIKE 'פורטל 279%'`);
}

async function place(
  pool: Pool,
  spec: {
    phone: string;
    unit: string;
    line: string;
    city: string;
    from: string;
    to: string;
    status?: 'ACTIVE' | 'ENDED';
    role?: 'PRIMARY_TENANT' | 'GUARANTOR';
    service?: boolean;
    given?: string;
    bay?: string;
    storage?: string;
    portal?: boolean;
  },
): Promise<{ tenancyId: string; unitId: string; partyId: string }> {
  const seeded = await seedOccupancy(pool, spec.unit, {
    phone: spec.phone,
    contactFrom: '2026-01-01',
    contactTo: null,
    tenancyFrom: spec.from,
    tenancyTo: spec.to,
    status: spec.status,
    role: spec.role,
    isServiceContact: spec.service,
    address: { line: spec.line, city: spec.city },
  });
  if (spec.given !== undefined) {
    await pool.query(`UPDATE party SET given_name = $2 WHERE party_id = $1`, [
      seeded.partyId,
      spec.given,
    ]);
  }
  const building = await pool.query(
    `SELECT building_id FROM space WHERE space_id = $1`,
    [seeded.unitId],
  );
  const buildingId = building.rows[0]?.building_id;
  assert.ok(buildingId);
  if (spec.portal === true) {
    await pool.query(
      `UPDATE building SET portal_enabled = true WHERE building_id = $1`,
      [buildingId],
    );
  }
  if (spec.bay !== undefined) {
    const bayId = newId();
    await pool.query(
      `INSERT INTO space (space_id, building_id, space_kind, name)
       VALUES ($1, $2, 'PARKING', $3)`,
      [bayId, buildingId, spec.bay],
    );
    await pool.query(
      `UPDATE tenancy SET parking_space_id = $2 WHERE tenancy_id = $1`,
      [seeded.tenancyId, bayId],
    );
  }
  if (spec.storage !== undefined) {
    const storageId = newId();
    await pool.query(
      `INSERT INTO space (space_id, building_id, space_kind, name)
       VALUES ($1, $2, 'STORAGE', $3)`,
      [storageId, buildingId, spec.storage],
    );
    await pool.query(
      `UPDATE tenancy SET storage_space_id = $2 WHERE tenancy_id = $1`,
      [seeded.tenancyId, storageId],
    );
  }
  return {
    tenancyId: seeded.tenancyId,
    unitId: seeded.unitId,
    partyId: seeded.partyId,
  };
}

/** A second letting for a party who already holds the number. One number is one party. */
async function secondLetting(
  pool: Pool,
  partyId: string,
  spec: {
    unit: string;
    line: string;
    city: string;
    from: string;
    to: string;
  },
): Promise<{ tenancyId: string }> {
  const unitId = await seedUnit(pool, spec.unit, {
    line: spec.line,
    city: spec.city,
  });
  const profile = await pool.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, 'standard')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING terms_profile_id`,
    [newId()],
  );
  const termsProfileId = profile.rows[0]?.terms_profile_id;
  assert.ok(termsProfileId);
  const tenancyId = newId();
  await pool.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
    [tenancyId, unitId, spec.from, spec.to, termsProfileId],
  );
  await pool.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
    [tenancyId, partyId],
  );
  const building = await pool.query(
    `SELECT building_id FROM space WHERE space_id = $1`,
    [unitId],
  );
  const buildingId = building.rows[0]?.building_id;
  assert.ok(buildingId);
  await pool.query(
    `UPDATE building SET portal_enabled = true WHERE building_id = $1`,
    [buildingId],
  );
  return { tenancyId };
}

describe('policy · my flat', { concurrency: 1 }, () => {
  it('shows the tenant their flat and not found for someone else', async (t) => {
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

    const mine = await place(pool, {
      phone: A,
      unit: '12',
      line: 'רחוב 279 אלף',
      city: 'פורטל 279א',
      from: '2026-03-01',
      to: '2027-02-28',
      given: 'נועה',
      bay: '12',
      storage: '4',
      portal: true,
    });
    const theirs = await place(pool, {
      phone: B,
      unit: '3',
      line: 'רחוב 279 בית',
      city: 'פורטל 279ב',
      from: '2026-03-01',
      to: '2027-02-28',
      portal: true,
    });

    const tenant = await asTenant(app, '052-000-2791', sender, {
      remoteAddress: '10.279.0.1',
    });
    const identity = await pool.query<{ id: string }>(
      `SELECT portal_identity_id::text AS id FROM portal_identity WHERE phone = $1`,
      [A],
    );
    const actor = identity.rows[0]?.id;
    assert.ok(actor);
    const before = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'scope.resolve_portal' AND actor_id = $1`,
      [actor],
    );
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /בוקר טוב, נועה/);
    assert.match(home.body, /דירה 12 · רחוב 279 אלף/);
    assert.match(home.body, /שאלה למשרד/);
    assert.match(home.body, /המסמכים שלי/);
    assert.match(home.body, /class="tp-tabs"/);
    assert.doesNotMatch(home.body, /בחירת דירה/);
    assert.doesNotMatch(home.body, /רחוב 279 בית/);

    const flat = await tenant.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}`,
    });
    assert.equal(flat.statusCode, 200);
    assert.match(flat.body, /רחוב 279 אלף/);
    assert.match(flat.body, /פורטל 279א/);
    assert.match(flat.body, /dir="ltr">01\.03\.2026</);
    assert.match(flat.body, /dir="ltr">28\.02\.2027</);
    assert.match(flat.body, /נותרו <span dir="ltr">4<\/span> חודשים/);
    assert.match(flat.body, /inline-size: 64%/);
    assert.match(flat.body, />12</);
    assert.match(flat.body, />4</);
    assert.match(flat.body, /id="documents"/);
    assert.match(flat.body, /class="tp-tabs"/);
    assert.doesNotMatch(flat.body, /בחירת דירה/);

    const stolen = await tenant.inject({
      method: 'GET',
      url: `/flat/${theirs.tenancyId}`,
    });
    assert.equal(stolen.statusCode, 404);
    assert.match(stolen.body, /לא נמצא/);
    assert.doesNotMatch(stolen.body, /רחוב 279 בית/);
    assert.doesNotMatch(stolen.body, /פורטל 279ב/);

    const after = await pool.query<{
      n: number;
      inputs: { matched?: number };
    }>(
      `SELECT count(*)::int AS n,
              (array_agg(inputs ORDER BY at DESC))[1] AS inputs
         FROM audit_log
        WHERE action = 'scope.resolve_portal' AND actor_id = $1`,
      [actor],
    );
    assert.equal(after.rows[0]?.n, (before.rows[0]?.n ?? 0) + 3);
    assert.deepEqual(after.rows[0]?.inputs, { matched: 1 });

    await pool.query(
      `UPDATE building SET city = 'פורטל 279א חדש'
        WHERE city = 'פורטל 279א'`,
    );
    const reread = await tenant.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}`,
    });
    assert.match(reread.body, /פורטל 279א חדש/);
  });

  it('drops a building on the request after it is switched off', async (t) => {
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

    const mine = await place(pool, {
      phone: A,
      unit: '12',
      line: 'רחוב 279 אלף',
      city: 'פורטל 279א',
      from: '2026-03-01',
      to: '2027-02-28',
      portal: true,
    });
    const tenant = await asTenant(app, '052-000-2791', sender, {
      remoteAddress: '10.279.0.2',
    });
    const open = await tenant.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}`,
    });
    assert.match(open.body, /רחוב 279 אלף/);

    await pool.query(
      `UPDATE building SET portal_enabled = false WHERE city = 'פורטל 279א'`,
    );
    const closed = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(closed.statusCode, 200);
    assert.match(closed.body, /הבניין שלכם עוד לא בפורטל/);
    assert.match(closed.body, /052-000-2791/);
    assert.match(closed.body, /שאלה למשרד/);
    assert.match(closed.body, /יציאה/);
    assert.doesNotMatch(closed.body, /class="tp-tabs"/);
    assert.doesNotMatch(closed.body, /רחוב 279 אלף/);
  });

  it('shows no tenancy to a guarantor, a past tenant or a non-tenant', async (t) => {
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

    await place(pool, {
      phone: GUARANTOR,
      unit: '31',
      line: 'רחוב 279 ערב',
      city: 'פורטל 279ג',
      from: '2026-01-01',
      to: '2027-01-01',
      role: 'GUARANTOR',
      service: false,
      portal: true,
    });
    await place(pool, {
      phone: PAST,
      unit: '32',
      line: 'רחוב 279 עבר',
      city: 'פורטל 279ד',
      from: '2025-01-01',
      to: '2026-01-01',
      status: 'ENDED',
      portal: true,
    });

    for (const [phone, dial, address] of [
      ['052-000-2793', '10.279.0.3', 'רחוב 279 ערב'],
      ['052-000-2794', '10.279.0.4', 'רחוב 279 עבר'],
      ['052-000-2795', '10.279.0.5', 'רחוב 279 אלף'],
    ] as const) {
      const tenant = await asTenant(app, phone, sender, {
        remoteAddress: address === 'רחוב 279 אלף' ? '10.279.0.5' : dial,
      });
      const home = await tenant.inject({ method: 'GET', url: '/' });
      assert.equal(home.statusCode, 200);
      assert.match(home.body, /הבניין שלכם עוד לא בפורטל/);
      assert.doesNotMatch(home.body, /class="tp-tabs"/);
      assert.doesNotMatch(home.body, new RegExp(address));
      assert.doesNotMatch(home.body, /דירה /);
    }
    void NONE;
  });

  it('stops showing a tenancy on the day it ends', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const sender = createRecordingCodeSender();
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });

    const mine = await place(pool, {
      phone: ENDS,
      unit: '8',
      line: 'רחוב 279 סוף',
      city: 'פורטל 279ה',
      from: '2026-01-01',
      to: '2026-10-21',
      portal: true,
    });
    const before = buildApp({
      pool,
      clock: fixedClock(DAY_BEFORE),
      version: '9.9.9-test',
      codeSender: sender,
    });
    const still = await asTenant(before, '052-000-2796', sender, {
      remoteAddress: '10.279.0.6',
    });
    const showing = await still.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}`,
    });
    assert.equal(showing.statusCode, 200);
    assert.match(showing.body, /רחוב 279 סוף/);
    await before.close();

    const onTheDay = buildApp({
      pool,
      clock: fixedClock(AT),
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await onTheDay.close();
    });
    const ended = await asTenant(onTheDay, '052-000-2796', sender, {
      remoteAddress: '10.279.0.7',
    });
    const hidden = await ended.inject({ method: 'GET', url: '/' });
    assert.match(hidden.body, /הבניין שלכם עוד לא בפורטל/);
    assert.doesNotMatch(hidden.body, /רחוב 279 סוף/);
  });

  it('keeps the chosen tenancy on the choice cookie and re-reads it', async (t) => {
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

    const lower = await place(pool, {
      phone: A,
      unit: '12',
      line: 'רחוב 279 אלף',
      city: 'פורטל 279א',
      from: '2026-03-01',
      to: '2027-02-28',
      portal: true,
    });
    await secondLetting(pool, lower.partyId, {
      unit: '3',
      line: 'רחוב 279 בית',
      city: 'פורטל 279ב',
      from: '2026-09-01',
      to: '2027-08-31',
    });
    const tenant = await asTenant(app, '052-000-2791', sender, {
      remoteAddress: '10.279.0.8',
    });
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.match(home.body, /בחירת דירה/);
    assert.match(home.body, /data-current>דירה 3 · רחוב 279 בית/);
    assert.match(home.body, /דירה 12 · רחוב 279 אלף/);

    const posted = await app.inject({
      method: 'POST',
      url: '/tenancy',
      headers: {
        host: HOST,
        cookie: tenant.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `tenancy=${lower.tenancyId}&next=/calls&csrf=${csrfOf(home.body)}`,
    });
    assert.equal(posted.statusCode, 303);
    assert.equal(posted.headers.location, '/calls');
    const choice = choiceOf(posted.headers['set-cookie']);
    assert.ok(choice);

    const calls = await app.inject({
      method: 'GET',
      url: '/calls',
      headers: { host: HOST, cookie: `${tenant.cookie}; ${choice}` },
    });
    assert.equal(calls.statusCode, 200);
    assert.match(calls.body, /הקריאות/);
    assert.match(calls.body, /data-current>דירה 12 · רחוב 279 אלף/);
    assert.match(calls.body, /class="tp-tabs"/);

    const sessionOnly = await tenant.inject({ method: 'GET', url: '/' });
    assert.match(sessionOnly.body, /data-current>דירה 3 · רחוב 279 בית/);
    assert.doesNotMatch(sessionOnly.body, /data-current>דירה 12/);

    const more = await app.inject({
      method: 'GET',
      url: '/more',
      headers: { host: HOST, cookie: `${tenant.cookie}; ${choice}` },
    });
    assert.equal(more.statusCode, 200);
    assert.match(more.body, /שאלה למשרד/);
    assert.match(more.body, /שפה/);
    assert.match(more.body, /מפתחות כניסה/);
    assert.match(more.body, /יציאה/);
    assert.doesNotMatch(more.body, /class="tp-tabs"/);

    const report = await app.inject({
      method: 'GET',
      url: '/report',
      headers: { host: HOST, cookie: `${tenant.cookie}; ${choice}` },
    });
    assert.equal(report.statusCode, 200);
    assert.match(report.body, /דיווח על תקלה/);
    assert.doesNotMatch(report.body, /class="tp-tabs"/);
  });
});
