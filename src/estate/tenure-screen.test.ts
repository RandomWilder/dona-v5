// #211. An admin changes a flat's tenure from its page. Sold asks before it writes.
// A trigger refusal is a sentence on the page. The change is an audit line, not an estate event.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan, UnitPlan } from './contract.ts';
import { seedBuilding } from './contract.ts';

const DOMAIN = 'estate-tenure-screen.test';
const CITY = 'עיר ייעוד דירה';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function flat(n: string, extra: Partial<UnitPlan> = {}): UnitPlan {
  return {
    spaceName: n,
    unitNumber: n,
    rooms: 4,
    areaSqm: 90,
    hasMamad: true,
    parkingSpaceName: null,
    storageSpaceName: null,
    warrantyEndDate: null,
    conditionStatus: 'READY',
    tenure: 'FOR_RENT',
    flatType: 'BG',
    ...extra,
  };
}

function plan(tenure: UnitPlan['tenure'] = 'FOR_RENT'): EstatePlan {
  return {
    projects: [],
    buildings: [
      {
        name: 'בניין ייעוד',
        addressLine: 'רחוב ייעוד 4',
        city: CITY,
        projectCode: null,
        handoverDate: '2026-09-01',
        warrantyEndDate: '2028-09-01',
        status: 'ACTIVE',
        spaces: [{ kind: 'UNIT', name: '1', floor: '1', accessNote: null }],
        units: [flat('1', { tenure })],
      },
    ],
  };
}

async function cleanup(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  const unitIds = `(SELECT space_id FROM space s
     JOIN building b ON b.building_id = s.building_id WHERE b.city = $1)`;
  for (const statement of [
    `DELETE FROM audit_log WHERE action = 'estate.tenure' AND subject_id IN (
       SELECT s.space_id::text FROM space s
       JOIN building b ON b.building_id = s.building_id WHERE b.city = $1)`,
    `DELETE FROM estate_event WHERE unit_id IN ${unitIds}`,
    `DELETE FROM tenancy_party WHERE tenancy_id IN (
       SELECT tenancy_id FROM tenancy WHERE unit_id IN ${unitIds})`,
    `DELETE FROM tenancy WHERE unit_id IN ${unitIds}`,
    `DELETE FROM unit WHERE unit_id IN ${unitIds}`,
    `DELETE FROM space WHERE building_id IN (SELECT building_id FROM building WHERE city = $1)`,
    'DELETE FROM building WHERE city = $1',
  ]) {
    await pool.query(statement, [CITY]).catch(() => {});
  }
  await pool
    .query('DELETE FROM terms_profile WHERE name = $1', ['tenure screen annex'])
    .catch(() => {});
}

describe('estate · change a flat’s tenure from its page', () => {
  it('an admin marks a flat for sale and the change is audited', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1 AND u.unit_number = '1'`,
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const page = await client.inject({
        method: 'GET',
        url: `/estate/units/${unitId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(
        page.body,
        new RegExp(`action="/estate/units/${unitId}/tenure"`),
      );
      assert.match(page.body, /name="tenure"[^>]*>/);
      assert.match(page.body, /value="FOR_RENT"[^>]*selected/);
      assert.match(page.body, /נמכרה אינה ניתנת לביטול/);
      assert.doesNotMatch(page.body, /סמנו אישור כדי למכור/);

      const saved = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'FOR_SALE' }).toString(),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/estate/units/${unitId}`);

      const after = await pool.query<{ tenure: string; rooms: string }>(
        'SELECT tenure, rooms::text FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_SALE');
      assert.equal(after.rows[0]?.rooms, '4');

      const audits = await pool.query<{
        actor_id: string;
        from_tenure: string;
        to_tenure: string;
        at: Date;
      }>(
        `SELECT actor_id, inputs->>'from' AS from_tenure, inputs->>'to' AS to_tenure, at
           FROM audit_log
          WHERE action = 'estate.tenure' AND subject_id = $1`,
        [unitId],
      );
      assert.equal(audits.rowCount, 1);
      assert.equal(audits.rows[0]?.actor_id, admin.staffAccountId);
      assert.equal(audits.rows[0]?.from_tenure, 'FOR_RENT');
      assert.equal(audits.rows[0]?.to_tenure, 'FOR_SALE');
      assert.ok(audits.rows[0]?.at instanceof Date);

      const events = await pool.query(
        'SELECT 1 FROM estate_event WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(events.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('selling without confirmation leaves the flat and says it cannot be undone', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'SOLD' }).toString(),
      });
      assert.equal(refused.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: String(refused.headers.location),
      });
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers['content-type']), /text\/html/);
      assert.match(
        page.body,
        /<p class="form-note">נמכרה אינה ניתנת לביטול\.<\/p>/,
      );
      const after = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_RENT');
      const audits = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'estate.tenure' AND subject_id = $1`,
        [unitId],
      );
      assert.equal(audits.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('a confirmed sale writes sold and records the change', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const saved = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({
          tenure: 'SOLD',
          confirm_sold: 'yes',
        }).toString(),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/estate/units/${unitId}`);
      const after = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'SOLD');
      const audits = await pool.query<{
        from_tenure: string;
        to_tenure: string;
      }>(
        `SELECT inputs->>'from' AS from_tenure, inputs->>'to' AS to_tenure
           FROM audit_log
          WHERE action = 'estate.tenure' AND subject_id = $1`,
        [unitId],
      );
      assert.equal(audits.rowCount, 1);
      assert.equal(audits.rows[0]?.from_tenure, 'FOR_RENT');
      assert.equal(audits.rows[0]?.to_tenure, 'SOLD');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('a let flat cannot be sold, and the page says so', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         RETURNING terms_profile_id`,
        [newId(), 'tenure screen annex'],
      );
      await pool.query(
        `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
         VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
        [newId(), unitId, profile.rows[0]?.terms_profile_id],
      );
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({
          tenure: 'SOLD',
          confirm_sold: 'yes',
        }).toString(),
      });
      assert.equal(refused.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: String(refused.headers.location),
      });
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers['content-type']), /text\/html/);
      assert.match(page.body, /לא ניתן למכור דירה עם שכירות פעילה/);
      const after = await pool.query<{ tenure: string; status: string }>(
        `SELECT u.tenure, t.status FROM unit u
           JOIN tenancy t ON t.unit_id = u.unit_id
          WHERE u.unit_id = $1`,
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_RENT');
      assert.equal(after.rows[0]?.status, 'ACTIVE');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('a sold flat stays sold, and the page says so', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan('SOLD'), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'FOR_RENT' }).toString(),
      });
      assert.equal(refused.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: String(refused.headers.location),
      });
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers['content-type']), /text\/html/);
      assert.match(page.body, /דירה שנמכרה נשארת נמכרה/);
      const after = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'SOLD');
      const audits = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'estate.tenure' AND subject_id = $1`,
        [unitId],
      );
      assert.equal(audits.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('posting the tenure the flat already has writes nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan('SOLD'), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const saved = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'SOLD' }).toString(),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/estate/units/${unitId}`);
      const audits = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'estate.tenure' AND subject_id = $1`,
        [unitId],
      );
      assert.equal(audits.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('a designation for sale can be withdrawn, including on a let flat', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         RETURNING terms_profile_id`,
        [newId(), 'tenure screen annex'],
      );
      await pool.query(
        `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
         VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
        [newId(), unitId, profile.rows[0]?.terms_profile_id],
      );
      const marked = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'FOR_SALE' }).toString(),
      });
      assert.equal(marked.statusCode, 303);
      const midway = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(midway.rows[0]?.tenure, 'FOR_SALE');
      const withdrawn = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'FOR_RENT' }).toString(),
      });
      assert.equal(withdrawn.statusCode, 303);
      const after = await pool.query<{ tenure: string; status: string }>(
        `SELECT u.tenure, t.status FROM unit u
           JOIN tenancy t ON t.unit_id = u.unit_id WHERE u.unit_id = $1`,
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_RENT');
      assert.equal(after.rows[0]?.status, 'ACTIVE');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('rejects a tenure outside the three and leaves the flat', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'LEASED' }).toString(),
      });
      assert.equal(refused.statusCode, 400);
      assert.equal(refused.json().code, 'invalid');
      const after = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_RENT');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('an operator sees no tenure form and cannot post', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const operator = await signIn(pool, systemClock, {
      email: `ops@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, operator);
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const seeded = await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id WHERE s.building_id = $1',
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const page = await client.inject({
        method: 'GET',
        url: `/estate/units/${unitId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(page.body, /ייעוד הדירה/);
      assert.doesNotMatch(page.body, /name="tenure"/);
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}/tenure`,
        headers: FORM,
        payload: new URLSearchParams({ tenure: 'FOR_SALE' }).toString(),
      });
      assert.equal(refused.statusCode, 403);
      assert.equal(refused.json().code, 'not_allowed');
      const after = await pool.query<{ tenure: string }>(
        'SELECT tenure FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.tenure, 'FOR_RENT');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
