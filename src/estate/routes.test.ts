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
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';

// Slice 5.2: these routes are behind the session now, so the suite holds one. What it asserts is
// unchanged — what changed is that a request without this cookie never reaches the assertion.
const STAFF_DOMAIN = 'estate-routes.test';

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
    await signOutAll(pool, STAFF_DOMAIN);
    const who = await signIn(pool, systemClock, {
      email: `ops@${STAFF_DOMAIN}`,
    });
    const client = asOperator(app, who);
    let buildingId = '';
    let unitId = '';
    try {
      await importEstate(pool, plan);
      const found = await pool.query<{ building_id: string }>(
        'SELECT building_id FROM building WHERE city = $1 AND address_line = $2',
        [CITY, ADDRESS],
      );
      buildingId = found.rows[0].building_id;
      const unit = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
        WHERE s.building_id = $1`,
        [buildingId],
      );
      unitId = unit.rows[0]?.unit_id ?? '';

      // 1.11 made the root a 302 to `/estate` and said it would stop being one the week a second
      // screen existed. Slice 2.6 is that week, and this case is the redirect's obituary: it asserts
      // the index renders and links onward, rather than that the root has moved.
      await t.test('the root is an index of the screens', async () => {
        const response = await client.inject({ method: 'GET', url: '/' });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /href="\/estate"/);
        assert.match(response.body, /href="\/estate\/expiring"/);
        assert.match(response.body, /href="\/estate\/incomplete"/);
        assert.match(response.body, /href="\/estate\/search"/);
      });

      await t.test(
        'the buildings list is HTML and names the building',
        async () => {
          const response = await client.inject({
            method: 'GET',
            url: '/estate',
          });
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
        const response = await client.inject({
          method: 'GET',
          url: `/estate/buildings/${buildingId}`,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /דירה <span dir="ltr">12A<\/span>/);
        assert.match(response.body, /ממ״ד/);
        assert.match(response.body, new RegExp(`/estate/units/${unitId}`));
        assert.match(response.body, /מסמכי הבניין/);
      });

      await t.test(
        'the unit screen is a thin sheet with a documents panel',
        async () => {
          const response = await client.inject({
            method: 'GET',
            url: `/estate/units/${unitId}`,
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /דירה <span dir="ltr">12A<\/span>/);
          assert.match(response.body, /מסמכים/);
          assert.match(response.body, /אין מסמכים בתיק זה עדיין/);
          assert.match(
            response.body,
            new RegExp(`/documents/new\\?unit=${unitId}`),
          );
        },
      );

      await t.test('the stylesheet the screens link to is served', async () => {
        const response = await client.inject({
          method: 'GET',
          url: '/ui/tokens.css',
        });
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers['content-type']), /text\/css/);
      });

      // Slice 2.6's three screens, asserted for their wiring and for the one end-to-end property
      // this fixture can carry honestly. **It seeds no tenancy**: this suite commits, so a lease
      // here would mean cleaning up tenancy, tenancy_party, party, party_contact and terms_profile
      // afterwards, and a suite that leaves a party behind is worse than a case not written here.
      // The occupancy chip's *let* state is proved in src/scope/scope.test.ts against the query and
      // in tests/ui/tokens.test.ts against the markup; what is proved here is the vacant state
      // through the whole stack, which is the one this building can tell the truth about.
      await t.test('a unit with no lease reads as a vacancy', async () => {
        const response = await client.inject({
          method: 'GET',
          url: `/estate/buildings/${buildingId}`,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /פנויה/);
        assert.doesNotMatch(response.body, /מאוכלסת ·/);
      });

      await t.test('search finds the building, and by name only', async () => {
        const found = await client.inject({
          method: 'GET',
          url: `/estate/search?q=${encodeURIComponent('בניין בדיקה')}`,
        });
        assert.equal(found.statusCode, 200);
        assert.match(
          String(found.headers['content-type']),
          /text\/html; charset=utf-8/,
        );
        assert.match(found.body, /בניין בדיקה/);
      });

      await t.test('an empty search asks rather than lists', async () => {
        const empty = await client.inject({
          method: 'GET',
          url: '/estate/search',
        });
        assert.equal(empty.statusCode, 200);
        assert.match(empty.body, /חפשו לפי כתובת/);
      });

      await t.test(
        'a lone wildcard finds nothing, through the stack',
        async () => {
          // The escaping decision, end to end: unescaped this is every building in the portfolio.
          const wild = await client.inject({
            method: 'GET',
            url: '/estate/search?q=%25',
          });
          assert.equal(wild.statusCode, 200);
          assert.match(wild.body, /לא נמצאו/);
        },
      );

      await t.test(
        'the leases ending screen answers for the portfolio',
        async () => {
          const ending = await client.inject({
            method: 'GET',
            url: '/estate/expiring',
          });
          assert.equal(ending.statusCode, 200);
          // No count is asserted. This query is whole-portfolio by design, so its number belongs to
          // whatever else is in the database (1.11, learned in CI within the hour).
          assert.match(ending.body, /חוזים מסתיימים/);
        },
      );

      await t.test(
        'a document-backed draft with no ערב is in the incomplete queue, and an exception clears it',
        async () => {
          const typeId = newId();
          const documentId = newId();
          const tenancyId = newId();
          const partyId = newId();
          const profile = await pool.query<{ terms_profile_id: string }>(
            `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING terms_profile_id`,
            [newId(), `routes-48-${PROJECT_CODE}`],
          );
          await pool.query(
            `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
             VALUES ($1, $2, '2026-03-01', '2027-02-28', 'DRAFT', $3)`,
            [tenancyId, unitId, profile.rows[0]?.terms_profile_id],
          );
          await pool.query(
            `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
            [partyId, 'Tenant of routes-48'],
          );
          await pool.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
            [tenancyId, partyId],
          );
          await pool.query(
            `INSERT INTO document_type (
               document_type_id, type_key, label_he, label_en, verification_terms, is_active
             ) VALUES ($1, $2, 'חוזה שכירות', NULL, NULL, true)`,
            [typeId, `lease-routes-48-${typeId.slice(0, 8)}`],
          );
          await pool.query(
            `INSERT INTO document (
               document_id, document_type_id, storage_uri, file_hash,
               ingested_at, verification_verdict
             ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
            [
              documentId,
              typeId,
              `gs://x/${documentId}.pdf`,
              `hash-${documentId}`,
              new Date('2026-09-08T12:00:00Z'),
            ],
          );
          await pool.query(
            `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
             VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
            [documentId, tenancyId],
          );

          const listed = await client.inject({
            method: 'GET',
            url: '/estate/incomplete',
          });
          assert.equal(listed.statusCode, 200);
          assert.match(listed.body, /חוזים לא שלמים/);
          assert.match(listed.body, /חסר ערב/);
          assert.match(listed.body, new RegExp(`/estate/units/${unitId}`));
          assert.match(
            listed.body,
            new RegExp(`/documents/${documentId}/read`),
          );

          const cleared = await client.inject({
            method: 'POST',
            url: `/estate/incomplete/${tenancyId}/exception`,
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            payload: `reason=${encodeURIComponent('אין ערב על החוזה')}`,
          });
          assert.equal(cleared.statusCode, 302);
          assert.equal(cleared.headers.location, '/estate/incomplete');

          const after = await client.inject({
            method: 'GET',
            url: '/estate/incomplete',
          });
          assert.doesNotMatch(
            after.body,
            new RegExp(`/estate/units/${unitId}`),
          );
        },
      );

      await t.test(
        'a malformed id is invalid, a missing one is not_found',
        async () => {
          const malformed = await client.inject({
            method: 'GET',
            url: '/estate/buildings/not-an-id',
          });
          assert.equal(malformed.statusCode, 400);
          assert.equal(malformed.json().code, 'invalid');

          const missing = await client.inject({
            method: 'GET',
            url: '/estate/buildings/11111111-1111-4111-8111-111111111111',
          });
          assert.equal(missing.statusCode, 404);
          assert.equal(missing.json().code, 'not_found');
          // The refusal says not_found and nothing more (SPEC.md error shape).
          assert.equal(missing.json().message, 'building not found');

          const missingUnit = await client.inject({
            method: 'GET',
            url: '/estate/units/11111111-1111-4111-8111-111111111111',
          });
          assert.equal(missingUnit.statusCode, 404);
          assert.equal(missingUnit.json().code, 'not_found');
          assert.equal(missingUnit.json().message, 'unit not found');
        },
      );
    } finally {
      await signOutAll(pool, STAFF_DOMAIN);
      // Precise, and in dependency order. Nothing else in the database is touched.
      await pool.query(
        `DELETE FROM tenancy_completeness_exception
          WHERE tenancy_id IN (
            SELECT t.tenancy_id FROM tenancy t
            JOIN space s ON s.space_id = t.unit_id
            JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY, ADDRESS],
      );
      await pool.query(
        `DELETE FROM tenancy_party
          WHERE tenancy_id IN (
            SELECT t.tenancy_id FROM tenancy t
            JOIN space s ON s.space_id = t.unit_id
            JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY, ADDRESS],
      );
      await pool.query(
        `DELETE FROM document_link
          WHERE entity_type = 'TENANCY' AND entity_id IN (
            SELECT t.tenancy_id FROM tenancy t
            JOIN space s ON s.space_id = t.unit_id
            JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY, ADDRESS],
      );
      await pool.query(
        `DELETE FROM tenancy
          WHERE unit_id IN (
            SELECT space_id FROM space s
            JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY, ADDRESS],
      );
      await pool.query(
        `DELETE FROM document WHERE document_type_id IN (
           SELECT document_type_id FROM document_type
            WHERE type_key LIKE 'lease-routes-48-%')`,
      );
      await pool.query(
        `DELETE FROM document_type WHERE type_key LIKE 'lease-routes-48-%'`,
      );
      await pool.query(
        `DELETE FROM party WHERE full_name = 'Tenant of routes-48'`,
      );
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
