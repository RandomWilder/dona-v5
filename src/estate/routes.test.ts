// The routes, driven the way a phone drives them. Slice 1.11.
//
// `app.inject` runs the route without binding a socket, so the suite never races a port — the same
// reason src/app.test.ts uses it.
//
// Unlike every other suite here this one **commits**, because the routes read through the pool and a
// rolled-back transaction is invisible to them. So the fixture carries an address of its own and the
// cleanup deletes exactly it: a suite that truncated `building` would wipe whatever `npm run seed`
// had put in a developer's database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../app.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';

const CITY = 'עיר בדיקה';
const ADDRESS = 'רחוב בדיקה 1';
const PROJECT_CODE = 'TEST-ROUTES';

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז בדיקה',
      projectCode: PROJECT_CODE,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין בדיקה',
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT_CODE,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [
        { kind: 'UNIT', name: 'דירה 12A', floor: '2', accessNote: null },
        { kind: 'COMMON', name: 'לובי', floor: 'קרקע', accessNote: null },
      ],
      units: [
        {
          spaceName: 'דירה 12A',
          unitNumber: '12A',
          rooms: 3.5,
          areaSqm: 78.5,
          hasMamad: true,
          parkingSpaceName: null,
          storageSpaceName: null,
          warrantyEndDate: null,
          conditionStatus: 'READY',
        },
      ],
    },
  ],
};

describe('estate · the routes', () => {
  it('serves the week-1 surface', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    let buildingId = '';
    try {
      await importEstate(pool, plan);
      const found = await pool.query<{ building_id: string }>(
        'SELECT building_id FROM building WHERE city = $1 AND address_line = $2',
        [CITY, ADDRESS],
      );
      buildingId = found.rows[0].building_id;

      await t.test('the root is the one screen there is', async () => {
        const response = await app.inject({ method: 'GET', url: '/' });
        assert.equal(response.statusCode, 302);
        assert.equal(response.headers.location, '/estate');
      });

      await t.test(
        'the buildings list is HTML and names the building',
        async () => {
          const response = await app.inject({ method: 'GET', url: '/estate' });
          assert.equal(response.statusCode, 200);
          assert.match(
            String(response.headers['content-type']),
            /text\/html; charset=utf-8/,
          );
          assert.equal(response.headers['x-content-type-options'], 'nosniff');
          assert.match(response.body, /בניין בדיקה/);
          assert.match(
            response.body,
            new RegExp(`/estate/buildings/${buildingId}`),
          );
        },
      );

      await t.test('the building screen names its units', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/estate/buildings/${buildingId}`,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /דירה <span dir="ltr">12A<\/span>/);
        assert.match(response.body, /ממ״ד/);
      });

      await t.test('the stylesheet the screens link to is served', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/ui/tokens.css',
        });
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers['content-type']), /text\/css/);
      });

      await t.test(
        'a malformed id is invalid, a missing one is not_found',
        async () => {
          const malformed = await app.inject({
            method: 'GET',
            url: '/estate/buildings/not-an-id',
          });
          assert.equal(malformed.statusCode, 400);
          assert.equal(malformed.json().code, 'invalid');

          const missing = await app.inject({
            method: 'GET',
            url: '/estate/buildings/11111111-1111-4111-8111-111111111111',
          });
          assert.equal(missing.statusCode, 404);
          assert.equal(missing.json().code, 'not_found');
          // The refusal says not_found and nothing more (SPEC.md error shape).
          assert.equal(missing.json().message, 'building not found');
        },
      );
    } finally {
      // Precise, and in dependency order. Nothing else in the database is touched.
      await pool
        .query(
          `DELETE FROM unit WHERE unit_id IN (
             SELECT space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY, ADDRESS],
        )
        .catch(() => {});
      await pool
        .query(
          `DELETE FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
          [CITY, ADDRESS],
        )
        .catch(() => {});
      await pool
        .query('DELETE FROM building WHERE city = $1 AND address_line = $2', [
          CITY,
          ADDRESS,
        ])
        .catch(() => {});
      await pool
        .query('DELETE FROM project WHERE project_code = $1', [PROJECT_CODE])
        .catch(() => {});
      await app.close();
      await pool.end();
    }
  });
});
