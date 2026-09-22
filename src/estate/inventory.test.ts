// #149 — נכסים HTTP: tab, create, mint, grouped list.
//
// Same seam as A11/A13 in routes.test.ts. Commits, so the fixture has its own city and cleanup
// deletes exactly that building.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
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
    `DELETE FROM audit_log
       WHERE action IN (
         'estate.inventory_mint',
         'estate.inventory_add',
         'estate.inventory_remove'
       )
       AND (
         subject_id IN (SELECT building_id::text FROM building WHERE city = $1)
         OR subject_id IN (
           SELECT s.space_id::text FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1
         )
         OR inputs->>'buildingId' IN (
           SELECT building_id::text FROM building WHERE city = $1
         )
       )`,
    `DELETE FROM tenancy_party WHERE tenancy_id IN (
       SELECT t.tenancy_id FROM tenancy t
       JOIN space s ON s.space_id = t.unit_id
       JOIN building b ON b.building_id = s.building_id
       WHERE b.city = $1)`,
    `DELETE FROM tenancy WHERE unit_id IN (
       SELECT space_id FROM space s
       JOIN building b ON b.building_id = s.building_id
       WHERE b.city = $1)`,
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
  it('adds named Spaces by count and first number and refuses a colliding name', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `add@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({
          storage_count: '0',
          storage_first: '',
          elevator_count: '0',
        }),
      });
      assert.equal(created.statusCode, 303);
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      await pool.query(
        `UPDATE unit SET rooms = 4
          WHERE unit_id IN (
            SELECT s.space_id FROM space s
             WHERE s.building_id = $1 AND s.space_kind = 'UNIT' AND s.name = '10'
          )`,
        [buildingId],
      );

      const page = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(
        page.body,
        new RegExp(`/estate/inventory/${buildingId}/spaces`),
      );

      const added = await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/spaces`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_count: '2',
          unit_first: '13',
          parking_count: '1',
          parking_first: '52',
          storage_count: '0',
          elevator_count: '0',
        }).toString(),
      });
      assert.equal(added.statusCode, 303);
      assert.equal(added.headers.location, `/estate/inventory/${buildingId}`);

      const listed = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.match(listed.body, /<span dir="ltr">13<\/span>/);
      assert.match(listed.body, /<span dir="ltr">14<\/span>/);
      assert.match(listed.body, /<span dir="ltr">52<\/span>/);
      assert.match(listed.body, /דירות · <span dir="ltr">5<\/span>/);

      const collision = await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/spaces`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_count: '1',
          unit_first: '10',
          parking_count: '0',
          storage_count: '0',
          elevator_count: '0',
        }).toString(),
      });
      assert.equal(collision.statusCode, 409);
      assert.equal(collision.json().code, 'conflict');
      const rooms = await pool.query<{ rooms: string }>(
        `SELECT rooms::text AS rooms FROM unit
          WHERE unit_id IN (
            SELECT s.space_id FROM space s
             WHERE s.building_id = $1 AND s.space_kind = 'UNIT' AND s.name = '10'
          )`,
        [buildingId],
      );
      assert.equal(rooms.rows[0]?.rooms, '4');
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

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
      assert.match(detail.body, /דירות · <span dir="ltr">3<\/span>/);
      assert.match(detail.body, /דירות פנויות · <span dir="ltr">3<\/span>/);
      assert.match(detail.body, /חניות · <span dir="ltr">2<\/span>/);
      assert.match(detail.body, /חניות פנויות · <span dir="ltr">2<\/span>/);
      assert.match(detail.body, /מחסנים · <span dir="ltr">1<\/span>/);
      assert.match(detail.body, /מחסנים פנויים · <span dir="ltr">1<\/span>/);
      assert.match(
        detail.body,
        /<span dir="ltr">10<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.match(
        detail.body,
        /<span dir="ltr">50<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.match(
        detail.body,
        /<span dir="ltr">7<\/span><span class="chip">פנויה<\/span>/,
      );
      const technical = detail.body.split('<h2>חללים טכניים</h2>')[1] ?? '';
      assert.doesNotMatch(technical, /chip/);
      assert.doesNotMatch(detail.body, /דמי שכירות/);
      assert.doesNotMatch(detail.body, /תום חוזה/);

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
      const shared = detail.body.split('<h2>שטחים משותפים</h2>')[1] ?? '';
      assert.doesNotMatch(shared, /chip/);
      assert.doesNotMatch(detail.body, /הוספת חללים/);
      assert.doesNotMatch(detail.body, /מקום משותף/);

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
      const add = await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/spaces`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_count: '1',
          unit_first: '99',
          parking_count: '0',
          storage_count: '0',
          elevator_count: '0',
        }).toString(),
      });
      assert.equal(add.statusCode, 403);
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

  it('occupies only the Unit and the assigned bay and storage of a letting that counts today', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `occupancy@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    const partyName = 'נכסים occupancy tenant';
    const profileName = `נכסים occupancy ${DOMAIN}`;
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({ storage_count: '2', storage_first: '7' }),
      });
      assert.equal(created.statusCode, 303);
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      const spaces = await pool.query<{
        space_id: string;
        space_kind: string;
        name: string;
      }>(
        `SELECT space_id, space_kind, name FROM space
          WHERE building_id = $1`,
        [buildingId],
      );
      const idOf = (kind: string, name: string) =>
        spaces.rows.find((row) => row.space_kind === kind && row.name === name)
          ?.space_id ?? '';
      const unit10 = idOf('UNIT', '10');
      const unit11 = idOf('UNIT', '11');
      const unit12 = idOf('UNIT', '12');
      const bay50 = idOf('PARKING', '50');
      const bay51 = idOf('PARKING', '51');
      const store7 = idOf('STORAGE', '7');
      const store8 = idOf('STORAGE', '8');

      await pool.query(
        `UPDATE unit SET parking_space_id = $1, storage_space_id = $2
          WHERE unit_id = $3`,
        [bay51, store8, unit11],
      );

      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), profileName],
      );
      const live = newId();
      const ended = newId();
      const partyId = newId();
      await pool.query(
        `INSERT INTO party (party_id, party_kind, full_name)
         VALUES ($1, 'PERSON', $2)`,
        [partyId, partyName],
      );
      await pool.query(
        `INSERT INTO tenancy (
           tenancy_id, unit_id, start_date, end_date, status,
           terms_profile_id, parking_space_id, storage_space_id)
         VALUES ($1, $2, '2020-01-01', '2099-12-31', 'ACTIVE', $3, $4, $5)`,
        [live, unit10, profile.rows[0]?.terms_profile_id, bay50, store7],
      );
      await pool.query(
        `INSERT INTO tenancy (
           tenancy_id, unit_id, start_date, end_date, status,
           terms_profile_id, parking_space_id, storage_space_id)
         VALUES ($1, $2, '2020-01-01', '2020-12-31', 'ENDED', $3, $4, $5)`,
        [ended, unit12, profile.rows[0]?.terms_profile_id, bay51, store8],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'PRIMARY_TENANT', true),
                ($3, $2, 'PRIMARY_TENANT', true)`,
        [live, partyId, ended],
      );

      const page = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /דירות פנויות · <span dir="ltr">2<\/span>/);
      assert.match(page.body, /חניות פנויות · <span dir="ltr">1<\/span>/);
      assert.match(page.body, /מחסנים פנויים · <span dir="ltr">1<\/span>/);
      assert.match(
        page.body,
        /<span dir="ltr">10<\/span><span class="chip">מאוכלסת<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">11<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">12<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">50<\/span><span class="chip">תפוסה<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">51<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">7<\/span><span class="chip">תפוסה<\/span>/,
      );
      assert.match(
        page.body,
        /<span dir="ltr">8<\/span><span class="chip">פנויה<\/span>/,
      );
      assert.doesNotMatch(page.body, /דמי שכירות/);
    } finally {
      await cleanup(pool);
      await pool.query('DELETE FROM party WHERE full_name = $1', [partyName]);
      await pool.query('DELETE FROM terms_profile WHERE name = $1', [
        profileName,
      ]);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('continues elevator TECHNICAL names so they do not collide with 1…N', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `elev@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({
          parking_count: '0',
          parking_first: '',
          storage_count: '0',
          storage_first: '',
          elevator_count: '2',
        }),
      });
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      const added = await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/spaces`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_count: '0',
          parking_count: '0',
          storage_count: '0',
          elevator_count: '1',
        }).toString(),
      });
      assert.equal(added.statusCode, 303);
      const names = await pool.query<{ name: string }>(
        `SELECT name FROM space
          WHERE building_id = $1 AND space_kind = 'TECHNICAL'
          ORDER BY name`,
        [buildingId],
      );
      assert.deepEqual(
        names.rows.map((row) => row.name),
        ['1', '2', '3'],
      );
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('removes an unreferenced Space and refuses a referenced one by name', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `remove@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    const partyName = 'נכסים remove tenant';
    const profileName = `נכסים remove ${DOMAIN}`;
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/estate/inventory',
        headers: FORM,
        payload: mintForm({
          unit_count: '2',
          unit_first: '10',
          parking_count: '2',
          parking_first: '50',
          storage_count: '0',
          storage_first: '',
          elevator_count: '1',
        }),
      });
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      const spaces = await pool.query<{
        space_id: string;
        space_kind: string;
        name: string;
      }>(
        'SELECT space_id, space_kind, name FROM space WHERE building_id = $1',
        [buildingId],
      );
      const idOf = (kind: string, name: string) =>
        spaces.rows.find((row) => row.space_kind === kind && row.name === name)
          ?.space_id ?? '';
      const unit10 = idOf('UNIT', '10');
      const unit11 = idOf('UNIT', '11');
      const bay50 = idOf('PARKING', '50');
      const bay51 = idOf('PARKING', '51');
      const lift = idOf('TECHNICAL', '1');
      const filedType = `inventory-remove-${DOMAIN}`;
      const type = await pool.query<{ document_type_id: string }>(
        `INSERT INTO document_type (
           document_type_id, type_key, label_he, label_en, verification_terms, is_active
         ) VALUES ($1, $2, 'מסמך', NULL, NULL, true)
         ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
         RETURNING document_type_id`,
        [newId(), filedType],
      );
      const documentId = newId();
      await pool.query(
        `INSERT INTO document (
           document_id, document_type_id, storage_uri, file_hash,
           ingested_at, verification_verdict
         ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
        [
          documentId,
          type.rows[0]?.document_type_id,
          `gs://x/${documentId}.pdf`,
          `hash-${documentId}`,
          new Date('2026-09-22T12:00:00.000Z'),
        ],
      );
      await pool.query(
        `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
         VALUES ($1, 'SPACE', $2, 'SUBJECT')`,
        [documentId, lift],
      );
      const filed = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${lift}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(filed.statusCode, 409);
      assert.match(filed.json().message, /document/);
      await pool.query('DELETE FROM document_link WHERE document_id = $1', [
        documentId,
      ]);
      await pool.query('DELETE FROM document WHERE document_id = $1', [
        documentId,
      ]);
      await pool.query('DELETE FROM document_type WHERE type_key = $1', [
        filedType,
      ]);

      const gone = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${lift}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(gone.statusCode, 303);
      const left = await pool.query(`SELECT 1 FROM space WHERE space_id = $1`, [
        lift,
      ]);
      assert.equal(left.rowCount, 0);

      await pool.query(
        `UPDATE unit SET parking_space_id = $1 WHERE unit_id = $2`,
        [bay51, unit11],
      );
      const built = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${bay51}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(built.statusCode, 409);
      assert.match(built.json().message, /built parking or storage/);
      const stillBay = await pool.query(
        'SELECT 1 FROM space WHERE space_id = $1',
        [bay51],
      );
      assert.equal(stillBay.rowCount, 1);

      await pool.query(
        `INSERT INTO asset (asset_id, space_id, asset_class, asset_type,
                            compliance_regime, status)
         VALUES ($1, $2, 'UTILITY', 'INTERCOM', 'NONE', 'IN_SERVICE')`,
        [newId(), unit11],
      );
      const withAsset = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${unit11}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(withAsset.statusCode, 409);
      assert.match(withAsset.json().message, /asset/);

      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), profileName],
      );
      const partyId = newId();
      await pool.query(
        `INSERT INTO party (party_id, party_kind, full_name)
         VALUES ($1, 'PERSON', $2)`,
        [partyId, partyName],
      );
      const tenancyId = newId();
      await pool.query(
        `INSERT INTO tenancy (
           tenancy_id, unit_id, start_date, end_date, status,
           terms_profile_id, parking_space_id)
         VALUES ($1, $2, '2020-01-01', '2099-12-31', 'ACTIVE', $3, $4)`,
        [tenancyId, unit10, profile.rows[0]?.terms_profile_id, bay50],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
        [tenancyId, partyId],
      );
      const letUnit = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${unit10}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(letUnit.statusCode, 409);
      assert.match(letUnit.json().message, /letting/);
      const letBay = await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${bay50}/remove`,
        headers: FORM,
        payload: '',
      });
      assert.equal(letBay.statusCode, 409);
      assert.match(letBay.json().message, /letting/);
    } finally {
      await cleanup(pool);
      await pool.query('DELETE FROM party WHERE full_name = $1', [partyName]);
      await pool.query('DELETE FROM terms_profile WHERE name = $1', [
        profileName,
      ]);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('adds a shared Space by kind and typed name onto the grouped list', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `shared@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const created = await client.inject({
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
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      const added = await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/shared`,
        headers: FORM,
        payload: new URLSearchParams({
          space_kind: 'COMMON',
          name: 'לובי',
        }).toString(),
      });
      assert.equal(added.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      const shared = page.body.split('<h2>שטחים משותפים</h2>')[1] ?? '';
      assert.match(shared, /לובי/);
      assert.doesNotMatch(shared.split('<h2>')[0] ?? shared, /chip/);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('writes one audit line per later Space and never estate_event', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `audit@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const created = await client.inject({
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
      const buildingId = String(created.headers.location ?? '')
        .split('/')
        .at(-1);
      await client.inject({
        method: 'POST',
        url: `/estate/inventory/${buildingId}/spaces`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_count: '2',
          unit_first: '20',
          parking_count: '0',
          storage_count: '0',
          elevator_count: '0',
        }).toString(),
      });
      const added = await pool.query<{
        space_id: string;
        name: string;
      }>(
        `SELECT space_id, name FROM space
          WHERE building_id = $1 AND space_kind = 'UNIT' AND name IN ('20', '21')
          ORDER BY name`,
        [buildingId],
      );
      const audits = await pool.query<{
        action: string;
        subject_id: string;
        inputs: { kind: string; name: string };
      }>(
        `SELECT action, subject_id, inputs FROM audit_log
          WHERE action = 'estate.inventory_add'
            AND subject_id = ANY($1::text[])
          ORDER BY inputs->>'name'`,
        [added.rows.map((row) => row.space_id)],
      );
      assert.equal(audits.rowCount, 2);
      assert.equal(audits.rows[0]?.inputs.kind, 'UNIT');
      assert.equal(audits.rows[0]?.inputs.name, '20');
      assert.equal(audits.rows[1]?.inputs.name, '21');

      const drop = added.rows[1]?.space_id ?? '';
      await client.inject({
        method: 'POST',
        url: `/estate/inventory/spaces/${drop}/remove`,
        headers: FORM,
        payload: '',
      });
      const removed = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'estate.inventory_remove' AND subject_id = $1`,
        [drop],
      );
      assert.equal(removed.rows[0]?.n, '1');
      const events = await pool.query(
        'SELECT 1 FROM estate_event WHERE building_id = $1',
        [buildingId],
      );
      assert.equal(events.rowCount, 0);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
