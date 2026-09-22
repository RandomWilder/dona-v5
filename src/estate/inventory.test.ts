// #149 — נכסים HTTP: tab, create, mint, grouped list.
//
// Same seam as A11/A13 in routes.test.ts. Commits, so the fixture has its own city and cleanup
// deletes exactly that building.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';

const DOMAIN = 'estate-inventory.test';
const CITY = 'עיר נכסים';
const ADDRESS = 'רחוב נכסים 9';
const IMPORTED_CITY = 'עיר נכסים יבוא';
const IMPORTED_ADDRESS = 'רחוב יבוא 3';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function mintForm(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    name: 'בניין נכסים',
    address_line: ADDRESS,
    city: CITY,
    project_code: '',
    handover_date: '2025-03-01',
    warranty_end_date: '',
    status: 'ACTIVE',
    unit_count: '3',
    unit_first: '10',
    parking_count: '2',
    parking_first: '50',
    storage_count: '1',
    storage_first: '7',
    elevator_count: '2',
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

async function cleanupCity(
  pool: {
    query: (text: string, values?: unknown[]) => Promise<unknown>;
  },
  city: string,
): Promise<void> {
  for (const statement of [
    `DELETE FROM asset WHERE space_id IN (
       SELECT space_id FROM space s
       JOIN building b ON b.building_id = s.building_id
       WHERE b.city = $1)`,
    `DELETE FROM audit_log WHERE action = 'estate.inventory_mint'
       AND subject_id IN (SELECT building_id::text FROM building WHERE city = $1)`,
    `DELETE FROM unit WHERE unit_id IN (
       SELECT space_id FROM space s
       JOIN building b ON b.building_id = s.building_id
       WHERE b.city = $1)`,
    `DELETE FROM space WHERE building_id IN (
       SELECT building_id FROM building WHERE city = $1)`,
    'DELETE FROM building WHERE city = $1',
  ]) {
    await pool.query(statement, [city]).catch(() => {});
  }
}

async function cleanup(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await cleanupCity(pool, CITY);
  await cleanupCity(pool, IMPORTED_CITY);
}

const imported: EstatePlan = {
  projects: [],
  buildings: [
    {
      name: 'בניין מיובא',
      addressLine: IMPORTED_ADDRESS,
      city: IMPORTED_CITY,
      projectCode: null,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [
        { kind: 'UNIT', name: '12A', floor: '2', accessNote: null },
        { kind: 'COMMON', name: 'לובי', floor: 'קרקע', accessNote: null },
      ],
      units: [
        {
          spaceName: '12A',
          unitNumber: '12A',
          rooms: 3,
          areaSqm: null,
          hasMamad: false,
          parkingSpaceName: null,
          storageSpaceName: null,
          warrantyEndDate: null,
          conditionStatus: 'READY',
        },
      ],
    },
  ],
};

describe('estate · נכסים, tab create and mint', () => {
  it('mints named Spaces on one save and lists them grouped by kind', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const rail = await client.inject({ method: 'GET', url: '/estate' });
      assert.equal(rail.statusCode, 200);
      assert.match(rail.body, />בניינים</);
      assert.match(rail.body, /href="\/estate\/inventory"/);
      assert.match(rail.body, />נכסים</);
      assert.match(rail.body, /href="\/estate"/);

      const form = await client.inject({
        method: 'GET',
        url: '/estate/inventory/new',
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /action="\/estate\/inventory"/);
      assert.match(form.body, /name="unit_count"/);
      assert.match(form.body, /name="elevator_count"/);

      const created = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm(),
      });
      assert.equal(created.statusCode, 303);
      const location = String(created.headers.location ?? '');
      assert.match(location, /^\/estate\/inventory\/[0-9a-f-]{36}$/);

      const building = await pool.query<{ building_id: string }>(
        'SELECT building_id FROM building WHERE city = $1',
        [CITY],
      );
      assert.equal(building.rowCount, 1);
      const buildingId = building.rows[0]?.building_id ?? '';

      const spaces = await pool.query<{
        space_kind: string;
        name: string;
        floor: string | null;
      }>(
        `SELECT space_kind, name, floor
           FROM space WHERE building_id = $1
           ORDER BY space_kind, name`,
        [buildingId],
      );
      const named = (kind: string) =>
        spaces.rows
          .filter((row) => row.space_kind === kind)
          .map((row) => row.name);
      assert.deepEqual(named('UNIT'), ['10', '11', '12']);
      assert.deepEqual(named('PARKING'), ['50', '51']);
      assert.deepEqual(named('STORAGE'), ['7']);
      assert.deepEqual(named('TECHNICAL'), ['1', '2']);
      assert.equal(
        spaces.rows.every((row) => row.floor === null),
        true,
      );

      const units = await pool.query<{
        unit_number: string;
        rooms: string;
        condition_status: string;
        parking_space_id: string | null;
        storage_space_id: string | null;
      }>(
        `SELECT u.unit_number, u.rooms::text AS rooms, u.condition_status,
                u.parking_space_id, u.storage_space_id
           FROM unit u
           JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1
          ORDER BY u.unit_number`,
        [buildingId],
      );
      assert.deepEqual(
        units.rows.map((row) => row.unit_number),
        ['10', '11', '12'],
      );
      assert.equal(
        units.rows.every((row) => row.rooms === '0'),
        true,
      );
      assert.equal(
        units.rows.every((row) => row.condition_status === 'READY'),
        true,
      );
      assert.equal(
        units.rows.every(
          (row) =>
            row.parking_space_id === null && row.storage_space_id === null,
        ),
        true,
      );

      const assets = await pool.query(
        `SELECT 1 FROM asset WHERE space_id IN (
           SELECT space_id FROM space WHERE building_id = $1)`,
        [buildingId],
      );
      assert.equal(assets.rowCount, 0);

      const listed = await client.inject({
        method: 'GET',
        url: '/estate/inventory',
      });
      assert.equal(listed.statusCode, 200);
      assert.match(listed.body, /בניין נכסים/);
      assert.match(listed.body, new RegExp(`/estate/inventory/${buildingId}`));
      assert.match(listed.body, /data-dest="inventory"/);
      assert.match(listed.body, /aria-current="page"/);

      const detail = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.equal(detail.statusCode, 200);
      assert.match(detail.body, /דירות/);
      assert.match(detail.body, /חניות/);
      assert.match(detail.body, /מחסנים/);
      assert.match(detail.body, /חללים טכניים/);
      assert.match(detail.body, /<span dir="ltr">10<\/span>/);
      assert.match(detail.body, /<span dir="ltr">50<\/span>/);
      assert.match(detail.body, /<span dir="ltr">7<\/span>/);

      const audit = await pool.query<{
        action: string;
        n: string;
        inputs: {
          unitCount: number;
          parkingCount: number;
          storageCount: number;
          elevatorCount: number;
          unitsFrom: string;
          unitsTo: string;
        };
      }>(
        `SELECT action, count(*) OVER ()::text AS n, inputs
           FROM audit_log
          WHERE action = 'estate.inventory_mint' AND subject_id = $1`,
        [buildingId],
      );
      assert.equal(audit.rows[0]?.n, '1');
      assert.equal(audit.rows[0]?.inputs.unitCount, 3);
      assert.equal(audit.rows[0]?.inputs.parkingCount, 2);
      assert.equal(audit.rows[0]?.inputs.storageCount, 1);
      assert.equal(audit.rows[0]?.inputs.elevatorCount, 2);
      assert.equal(audit.rows[0]?.inputs.unitsFrom, '10');
      assert.equal(audit.rows[0]?.inputs.unitsTo, '12');

      const events = await pool.query(
        'SELECT 1 FROM estate_event WHERE building_id = $1',
        [buildingId],
      );
      assert.equal(events.rowCount, 0);

      const again = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({ name: 'בניין נכסים — שם מתוקן' }),
      });
      assert.equal(again.statusCode, 303);
      const second = await pool.query<{ building_id: string; name: string }>(
        'SELECT building_id, name FROM building WHERE city = $1',
        [CITY],
      );
      assert.equal(second.rowCount, 1);
      assert.equal(second.rows[0]?.building_id, buildingId);
      assert.equal(second.rows[0]?.name, 'בניין נכסים — שם מתוקן');
      const auditAgain = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'estate.inventory_mint' AND subject_id = $1`,
        [buildingId],
      );
      assert.equal(auditAgain.rows[0]?.n, '1');

      const buildings = await client.inject({
        method: 'GET',
        url: '/estate',
      });
      assert.equal(buildings.statusCode, 200);
      assert.match(buildings.body, /בניין נכסים — שם מתוקן/);
      assert.match(buildings.body, /href="\/estate\/buildings\/new"/);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('refuses Units below 1 and zero parking without a first number is fine', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const none = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({ unit_count: '0' }),
      });
      assert.equal(none.statusCode, 400);
      assert.equal(none.json().code, 'invalid');

      const noFirst = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({ parking_first: '' }),
      });
      assert.equal(noFirst.statusCode, 400);

      const empty = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({
          parking_count: '0',
          parking_first: '',
          storage_count: '0',
          storage_first: '',
          elevator_count: '0',
        }),
      });
      assert.equal(empty.statusCode, 303);
      const kinds = await pool.query<{ space_kind: string; n: string }>(
        `SELECT space_kind, count(*)::text AS n
           FROM space s JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1
          GROUP BY space_kind`,
        [CITY],
      );
      const byKind = Object.fromEntries(
        kinds.rows.map((row) => [row.space_kind, row.n]),
      );
      assert.equal(byKind.UNIT, '3');
      assert.equal(byKind.PARKING, undefined);
      assert.equal(byKind.STORAGE, undefined);
      assert.equal(byKind.TECHNICAL, undefined);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('lets a viewer read and refuses the post; imported buildings already appear', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    await importEstate(pool, imported);
    const viewer = await signIn(pool, systemClock, {
      email: `viewer@${DOMAIN}`,
      role: 'VIEWER',
    });
    const client = asOperator(app, viewer);
    try {
      const list = await client.inject({
        method: 'GET',
        url: '/estate/inventory',
      });
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /בניין מיובא/);
      assert.doesNotMatch(list.body, /href="\/estate\/inventory\/new"/);

      const found = await pool.query<{ building_id: string }>(
        'SELECT building_id FROM building WHERE city = $1',
        [IMPORTED_CITY],
      );
      const buildingId = found.rows[0]?.building_id ?? '';
      const detail = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.equal(detail.statusCode, 200);
      assert.match(detail.body, /<span dir="ltr">12A<\/span>/);
      assert.match(detail.body, /לובי/);

      const form = await client.inject({
        method: 'GET',
        url: '/estate/inventory/new',
      });
      assert.equal(form.statusCode, 403);

      const posted = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm(),
      });
      assert.equal(posted.statusCode, 403);
      assert.deepEqual(posted.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
      const rows = await pool.query('SELECT 1 FROM building WHERE city = $1', [
        CITY,
      ]);
      assert.equal(rows.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
