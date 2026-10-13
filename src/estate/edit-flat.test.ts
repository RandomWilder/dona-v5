// #210. An admin corrects a seeded flat from its page. The five facts, and 0066's three, update in place.
// A letting does not block it, and nothing is appended to estate_event.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan, UnitPlan } from './contract.ts';
import { seedBuilding } from './contract.ts';

const DOMAIN = 'estate-edit-flat.test';
const CITY = 'עיר עריכת דירה';
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

function plan(): EstatePlan {
  return {
    projects: [],
    buildings: [
      {
        name: 'בניין עריכה',
        addressLine: 'רחוב עריכה 4',
        city: CITY,
        projectCode: null,
        handoverDate: '2026-09-01',
        warrantyEndDate: '2028-09-01',
        status: 'ACTIVE',
        spaces: [{ kind: 'UNIT', name: '1', floor: '1', accessNote: null }],
        units: [flat('1')],
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
    .query('DELETE FROM terms_profile WHERE name = $1', ['edit flat annex'])
    .catch(() => {});
}

/** The form as a browser posts it. A null override leaves the field out, as an unticked box is. */
function correction(overrides: Record<string, string | null> = {}): string {
  const fields: Record<string, string | null> = {
    rooms: '4.5',
    floor: 'קרקע',
    area_sqm: '88',
    flat_type: 'P1',
    balcony_sqm: '12.5',
    garden_sqm: '96.89',
    sukkah_balcony: 'on',
    attached_storage: 'GARDEN',
    ...overrides,
  };
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) form.set(key, value);
  }
  return form.toString();
}

describe('estate · edit a flat after it is seeded', () => {
  it('an admin corrects rooms, floor, area, type and balcony, and writes no estate event', async (t) => {
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
      assert.match(page.body, new RegExp(`action="/estate/units/${unitId}"`));
      assert.match(page.body, /name="rooms"[^>]*value="4"/);
      assert.match(page.body, /name="floor"[^>]*value="1"/);
      assert.match(page.body, /name="area_sqm"[^>]*value="90"/);
      assert.match(page.body, /name="flat_type"[^>]*value="BG"/);
      assert.match(page.body, /name="balcony_sqm"[^>]*value=""/);
      assert.match(page.body, /name="garden_sqm"[^>]*value=""/);
      assert.match(page.body, /name="sukkah_balcony" type="checkbox"/);
      assert.match(
        page.body,
        /<select id="attached_storage" name="attached_storage">/,
      );

      const saved = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}`,
        headers: FORM,
        payload: correction(),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/estate/units/${unitId}`);

      const after = await pool.query<{
        rooms: string;
        floor: string | null;
        area_sqm: string;
        flat_type: string | null;
        balcony_sqm: string | null;
        garden_sqm: string | null;
        sukkah_balcony: boolean;
        attached_storage: string | null;
        unit_number: string;
        has_mamad: boolean;
        tenure: string;
        condition_status: string;
        warranty_end_date: string | null;
        parking_space_id: string | null;
        storage_space_id: string | null;
      }>(
        `SELECT u.rooms::text, s.floor, u.area_sqm::text, u.flat_type,
                u.balcony_sqm::text, u.garden_sqm::text, u.sukkah_balcony,
                u.attached_storage, u.unit_number, u.has_mamad, u.tenure,
                u.condition_status, u.warranty_end_date::text,
                u.parking_space_id, u.storage_space_id
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE u.unit_id = $1`,
        [unitId],
      );
      const row = after.rows[0];
      assert.equal(row?.rooms, '4.5');
      assert.equal(row?.floor, 'קרקע');
      assert.equal(row?.area_sqm, '88');
      assert.equal(row?.flat_type, 'P1');
      assert.equal(row?.balcony_sqm, '12.5');
      assert.equal(row?.garden_sqm, '96.89');
      assert.equal(row?.sukkah_balcony, true);
      assert.equal(row?.attached_storage, 'GARDEN');
      assert.equal(row?.unit_number, '1');
      assert.equal(row?.has_mamad, true);
      assert.equal(row?.tenure, 'FOR_RENT');
      assert.equal(row?.condition_status, 'READY');
      assert.equal(row?.warranty_end_date, null);
      assert.equal(row?.parking_space_id, null);
      assert.equal(row?.storage_space_id, null);

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

  it('rejects a bad number at the edge and leaves the flat as seeded', async (t) => {
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
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      for (const [label, payload] of [
        ['rooms', correction({ rooms: 'שלוש' })],
        ['rooms, over', correction({ rooms: '21' })],
        ['area', correction({ area_sqm: '78,5' })],
        ['balcony', correction({ balcony_sqm: '-1' })],
        ['garden', correction({ garden_sqm: '-1' })],
        ['attached storage', correction({ attached_storage: 'ROOF' })],
        ['floor', correction({ floor: 'ק'.repeat(33) })],
        ['type', correction({ flat_type: 'A'.repeat(33) })],
      ] as Array<[string, string]>) {
        const response = await client.inject({
          method: 'POST',
          url: `/estate/units/${unitId}`,
          headers: FORM,
          payload,
        });
        assert.equal(response.statusCode, 400, label);
        assert.equal(response.json().code, 'invalid', label);
      }
      const after = await pool.query<{
        rooms: string;
        flat_type: string | null;
        floor: string | null;
      }>(
        `SELECT u.rooms::text, u.flat_type, s.floor
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE u.unit_id = $1`,
        [unitId],
      );
      assert.equal(after.rows[0]?.rooms, '4');
      assert.equal(after.rows[0]?.flat_type, 'BG');
      assert.equal(after.rows[0]?.floor, '1');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('a blank optional field clears it', async (t) => {
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
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const cleared = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}`,
        headers: FORM,
        payload: correction({
          rooms: '4',
          floor: '',
          area_sqm: '',
          flat_type: '',
          balcony_sqm: '',
          garden_sqm: '',
          sukkah_balcony: null,
          attached_storage: '',
        }),
      });
      assert.equal(cleared.statusCode, 303);
      const after = await pool.query<{
        rooms: string;
        floor: string | null;
        area_sqm: string | null;
        flat_type: string | null;
        balcony_sqm: string | null;
        garden_sqm: string | null;
        sukkah_balcony: boolean;
        attached_storage: string | null;
      }>(
        `SELECT u.rooms::text, s.floor, u.area_sqm::text, u.flat_type, u.balcony_sqm::text,
                u.garden_sqm::text, u.sukkah_balcony, u.attached_storage
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE u.unit_id = $1`,
        [unitId],
      );
      assert.equal(after.rows[0]?.rooms, '4');
      assert.equal(after.rows[0]?.floor, null);
      assert.equal(after.rows[0]?.area_sqm, null);
      assert.equal(after.rows[0]?.flat_type, null);
      assert.equal(after.rows[0]?.balcony_sqm, null);
      assert.equal(after.rows[0]?.garden_sqm, null);
      assert.equal(after.rows[0]?.sukkah_balcony, false);
      assert.equal(after.rows[0]?.attached_storage, null);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('an operator sees the facts and cannot post', async (t) => {
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
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const page = await client.inject({
        method: 'GET',
        url: `/estate/units/${unitId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /חדרים<\/dt><dd><span dir="ltr">4<\/span>/);
      assert.match(page.body, /קומה<\/dt><dd><span dir="ltr">1<\/span>/);
      assert.match(page.body, /<span dir="ltr">90<\/span> מ״ר/);
      assert.doesNotMatch(page.body, /עריכת פרטי הדירה/);
      assert.doesNotMatch(page.body, /name="rooms"/);
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}`,
        headers: FORM,
        payload: correction(),
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
      const after = await pool.query<{ rooms: string }>(
        'SELECT rooms::text FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(after.rows[0]?.rooms, '4');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('corrects a flat that already has a letting', async (t) => {
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
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      const unitId = seeded.rows[0]?.unit_id ?? '';
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         RETURNING terms_profile_id`,
        [newId(), 'edit flat annex'],
      );
      await pool.query(
        `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
         VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
        [newId(), unitId, profile.rows[0]?.terms_profile_id],
      );
      const saved = await client.inject({
        method: 'POST',
        url: `/estate/units/${unitId}`,
        headers: FORM,
        payload: correction({ rooms: '3.5' }),
      });
      assert.equal(saved.statusCode, 303);
      const after = await pool.query<{ rooms: string; status: string }>(
        `SELECT u.rooms::text, t.status
           FROM unit u JOIN tenancy t ON t.unit_id = u.unit_id
          WHERE u.unit_id = $1`,
        [unitId],
      );
      assert.equal(after.rows[0]?.rooms, '3.5');
      assert.equal(after.rows[0]?.status, 'ACTIVE');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
