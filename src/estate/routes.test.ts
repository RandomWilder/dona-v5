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
import { fixedClock, systemClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
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
          assert.doesNotMatch(response.body, /data-office-retrieval="unit"/);
          assert.doesNotMatch(
            response.body,
            /data-office-retrieval="building"/,
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
        assert.doesNotMatch(response.body, /data-office-retrieval="unit"/);
        assert.match(response.body, /data-office-retrieval="building"/);
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
          assert.doesNotMatch(response.body, /יומן שינויים/);
          assert.match(
            response.body,
            new RegExp(`/documents/new\\?unit=${unitId}`),
          );
          assert.match(response.body, /data-office-retrieval="unit"/);
          assert.match(response.body, /שאלות על המסמכים/);
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
        assert.doesNotMatch(found.body, /data-office-retrieval="unit"/);
        assert.doesNotMatch(found.body, /data-office-retrieval="building"/);
      });

      await t.test('an empty search asks rather than lists', async () => {
        const empty = await client.inject({
          method: 'GET',
          url: '/estate/search',
        });
        assert.equal(empty.statusCode, 200);
        assert.match(empty.body, /חפשו לפי כתובת/);
        assert.doesNotMatch(empty.body, /data-office-retrieval="unit"/);
        assert.doesNotMatch(empty.body, /data-office-retrieval="building"/);
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
          assert.doesNotMatch(ending.body, /data-office-retrieval="unit"/);
          assert.doesNotMatch(ending.body, /data-office-retrieval="building"/);
        },
      );

      await t.test(
        'a document-backed draft with no ערב is in the incomplete queue, and an exception clears it',
        async () => {
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
          for (const [typeKey, label, id] of [
            ['lease', 'חוזה שכירות', documentId],
            ['handover_protocol', 'פרוטוקול מסירה', newId()],
          ] as const) {
            const type = await pool.query<{ document_type_id: string }>(
              `INSERT INTO document_type (
                 document_type_id, type_key, label_he, label_en, verification_terms, is_active
               ) VALUES ($1, $2, $3, NULL, NULL, true)
               ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
               RETURNING document_type_id`,
              [newId(), typeKey, label],
            );
            await pool.query(
              `INSERT INTO document (
                 document_id, document_type_id, storage_uri, file_hash,
                 ingested_at, verification_verdict
               ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
              [
                id,
                type.rows[0]?.document_type_id,
                `gs://x/${id}.pdf`,
                `hash-${id}`,
                new Date('2026-09-08T12:00:00Z'),
              ],
            );
            await pool.query(
              `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
               VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
              [id, tenancyId],
            );
          }

          const listed = await client.inject({
            method: 'GET',
            url: '/estate/incomplete',
          });
          assert.equal(listed.statusCode, 200);
          assert.match(listed.body, /חוזים לא שלמים/);
          assert.match(listed.body, /חסר ערב/);
          assert.doesNotMatch(listed.body, /data-office-retrieval="unit"/);
          assert.doesNotMatch(listed.body, /data-office-retrieval="building"/);
          const letting = await client.inject({
            method: 'GET',
            url: `/estate/tenancies/${tenancyId}`,
          });
          assert.equal(letting.statusCode, 200);
          assert.doesNotMatch(letting.body, /data-office-retrieval="unit"/);
          assert.doesNotMatch(letting.body, /data-office-retrieval="building"/);
          // **Slice 5.2, and the defect this case now owns.** `renderIncompletePage` took its token
          // with a default of `''`, so the route that never passed one compiled, rendered, and
          // served an exception form refused on every submit. It is asserted *here* rather than in
          // `src/guard.test.ts` because this screen renders one form per incomplete tenancy, and
          // this is the case that builds the tenancy — a database with none renders no form, and an
          // assertion over no forms is a guard that passed because it looked at nothing.
          const tokens = [
            ...listed.body.matchAll(/name="csrf" value="([^"]*)"/g),
          ].map((match) => match[1]);
          //
          // The floor is `> 0` and not `=== 1`: this case *creates* one incomplete tenancy, so at
          // least one form exists whatever else the database holds — but a developer's database
          // holds whatever `npm run seed:register` left, and a count of exactly one would be this
          // assertion depending on a fixture from the other direction. Every token is checked,
          // which is the property; the floor is what stops it passing over an empty page.
          assert.ok(tokens.length > 0, 'the exception form is not on the page');
          for (const token of tokens) {
            assert.equal(token, who.csrf);
          }
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

// ---------------------------------------------------------------------------------------------
// #114. The office retrieval panel on the Unit page: ask, paint, clear. The command is evidence's;
// this suite is the HTTP seam #111 named.
// ---------------------------------------------------------------------------------------------

const ASK_DOMAIN = 'estate-ask.test';
const ASK_CITY = 'עיר שאלות';
const ASK_ADDRESS = 'רחוב שאלות 1';
const ASK_PROJECT = 'TEST-ASK';

const askPlan: EstatePlan = {
  projects: [
    {
      name: 'מכרז שאלות',
      projectCode: ASK_PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין שאלות',
      addressLine: ASK_ADDRESS,
      city: ASK_CITY,
      projectCode: ASK_PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [{ kind: 'UNIT', name: 'דירה 1', floor: '1', accessNote: null }],
      units: [
        {
          spaceName: 'דירה 1',
          unitNumber: '1',
          rooms: 3,
          areaSqm: 70,
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

async function askCleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    `DELETE FROM office_retrieval_thread
      WHERE (bound_kind = 'unit' AND bound_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2))
         OR (bound_kind = 'building' AND bound_id IN (
        SELECT building_id FROM building WHERE city = $1 AND address_line = $2))`,
    [ASK_CITY, ASK_ADDRESS],
  );
  await pool.query(
    `DELETE FROM unit WHERE unit_id IN (
      SELECT space_id FROM space s
      JOIN building b ON b.building_id = s.building_id
      WHERE b.city = $1 AND b.address_line = $2)`,
    [ASK_CITY, ASK_ADDRESS],
  );
  await pool.query(
    `DELETE FROM space WHERE building_id IN (
      SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
    [ASK_CITY, ASK_ADDRESS],
  );
  await pool.query(
    'DELETE FROM building WHERE city = $1 AND address_line = $2',
    [ASK_CITY, ASK_ADDRESS],
  );
  await pool.query('DELETE FROM project WHERE project_code = $1', [
    ASK_PROJECT,
  ]);
}

describe('estate · unit retrieval panel', () => {
  it('lets a viewer ask, keeps the thread private, and clears only that account', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      embedder: createFakeEmbedder(embeddingColumnDimensions),
    });
    await signOutAll(pool, ASK_DOMAIN);
    await askCleanup(pool);
    const viewer = await signIn(pool, systemClock, {
      email: `view@${ASK_DOMAIN}`,
      role: 'VIEWER',
    });
    const other = await signIn(pool, systemClock, {
      email: `ops@${ASK_DOMAIN}`,
      role: 'OPERATOR',
    });
    const asViewer = asOperator(app, viewer);
    const asOther = asOperator(app, other);
    try {
      await importEstate(pool, askPlan);
      const unit = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2`,
        [ASK_CITY, ASK_ADDRESS],
      );
      const unitId = unit.rows[0]?.unit_id ?? '';
      const path = `/estate/units/${unitId}`;
      const askUrl = `${path}/office-turn`;
      const clearUrl = `${path}/office-thread`;
      const question = 'מה דמי השכירות?';

      const documents = await asOther.inject({
        method: 'GET',
        url: '/documents',
      });
      assert.equal(documents.statusCode, 200);
      assert.doesNotMatch(documents.body, /data-office-retrieval="unit"/);
      assert.doesNotMatch(documents.body, /data-office-retrieval="building"/);
      const settings = await asOther.inject({
        method: 'GET',
        url: '/settings',
      });
      assert.equal(settings.statusCode, 200);
      assert.doesNotMatch(settings.body, /data-office-retrieval="unit"/);
      assert.doesNotMatch(settings.body, /data-office-retrieval="building"/);
      const calls = await asOther.inject({ method: 'GET', url: '/calls' });
      assert.equal(calls.statusCode, 200);
      assert.doesNotMatch(calls.body, /data-office-retrieval="unit"/);
      assert.doesNotMatch(calls.body, /data-office-retrieval="building"/);

      const anon = await app.inject({
        method: 'POST',
        url: askUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent(question)}`,
      });
      assert.equal(anon.statusCode, 303);
      assert.equal(anon.headers.location, '/staff/login');

      const noToken = await app.inject({
        method: 'POST',
        url: askUrl,
        headers: {
          cookie: viewer.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `question=${encodeURIComponent(question)}`,
      });
      assert.equal(noToken.statusCode, 403);

      const asked = await asViewer.inject({
        method: 'POST',
        url: askUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent(question)}`,
      });
      assert.equal(asked.statusCode, 303, asked.body.slice(0, 400));
      assert.equal(asked.headers.location, path);

      const painted = await asViewer.inject({ method: 'GET', url: path });
      assert.equal(painted.statusCode, 200);
      assert.match(painted.body, /מה דמי השכירות\?/);
      assert.match(painted.body, /אין במסמכים האלה תשובה לשאלה הזו/);

      const neighbour = await asOther.inject({ method: 'GET', url: path });
      assert.equal(neighbour.statusCode, 200);
      assert.doesNotMatch(neighbour.body, /מה דמי השכירות\?/);

      const cleared = await asViewer.inject({
        method: 'POST',
        url: clearUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      assert.equal(cleared.statusCode, 303, cleared.body.slice(0, 400));
      assert.equal(cleared.headers.location, path);
      const after = await asViewer.inject({ method: 'GET', url: path });
      assert.doesNotMatch(after.body, /מה דמי השכירות\?/);
    } finally {
      await askCleanup(pool);
      await signOutAll(pool, ASK_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// #121 / #123. The office retrieval panel on the Building page: same HTTP seam as #114, Building bound.
// Tool choice is the office turn's; this seam only posts the question.
// ---------------------------------------------------------------------------------------------

describe('estate · building retrieval panel', () => {
  it('lets a viewer ask on the Building, keeps the Unit thread distinct, and clears only the Building', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      extractor: createFakeExtractor((request) => {
        if (request.name === 'office_tools') {
          return { search: true, list: false };
        }
        return { answers: false, text: '', hit_indexes: [] };
      }),
    });
    await signOutAll(pool, ASK_DOMAIN);
    await askCleanup(pool);
    const viewer = await signIn(pool, systemClock, {
      email: `view@${ASK_DOMAIN}`,
      role: 'VIEWER',
    });
    const other = await signIn(pool, systemClock, {
      email: `ops@${ASK_DOMAIN}`,
      role: 'OPERATOR',
    });
    const asViewer = asOperator(app, viewer);
    const asOther = asOperator(app, other);
    try {
      await importEstate(pool, askPlan);
      const place = await pool.query<{
        unit_id: string;
        building_id: string;
      }>(
        `SELECT u.unit_id, b.building_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2`,
        [ASK_CITY, ASK_ADDRESS],
      );
      const unitId = place.rows[0]?.unit_id ?? '';
      const buildingId = place.rows[0]?.building_id ?? '';
      const buildingPath = `/estate/buildings/${buildingId}`;
      const unitPath = `/estate/units/${unitId}`;
      const askUrl = `${buildingPath}/office-turn`;
      const clearUrl = `${buildingPath}/office-thread`;
      const buildingQuestion = 'מה כתוב בפרוטוקול המסירה?';
      const unitQuestion = 'מה דמי השכירות?';

      const shown = await asViewer.inject({
        method: 'GET',
        url: buildingPath,
      });
      assert.equal(shown.statusCode, 200);
      assert.match(shown.body, /data-office-retrieval="building"/);
      assert.doesNotMatch(shown.body, /data-office-retrieval="unit"/);

      const anon = await app.inject({
        method: 'POST',
        url: askUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent(buildingQuestion)}`,
      });
      assert.equal(anon.statusCode, 303);
      assert.equal(anon.headers.location, '/staff/login');

      const noToken = await app.inject({
        method: 'POST',
        url: askUrl,
        headers: {
          cookie: viewer.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `question=${encodeURIComponent(buildingQuestion)}`,
      });
      assert.equal(noToken.statusCode, 403);

      const asked = await asViewer.inject({
        method: 'POST',
        url: askUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent(buildingQuestion)}`,
      });
      assert.equal(asked.statusCode, 303, asked.body.slice(0, 400));
      assert.equal(asked.headers.location, buildingPath);

      const painted = await asViewer.inject({
        method: 'GET',
        url: buildingPath,
      });
      assert.equal(painted.statusCode, 200);
      assert.match(painted.body, /מה כתוב בפרוטוקול המסירה\?/);
      assert.match(painted.body, /אין במסמכים האלה תשובה לשאלה הזו/);

      const unitPage = await asViewer.inject({
        method: 'GET',
        url: unitPath,
      });
      assert.equal(unitPage.statusCode, 200);
      assert.match(unitPage.body, /data-office-retrieval="unit"/);
      assert.doesNotMatch(unitPage.body, /מה כתוב בפרוטוקול המסירה\?/);

      const unitAsked = await asViewer.inject({
        method: 'POST',
        url: `${unitPath}/office-turn`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent(unitQuestion)}`,
      });
      assert.equal(unitAsked.statusCode, 303, unitAsked.body.slice(0, 400));

      const buildingAfterUnit = await asViewer.inject({
        method: 'GET',
        url: buildingPath,
      });
      assert.match(buildingAfterUnit.body, /מה כתוב בפרוטוקול המסירה\?/);
      assert.doesNotMatch(buildingAfterUnit.body, /מה דמי השכירות\?/);

      const neighbour = await asOther.inject({
        method: 'GET',
        url: buildingPath,
      });
      assert.equal(neighbour.statusCode, 200);
      assert.doesNotMatch(neighbour.body, /מה כתוב בפרוטוקול המסירה\?/);

      const cleared = await asViewer.inject({
        method: 'POST',
        url: clearUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      assert.equal(cleared.statusCode, 303, cleared.body.slice(0, 400));
      assert.equal(cleared.headers.location, buildingPath);
      const after = await asViewer.inject({
        method: 'GET',
        url: buildingPath,
      });
      assert.doesNotMatch(after.body, /מה כתוב בפרוטוקול המסירה\?/);
      const unitAfter = await asViewer.inject({
        method: 'GET',
        url: unitPath,
      });
      assert.match(unitAfter.body, /מה דמי השכירות\?/);
    } finally {
      await askCleanup(pool);
      await signOutAll(pool, ASK_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('stays on the Building when the extractor is unavailable, and records the provider error', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      extractor: createFakeExtractor(() => {
        throw new KernelError('unavailable', 'the extraction call failed', {
          status: 404,
          name: 'office_turn',
          providerCode: 'model_not_found',
          providerMessage:
            'The model does not exist or you do not have access to it.',
        });
      }),
    });
    await signOutAll(pool, ASK_DOMAIN);
    await askCleanup(pool);
    const viewer = await signIn(pool, systemClock, {
      email: `view@${ASK_DOMAIN}`,
      role: 'VIEWER',
    });
    const asViewer = asOperator(app, viewer);
    try {
      await importEstate(pool, askPlan);
      const place = await pool.query<{ building_id: string }>(
        `SELECT b.building_id FROM building b
         WHERE b.city = $1 AND b.address_line = $2`,
        [ASK_CITY, ASK_ADDRESS],
      );
      const buildingId = place.rows[0]?.building_id ?? '';
      const buildingPath = `/estate/buildings/${buildingId}`;
      const asked = await asViewer.inject({
        method: 'POST',
        url: `${buildingPath}/office-turn`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `question=${encodeURIComponent('כמה דירות מאוכלסות?')}`,
      });
      assert.equal(asked.statusCode, 303, asked.body.slice(0, 400));
      assert.equal(asked.headers.location, `${buildingPath}?ask=unavailable`);
      assert.doesNotMatch(asked.body, /"code":"unavailable"/);

      const painted = await asViewer.inject({
        method: 'GET',
        url: `${buildingPath}?ask=unavailable`,
      });
      assert.equal(painted.statusCode, 200);
      assert.match(painted.body, /לא ניתן לענות עכשיו/);
      assert.doesNotMatch(painted.body, /כמה דירות מאוכלסות/);

      const logged = await pool.query<{
        action: string;
        outcome: string;
        error_code: string | null;
        inputs: { name?: string; status?: number; providerCode?: string };
      }>(
        `SELECT action, outcome, error_code, inputs
           FROM audit_log
          WHERE action = 'evidence.office_turn' AND subject_id = $1
          ORDER BY at DESC
          LIMIT 1`,
        [buildingId],
      );
      const row = logged.rows[0];
      assert.equal(row?.action, 'evidence.office_turn');
      assert.equal(row?.outcome, 'error');
      assert.equal(row?.error_code, 'unavailable');
      assert.equal(row?.inputs.name, 'office_turn');
      assert.equal(row?.inputs.status, 404);
      assert.equal(row?.inputs.providerCode, 'model_not_found');
      assert.equal(
        JSON.stringify(row?.inputs).includes('כמה דירות מאוכלסות'),
        false,
      );
    } finally {
      await askCleanup(pool);
      await signOutAll(pool, ASK_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// **Slice 6.1 — flow A11.** An admin creates a building from a screen, which nobody could do until
// this slice: every building in this system arrived through `npm run import:register` or a fixture.
//
// Its own city and address, and its own cleanup, for the reason the suite above states: these
// routes commit, so a test that truncated `building` would wipe a developer's seed.
// ---------------------------------------------------------------------------------------------

const A11_DOMAIN = 'estate-a11.test';
const A11_CITY = 'עיר A11';
const A11_ADDRESS = 'רחוב A11 7';
const A11_PROJECT = 'TEST-A11';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function a11Form(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    name: 'בניין A11',
    address_line: A11_ADDRESS,
    city: A11_CITY,
    project_code: '',
    handover_date: '2025-03-01',
    warranty_end_date: '',
    status: 'ACTIVE',
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

async function a11Cleanup(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool
    .query('DELETE FROM building WHERE city = $1', [A11_CITY])
    .catch(() => {});
  await pool
    .query('DELETE FROM project WHERE project_code = $1', [A11_PROJECT])
    .catch(() => {});
}

describe('estate · A11, an administrator creates a building', () => {
  it('creates one building from the screen, and the same address twice is still one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A11_DOMAIN);
    await a11Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A11_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      // The form, with a token in it and the project select filled from what exists.
      const form = await client.inject({
        method: 'GET',
        url: '/estate/buildings/new',
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /action="\/estate\/buildings"/);
      assert.match(form.body, new RegExp(`value="${admin.csrf}"`));
      assert.match(form.body, /ללא פרויקט/);

      const created = await client.inject({
        method: 'POST',
        url: '/estate/buildings',
        headers: FORM,
        payload: a11Form(),
      });
      assert.equal(created.statusCode, 303);
      assert.equal(created.headers.location, '/estate');

      const first = await pool.query<{ building_id: string }>(
        'SELECT building_id FROM building WHERE city = $1',
        [A11_CITY],
      );
      assert.equal(first.rowCount, 1);

      // It is on `/estate`, which is the acceptance bar's own wording.
      const list = await client.inject({ method: 'GET', url: '/estate' });
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /בניין A11/);
      // And an admin is offered the door. An operator is not — asserted in the refusal case below.
      assert.match(list.body, /href="\/estate\/buildings\/new"/);

      // **The same address posted twice leaves one row**, and the id does not move.
      // `building.address_key` is what says so: UNIQUE, generated with casing and whitespace
      // normalised, upserted with ON CONFLICT DO UPDATE. So the second post is written with a
      // different name and different spacing and still lands on the first row.
      const again = await client.inject({
        method: 'POST',
        url: '/estate/buildings',
        headers: FORM,
        payload: a11Form({
          name: 'בניין A11 — שם מתוקן',
          address_line: `  ${A11_ADDRESS}  `,
        }),
      });
      assert.equal(again.statusCode, 303);
      const second = await pool.query<{ building_id: string; name: string }>(
        'SELECT building_id, name FROM building WHERE city = $1',
        [A11_CITY],
      );
      assert.equal(second.rowCount, 1, 'a second building was written');
      assert.equal(second.rows[0]?.building_id, first.rows[0]?.building_id);
      // DO UPDATE rather than DO NOTHING: a corrected typo corrects the row (SPEC-estate.md).
      assert.equal(second.rows[0]?.name, 'בניין A11 — שם מתוקן');

      // **The blank תקופת הבדק was derived**, not left null: handover plus WARRANTY_YEARS.
      const dates = await pool.query<{
        handover_date: string;
        warranty_end_date: string;
      }>(
        `SELECT handover_date::text, warranty_end_date::text
         FROM building WHERE city = $1`,
        [A11_CITY],
      );
      assert.equal(dates.rows[0]?.handover_date, '2025-03-01');
      assert.equal(dates.rows[0]?.warranty_end_date, '2027-03-01');

      // #143 — blank parcel fields are null, not empty string, and the building still saved.
      const blankParcel = await pool.query<{
        gush: string | null;
        helka: string | null;
        building_number: string | null;
      }>(`SELECT gush, helka, building_number FROM building WHERE city = $1`, [
        A11_CITY,
      ]);
      assert.equal(blankParcel.rows[0]?.gush, null);
      assert.equal(blankParcel.rows[0]?.helka, null);
      assert.equal(blankParcel.rows[0]?.building_number, null);
    } finally {
      await a11Cleanup(pool);
      await signOutAll(pool, A11_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('refuses an OPERATOR with not_allowed and nothing more, and writes nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A11_DOMAIN);
    await a11Cleanup(pool);
    const operator = await signIn(pool, systemClock, {
      email: `ops@${A11_DOMAIN}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, operator);
    try {
      // **Red first, and red for the right reason.** Written against a registered route with
      // `estate.write` temporarily granted to OPERATOR in `src/staff/internal/roles.ts`, where it
      // answered 303 and this assertion failed. A case written against an unregistered route would
      // only ever have proved a 404. What refuses here is the matrix line, and nothing else.
      const refused = await client.inject({
        method: 'POST',
        url: '/estate/buildings',
        headers: FORM,
        payload: a11Form(),
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });

      // Nothing was written. The refusal is a stance, not a rollback.
      const rows = await pool.query('SELECT 1 FROM building WHERE city = $1', [
        A11_CITY,
      ]);
      assert.equal(rows.rowCount, 0);

      // The form itself is refused too, and not served read-only: a screen an operator may fill in
      // and may not post teaches them nothing, because the refusal says nothing more.
      const form = await client.inject({
        method: 'GET',
        url: '/estate/buildings/new',
      });
      assert.equal(form.statusCode, 403);

      // And the buildings list does not offer the door.
      const list = await client.inject({ method: 'GET', url: '/estate' });
      assert.equal(list.statusCode, 200);
      assert.doesNotMatch(list.body, /href="\/estate\/buildings\/new"/);
    } finally {
      await a11Cleanup(pool);
      await signOutAll(pool, A11_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('rejects a status and a project code the schema would have rejected later', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A11_DOMAIN);
    await a11Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A11_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      for (const [label, payload] of [
        ['status', a11Form({ status: 'DEMOLISHED' })],
        ['project', a11Form({ project_code: 'NO-SUCH-TENDER' })],
        ['handover', a11Form({ handover_date: '01/03/2025' })],
        ['name', a11Form({ name: '   ' })],
      ] as Array<[string, string]>) {
        const response = await client.inject({
          method: 'POST',
          url: '/estate/buildings',
          headers: FORM,
          payload,
        });
        assert.equal(response.statusCode, 400, label);
        assert.equal(response.json().code, 'invalid', label);
      }
      const rows = await pool.query('SELECT 1 FROM building WHERE city = $1', [
        A11_CITY,
      ]);
      assert.equal(rows.rowCount, 0, 'a rejected form wrote a building');
    } finally {
      await a11Cleanup(pool);
      await signOutAll(pool, A11_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('types gush, helka and building_number, and the building page shows them', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A11_DOMAIN);
    await a11Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A11_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const form = await client.inject({
        method: 'GET',
        url: '/estate/buildings/new',
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /name="gush"/);
      assert.match(form.body, /name="helka"/);
      assert.match(form.body, /name="building_number"/);

      const created = await client.inject({
        method: 'POST',
        url: '/estate/buildings',
        headers: FORM,
        payload: a11Form({
          gush: '6533',
          helka: '43, 46',
          building_number: '206',
        }),
      });
      assert.equal(created.statusCode, 303);

      const row = await pool.query<{
        building_id: string;
        gush: string | null;
        helka: string | null;
        building_number: string | null;
      }>(
        `SELECT building_id, gush, helka, building_number
           FROM building WHERE city = $1`,
        [A11_CITY],
      );
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0]?.gush, '6533');
      assert.equal(row.rows[0]?.helka, '43, 46');
      assert.equal(row.rows[0]?.building_number, '206');

      const page = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${row.rows[0]?.building_id}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /6533/);
      assert.match(page.body, /43, 46/);
      assert.match(page.body, /206/);

      // Blank on a re-post is null, the same as on create — A11 writes what was posted.
      const cleared = await client.inject({
        method: 'POST',
        url: '/estate/buildings',
        headers: FORM,
        payload: a11Form(),
      });
      assert.equal(cleared.statusCode, 303);
      const after = await pool.query<{
        gush: string | null;
        helka: string | null;
        building_number: string | null;
      }>(`SELECT gush, helka, building_number FROM building WHERE city = $1`, [
        A11_CITY,
      ]);
      assert.equal(after.rows[0]?.gush, null);
      assert.equal(after.rows[0]?.helka, null);
      assert.equal(after.rows[0]?.building_number, null);
    } finally {
      await a11Cleanup(pool);
      await signOutAll(pool, A11_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// **Slice 6.2 — flow A13.** An admin adds an apartment to a building, which nobody could do until
// this slice either: A11 creates a building empty and `npm run import:register` was the only thing
// in this system that had ever written a `unit` row.
//
// Its own city, its own project and its own cleanup, for the reason the suites above state: these
// routes commit.
// ---------------------------------------------------------------------------------------------

const A13_DOMAIN = 'estate-a13.test';
const A13_CITY = 'עיר A13';
const A13_ADDRESS = 'רחוב A13 9';
const A13_PROJECT = 'TEST-A13';
const A13_UNIT = '8';

const a13Plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז A13',
      projectCode: A13_PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין A13',
      addressLine: A13_ADDRESS,
      city: A13_CITY,
      projectCode: A13_PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [],
      units: [],
    },
  ],
};

function a13Form(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    unit_number: A13_UNIT,
    floor: '2',
    rooms: '3.5',
    area_sqm: '78.5',
    has_mamad: 'on',
    warranty_end_date: '',
    condition_status: 'READY',
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

async function a13Cleanup(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  for (const statement of [
    // Assets first (#140): the remove-a-bay case puts a gate motor in a bay to watch the refusal,
    // and `asset.space_id` is NOT NULL, so the space below it cannot go while it is there.
    `DELETE FROM asset WHERE space_id IN (
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
    await pool.query(statement, [A13_CITY]).catch(() => {});
  }
  await pool
    .query('DELETE FROM project WHERE project_code = $1', [A13_PROJECT])
    .catch(() => {});
}

/** The building A13 fills, created the way A11 creates one: empty. */
async function a13Building(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<string> {
  await importEstate(pool as never, a13Plan);
  const found = (await pool.query(
    'SELECT building_id FROM building WHERE city = $1',
    [A13_CITY],
  )) as { rows: Array<{ building_id: string }> };
  return found.rows[0]?.building_id ?? '';
}

describe('estate · A13, an administrator adds an apartment', () => {
  it('writes one flat, one space and no second building, and the same number twice is still one flat', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A13_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const buildingId = await a13Building(pool);
      const projectBefore = await pool.query<{ project_id: string | null }>(
        'SELECT project_id FROM building WHERE building_id = $1',
        [buildingId],
      );

      // The form, with a token in it and the building it will write into named on it.
      const form = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}/units/new`,
      });
      assert.equal(form.statusCode, 200);
      assert.match(
        form.body,
        new RegExp(`action="/estate/buildings/${buildingId}/units"`),
      );
      assert.match(form.body, new RegExp(`value="${admin.csrf}"`));
      assert.match(form.body, /בניין A13/);

      const created = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${buildingId}/units`,
        headers: FORM,
        payload: a13Form(),
      });
      assert.equal(created.statusCode, 303);
      assert.equal(created.headers.location, `/estate/buildings/${buildingId}`);

      // **One flat and one space (#140).** The `UNIT` space is named by the bare unit number, which
      // is what `src/register/internal/importer.ts` passes — two writers spelling it two ways would
      // be two apartments behind one door (SPEC-flows.md A13).
      //
      // The form above types nothing into either bay number, which is the case that corrupted data:
      // until this ticket it wrote `PARKING חניה 8` and `STORAGE מחסן 8`, numbers off the door
      // standing in for numbers off the developer's plan. It writes neither now.
      const spaces = await pool.query<{ space_kind: string; name: string }>(
        `SELECT space_kind, name FROM space WHERE building_id = $1
          ORDER BY space_kind`,
        [buildingId],
      );
      assert.deepEqual(
        spaces.rows.map((row) => `${row.space_kind} ${row.name}`),
        [`UNIT ${A13_UNIT}`],
      );
      const units = await pool.query<{
        unit_id: string;
        rooms: string;
        area_sqm: string;
        has_mamad: boolean;
        parking_space_id: string | null;
        storage_space_id: string | null;
        warranty_end_date: string | null;
      }>(
        `SELECT u.unit_id, u.rooms::text, u.area_sqm::text, u.has_mamad,
                u.parking_space_id, u.storage_space_id,
                u.warranty_end_date::text
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      assert.equal(units.rowCount, 1);
      assert.equal(units.rows[0]?.rooms, '3.5');
      assert.equal(units.rows[0]?.area_sqm, '78.5');
      assert.equal(units.rows[0]?.has_mamad, true);
      // **Both keys null, and `MATCH SIMPLE` leaves them unenforced while they are** — which
      // `0004_estate.sql` names as the ordinary state (#140). This is the assertion the derivation
      // in the track A proposal needs: `storage_space_id IS NOT NULL` is an answer again and not a
      // constant.
      assert.equal(units.rows[0]?.parking_space_id, null);
      assert.equal(units.rows[0]?.storage_space_id, null);
      // Blank means *the building's date applies* (R14), not *no warranty*.
      assert.equal(units.rows[0]?.warranty_end_date, null);

      // **The building was rewritten as itself, and its project survived.** `upsertUnitRow` upserts
      // the building it is handed, and `DO UPDATE` sets project_id from the row it is given — so a
      // route passing the form's idea of a building would unlink the project while adding a flat.
      const projectAfter = await pool.query<{
        project_id: string | null;
        name: string;
      }>('SELECT project_id, name FROM building WHERE building_id = $1', [
        buildingId,
      ]);
      assert.equal(
        projectAfter.rows[0]?.project_id,
        projectBefore.rows[0]?.project_id,
      );
      assert.equal(projectAfter.rows[0]?.name, 'בניין A13');
      const buildings = await pool.query(
        'SELECT 1 FROM building WHERE city = $1',
        [A13_CITY],
      );
      assert.equal(buildings.rowCount, 1, 'a second building was written');

      // It is on the building page, with its space count and its occupancy chip — the acceptance
      // bar's own wording. Nothing is let, so the chip says פנויה (R6, derived on every load).
      const page = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(
        page.body,
        new RegExp(`דירה <span dir="ltr">${A13_UNIT}</span>`),
      );
      assert.match(page.body, /פנויה/);
      // And no bay chips at all: the building holds one Space, and the kind breakdown says so.
      assert.doesNotMatch(page.body, /חניות · /);
      assert.doesNotMatch(page.body, /מחסנים · /);
      // And an admin is offered the door. An operator is not — asserted in the refusal case below.
      assert.match(
        page.body,
        new RegExp(`href="/estate/buildings/${buildingId}/units/new"`),
      );

      // **The same unit number posted twice updates the flat.** R2 makes a unit's identity its
      // space's, so `space (building_id, space_kind, name)` is the whole of the key: a corrected
      // floor and a corrected room count land on the row that is already there.
      const again = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${buildingId}/units`,
        headers: FORM,
        payload: a13Form({ rooms: '4', floor: '3', area_sqm: '' }),
      });
      assert.equal(again.statusCode, 303);
      const after = await pool.query<{
        unit_id: string;
        rooms: string;
        area_sqm: string | null;
        floor: string | null;
      }>(
        `SELECT u.unit_id, u.rooms::text, u.area_sqm::text, s.floor
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      assert.equal(after.rowCount, 1, 'a second flat was written');
      assert.equal(after.rows[0]?.unit_id, units.rows[0]?.unit_id);
      assert.equal(after.rows[0]?.rooms, '4');
      assert.equal(after.rows[0]?.floor, '3');
      assert.equal(after.rows[0]?.area_sqm, null);
      const spacesAfter = await pool.query(
        'SELECT 1 FROM space WHERE building_id = $1',
        [buildingId],
      );
      assert.equal(spacesAfter.rowCount, 1, 'a second space was written');

      // **Every optional field left blank, which is what a form posts for a field nobody typed
      // into.** Found by reading this slice's own diff: `optionalText` answers `invalid` for an
      // empty string and null only for an absent key, which is right for a caller and wrong for a
      // form, where an untouched input still arrives as `''`.
      const sparse = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${buildingId}/units`,
        headers: FORM,
        payload: new URLSearchParams({
          unit_number: '9',
          floor: '',
          rooms: '3',
          area_sqm: '',
          warranty_end_date: '',
          condition_status: 'READY',
        }).toString(),
      });
      assert.equal(sparse.statusCode, 303);
      const sparseRow = await pool.query<{
        floor: string | null;
        area_sqm: string | null;
        has_mamad: boolean;
        warranty_end_date: string | null;
      }>(
        `SELECT s.floor, u.area_sqm::text, u.has_mamad,
                u.warranty_end_date::text
           FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1 AND u.unit_number = '9'`,
        [buildingId],
      );
      assert.equal(sparseRow.rowCount, 1);
      assert.equal(sparseRow.rows[0]?.floor, null);
      assert.equal(sparseRow.rows[0]?.area_sqm, null);
      // An unchecked checkbox posts nothing at all, and ממ״ד is false rather than missing.
      assert.equal(sparseRow.rows[0]?.has_mamad, false);
      assert.equal(sparseRow.rows[0]?.warranty_end_date, null);
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('refuses an OPERATOR with not_allowed and nothing more, and writes nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const operator = await signIn(pool, systemClock, {
      email: `ops@${A13_DOMAIN}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, operator);
    try {
      const buildingId = await a13Building(pool);
      // Red first, the way 6.1 proved its own: with `estate.write` temporarily granted to OPERATOR
      // in `src/staff/internal/roles.ts`, this answered 303 and this assertion failed. What refuses
      // is the matrix line and not a missing route.
      const refused = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${buildingId}/units`,
        headers: FORM,
        payload: a13Form(),
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
      const units = await pool.query(
        `SELECT 1 FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      assert.equal(units.rowCount, 0);
      const spaces = await pool.query(
        'SELECT 1 FROM space WHERE building_id = $1',
        [buildingId],
      );
      assert.equal(spaces.rowCount, 0, 'a refused post wrote a bay');

      // The form is refused too, and the building page does not offer the door.
      const form = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}/units/new`,
      });
      assert.equal(form.statusCode, 403);
      const page = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(
        page.body,
        new RegExp(`href="/estate/buildings/${buildingId}/units/new"`),
      );
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('rejects at the edge what the schema would have rejected later, and writes nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A13_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const buildingId = await a13Building(pool);
      for (const [label, payload] of [
        ['unit_number', a13Form({ unit_number: '   ' })],
        ['rooms', a13Form({ rooms: 'שלוש וחצי' })],
        ['rooms, negative', a13Form({ rooms: '-3' })],
        ['area', a13Form({ area_sqm: '78,5' })],
        ['condition', a13Form({ condition_status: 'PALACE' })],
        ['warranty', a13Form({ warranty_end_date: '01/03/2027' })],
      ] as Array<[string, string]>) {
        const response = await client.inject({
          method: 'POST',
          url: `/estate/buildings/${buildingId}/units`,
          headers: FORM,
          payload,
        });
        assert.equal(response.statusCode, 400, label);
        assert.equal(response.json().code, 'invalid', label);
      }
      const units = await pool.query(
        `SELECT 1 FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      );
      assert.equal(units.rowCount, 0, 'a rejected form wrote a flat');
      const spaces = await pool.query(
        'SELECT 1 FROM space WHERE building_id = $1',
        [buildingId],
      );
      assert.equal(spaces.rowCount, 0, 'a rejected form wrote a bay');

      // A building id that is not one is `invalid`; one that is well formed and absent is
      // `not_found`. Neither says which, and the flat is written into neither.
      const malformed = await client.inject({
        method: 'POST',
        url: '/estate/buildings/not-an-id/units',
        headers: FORM,
        payload: a13Form(),
      });
      assert.equal(malformed.statusCode, 400);
      assert.equal(malformed.json().code, 'invalid');
      const absent = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${newId()}/units`,
        headers: FORM,
        payload: a13Form(),
      });
      assert.equal(absent.statusCode, 404);
      assert.equal(absent.json().code, 'not_found');
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  // #140, the second half. A bay number is a fact off the developer's plan, so the screen asks for
  // it and copies it; and because rows written before this ticket carry `חניה {unit_number}`, the
  // same screen has to be able to take one off again. Without the removal there is no forward path
  // for them at all: a real bay number arriving later would make a *second* `PARKING` space in the
  // building with nothing to say which is the real one.
  it('writes the bay number the plan prints, and takes a placeholder off again', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A13_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const buildingId = await a13Building(pool);
      // The screen offers both inputs, and they are optional.
      const form = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}/units/new`,
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /name="parking_space_name"/);
      assert.match(form.body, /name="storage_space_name"/);

      // 206-7 (`bloch`) in `evals/fixtures/lease-extraction.ts`: flat 7, bay 574, store 601. Not
      // one of the three numbers is the same as another, which is the whole of this ticket.
      const created = await client.inject({
        method: 'POST',
        url: `/estate/buildings/${buildingId}/units`,
        headers: FORM,
        payload: a13Form({
          unit_number: '7',
          parking_space_name: '574',
          storage_space_name: '601',
        }),
      });
      assert.equal(created.statusCode, 303);
      const spaces = await pool.query<{
        space_id: string;
        space_kind: string;
        name: string;
      }>(
        `SELECT space_id, space_kind, name FROM space WHERE building_id = $1
          ORDER BY space_kind`,
        [buildingId],
      );
      assert.deepEqual(
        spaces.rows.map((row) => `${row.space_kind} ${row.name}`),
        ['PARKING 574', 'STORAGE 601', 'UNIT 7'],
      );
      const bay = spaces.rows.find((row) => row.space_kind === 'PARKING');
      const store = spaces.rows.find((row) => row.space_kind === 'STORAGE');
      const unitId = spaces.rows.find(
        (row) => row.space_kind === 'UNIT',
      )?.space_id;
      assert.ok(bay && store && unitId);

      const assigned = await pool.query<{
        parking_space_id: string | null;
        storage_space_id: string | null;
      }>(
        'SELECT parking_space_id, storage_space_id FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(assigned.rows[0]?.parking_space_id, bay.space_id);
      assert.equal(assigned.rows[0]?.storage_space_id, store.space_id);

      // On the card, and with a control to take it off — for a viewer who may write and nobody else.
      const page = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.match(page.body, /<dt>חניה<\/dt><dd><span dir="ltr">574<\/span>/);
      assert.match(
        page.body,
        new RegExp(`action="/estate/spaces/${bay.space_id}/remove"`),
      );

      // **Detach and delete, in that order and in one transaction.** The key is nulled on the unit
      // and the Space row goes; the storage room beside it is untouched.
      const removed = await client.inject({
        method: 'POST',
        url: `/estate/spaces/${bay.space_id}/remove`,
        headers: FORM,
        payload: new URLSearchParams({ _csrf: admin.csrf }).toString(),
      });
      assert.equal(removed.statusCode, 303);
      assert.equal(removed.headers.location, `/estate/buildings/${buildingId}`);
      const after = await pool.query<{ space_kind: string; name: string }>(
        `SELECT space_kind, name FROM space WHERE building_id = $1
          ORDER BY space_kind`,
        [buildingId],
      );
      assert.deepEqual(
        after.rows.map((row) => `${row.space_kind} ${row.name}`),
        ['STORAGE 601', 'UNIT 7'],
      );
      const detached = await pool.query<{
        parking_space_id: string | null;
        storage_space_id: string | null;
      }>(
        'SELECT parking_space_id, storage_space_id FROM unit WHERE unit_id = $1',
        [unitId],
      );
      assert.equal(detached.rows[0]?.parking_space_id, null);
      assert.equal(detached.rows[0]?.storage_space_id, store.space_id);
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  // **The orphan, which is the case this ticket is actually about.** An operator who writes the real
  // bay number *before* removing the placeholder repoints the flat, and `חניה 7` is then pointed at
  // by nothing. A remove keyed on the unit could never reach it again — it would sit in the building
  // forever as a second `PARKING` row with no screen admitting it exists. So the route is keyed on
  // the Space, the building page lists what no flat points at, and the order the operator happened
  // to work in stops mattering.
  it('lists a bay no flat points at, and removes it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A13_DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const buildingId = await a13Building(pool);
      const post = (payload: string) =>
        client.inject({
          method: 'POST',
          url: `/estate/buildings/${buildingId}/units`,
          headers: FORM,
          payload,
        });
      // The placeholder, then the real number on the same flat. The second post repoints the unit
      // at `574` and leaves `חניה 7` behind — exactly what an A13 flat written before this ticket
      // does the first time somebody corrects it.
      assert.equal(
        (
          await post(
            a13Form({ unit_number: '7', parking_space_name: 'חניה 7' }),
          )
        ).statusCode,
        303,
      );
      assert.equal(
        (await post(a13Form({ unit_number: '7', parking_space_name: '574' })))
          .statusCode,
        303,
      );
      const spaces = await pool.query<{ space_id: string; name: string }>(
        `SELECT space_id, name FROM space
          WHERE building_id = $1 AND space_kind = 'PARKING' ORDER BY name`,
        [buildingId],
      );
      assert.equal(spaces.rowCount, 2, 'the correction left one bay, not two');
      const orphan = spaces.rows.find((row) => row.name === 'חניה 7');
      assert.ok(orphan);

      // It is on the building page, under its own heading, with a control — and the real bay is not
      // there, because a flat points at that one.
      const page = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.match(page.body, /חניות ומחסנים ללא שיוך/);
      assert.match(
        page.body,
        new RegExp(`action="/estate/spaces/${orphan.space_id}/remove"`),
      );
      assert.doesNotMatch(
        page.body,
        new RegExp(
          `action="/estate/spaces/${spaces.rows.find((row) => row.name === '574')?.space_id}/remove"[^]*?ללא שיוך`,
        ),
      );

      const removed = await client.inject({
        method: 'POST',
        url: `/estate/spaces/${orphan.space_id}/remove`,
        headers: FORM,
        payload: new URLSearchParams({ _csrf: admin.csrf }).toString(),
      });
      assert.equal(removed.statusCode, 303);
      const after = await pool.query<{ name: string }>(
        `SELECT name FROM space WHERE building_id = $1 AND space_kind = 'PARKING'`,
        [buildingId],
      );
      assert.deepEqual(
        after.rows.map((row) => row.name),
        ['574'],
        'the real bay went with the placeholder',
      );
      // And the section is gone with its last row, rather than standing empty on every building.
      const clean = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.doesNotMatch(clean.body, /חניות ומחסנים ללא שיוך/);
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  // **The delete is narrow and it refuses rather than cascading.** Every refusal names what is in
  // the way, because the operator's next move depends on which: an asset is moved, a second unit's
  // assignment is cleared, an apartment is not a bay at all.
  it('refuses to remove a space anything else is still using, and says which', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, A13_DOMAIN);
    await a13Cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `admin@${A13_DOMAIN}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, systemClock, {
      email: `ops@${A13_DOMAIN}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, admin);
    try {
      const buildingId = await a13Building(pool);
      const post = (payload: string) =>
        client.inject({
          method: 'POST',
          url: `/estate/buildings/${buildingId}/units`,
          headers: FORM,
          payload,
        });
      assert.equal(
        (await post(a13Form({ unit_number: '7', parking_space_name: '574' })))
          .statusCode,
        303,
      );
      const spaces = await pool.query<{
        space_id: string;
        space_kind: string;
        name: string;
      }>(
        'SELECT space_id, space_kind, name FROM space WHERE building_id = $1',
        [buildingId],
      );
      const bay = spaces.rows.find((row) => row.space_kind === 'PARKING');
      const flat = spaces.rows.find((row) => row.space_kind === 'UNIT');
      assert.ok(bay && flat);
      const remove = (spaceId: string) =>
        client.inject({
          method: 'POST',
          url: `/estate/spaces/${spaceId}/remove`,
          headers: FORM,
          payload: new URLSearchParams({ _csrf: admin.csrf }).toString(),
        });

      // An apartment is a Space too, and R2 makes it the unit's own row. Only the two bay kinds may
      // be removed here, and the refusal is `invalid` rather than `conflict`: nothing is in the way,
      // the ask is wrong.
      const notABay = await remove(flat.space_id);
      assert.equal(notABay.statusCode, 400);
      assert.equal(notABay.json().code, 'invalid');

      // A gate motor in the bay. R3 — an asset sits in exactly one Space — so deleting the Space
      // would take the asset's location with it.
      await pool.query(
        `INSERT INTO asset (asset_id, space_id, asset_class, asset_type,
                            compliance_regime, status)
         VALUES ($1, $2, 'UTILITY', 'GATE_MOTOR', 'NONE', 'IN_SERVICE')`,
        [newId(), bay.space_id],
      );
      const heldByAsset = await remove(bay.space_id);
      assert.equal(heldByAsset.statusCode, 409);
      assert.equal(heldByAsset.json().code, 'conflict');
      assert.match(heldByAsset.json().message, /asset/);
      await pool.query('DELETE FROM asset WHERE space_id = $1', [bay.space_id]);

      // **Two flats assigned to one bay.** Someone typed 574 twice; which of them is wrong is a
      // question about a piece of paper, so the route refuses and names the count rather than
      // picking. One flat assigned is not this case — that one is detached and removed, which is the
      // whole forward path for the rows 4.6 wrote, and the case above exercises it.
      assert.equal(
        (await post(a13Form({ unit_number: '9', parking_space_name: '574' })))
          .statusCode,
        303,
      );
      await pool.query(
        `UPDATE unit SET parking_space_id = $1 WHERE unit_id = $2`,
        [bay.space_id, flat.space_id],
      );
      const heldByUnit = await remove(bay.space_id);
      assert.equal(heldByUnit.statusCode, 409);
      assert.equal(heldByUnit.json().code, 'conflict');
      assert.match(heldByUnit.json().message, /unit/);
      const survived = await pool.query(
        'SELECT 1 FROM space WHERE space_id = $1',
        [bay.space_id],
      );
      assert.equal(survived.rowCount, 1, 'a refused remove deleted the space');

      // And an OPERATOR may not remove one at all — the same `estate.write` line A13 keeps.
      const refused = await asOperator(app, operator).inject({
        method: 'POST',
        url: `/estate/spaces/${bay.space_id}/remove`,
        headers: FORM,
        payload: new URLSearchParams({ _csrf: operator.csrf }).toString(),
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
    } finally {
      await a13Cleanup(pool);
      await signOutAll(pool, A13_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});

const A5_DOMAIN = 'tenancy-page.test';
const A5_CITY = 'עיר השכרה';
const A5_ADDRESS = 'רחוב השכרה 7';
const A5_PROJECT = 'TEST-A5-PAGE';
const A5_TENANT = 'דנה כהן-a5';
const A5_AT = new Date('2026-09-15T09:00:00.000Z');

const a5Plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז השכרה',
      projectCode: A5_PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין השכרה',
      addressLine: A5_ADDRESS,
      city: A5_CITY,
      projectCode: A5_PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [
        { kind: 'UNIT', name: 'דירה 12A', floor: '2', accessNote: null },
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

async function a5Cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
  );
  try {
    await pool.query(
      `DELETE FROM tenancy_event
      WHERE tenancy_id IN (
        SELECT t.tenancy_id FROM tenancy t
        JOIN space s ON s.space_id = t.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(
      `DELETE FROM tenancy_party
      WHERE tenancy_id IN (
        SELECT t.tenancy_id FROM tenancy t
        JOIN space s ON s.space_id = t.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(
      `DELETE FROM document_link
      WHERE entity_type = 'TENANCY' AND entity_id IN (
        SELECT t.tenancy_id FROM tenancy t
        JOIN space s ON s.space_id = t.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(
      `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(`DELETE FROM party WHERE full_name = $1`, [A5_TENANT]);
    await pool.query(
      `DELETE FROM unit WHERE unit_id IN (
      SELECT space_id FROM space s
      JOIN building b ON b.building_id = s.building_id
      WHERE b.city = $1 AND b.address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(
      `DELETE FROM space WHERE building_id IN (
      SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query(
      'DELETE FROM building WHERE city = $1 AND address_line = $2',
      [A5_CITY, A5_ADDRESS],
    );
    await pool.query('DELETE FROM project WHERE project_code = $1', [
      A5_PROJECT,
    ]);
  } finally {
    await pool.query(
      'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
    );
  }
}

async function linkType(
  pool: import('pg').Pool,
  tenancyId: string,
  typeKey: string,
  labelHe: string,
): Promise<string> {
  const type = await pool.query<{ document_type_id: string }>(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, $3, NULL, NULL, true)
     ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
     RETURNING document_type_id`,
    [newId(), typeKey, labelHe],
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
      A5_AT,
    ],
  );
  await pool.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
    [documentId, tenancyId],
  );
  return documentId;
}

describe('estate · the tenancy page', () => {
  it('shows one letting, refuses until the gate passes, and activates on the press', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(A5_AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await signOutAll(pool, A5_DOMAIN);
    await a5Cleanup(pool);
    const who = await signIn(pool, clock, { email: `ops@${A5_DOMAIN}` });
    const client = asOperator(app, who);
    try {
      await importEstate(pool, a5Plan);
      const unit = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2`,
        [A5_CITY, A5_ADDRESS],
      );
      const unitId = unit.rows[0]?.unit_id ?? '';
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), `a5-${A5_PROJECT}`],
      );
      const tenancyId = newId();
      const partyId = newId();
      await pool.query(
        `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
         VALUES ($1, $2, '2026-09-01', '2027-08-31', 'DRAFT', $3)`,
        [tenancyId, unitId, profile.rows[0]?.terms_profile_id],
      );
      await pool.query(
        `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
        [partyId, A5_TENANT],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
        [tenancyId, partyId],
      );

      const missing = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${newId()}`,
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().code, 'not_found');

      await linkType(pool, tenancyId, 'lease', 'חוזה שכירות');

      const blocked = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.equal(blocked.statusCode, 200);
      assert.match(blocked.body, /<html lang="he" dir="rtl">/);
      assert.match(blocked.body, new RegExp(A5_TENANT));
      assert.match(blocked.body, /טיוטה/);
      assert.match(blocked.body, /חוזה שכירות מאושר/);
      assert.match(blocked.body, /פרוטוקול מסירה מאושר/);
      assert.match(blocked.body, /לא עבר/);
      assert.match(blocked.body, /פרוטוקול מסירה — לא הוגש/);
      assert.match(blocked.body, /disabled/);
      assert.doesNotMatch(
        blocked.body,
        /action="\/estate\/tenancies\/[^"]+\/activate"/,
      );
      assert.doesNotMatch(blocked.body, /סיום ההשכרה/);

      const refused = await client.inject({
        method: 'POST',
        url: `/estate/tenancies/${tenancyId}/activate`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: '',
      });
      assert.equal(refused.statusCode, 400);
      assert.equal(refused.json().code, 'invalid');

      await linkType(pool, tenancyId, 'handover_protocol', 'פרוטוקול מסירה');

      const open = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.equal(open.statusCode, 200);
      assert.match(open.body, /עבר/);
      assert.doesNotMatch(open.body, /לא עבר/);
      assert.match(
        open.body,
        new RegExp(`action="/estate/tenancies/${tenancyId}/activate"`),
      );
      assert.doesNotMatch(open.body, /disabled/);

      const pressed = await client.inject({
        method: 'POST',
        url: `/estate/tenancies/${tenancyId}/activate`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: '',
      });
      assert.equal(pressed.statusCode, 302);
      assert.equal(pressed.headers.location, `/estate/tenancies/${tenancyId}`);

      const live = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.match(live.body, /פעיל/);
      assert.doesNotMatch(live.body, /הפעלת ההשכרה/);
      assert.match(
        live.body,
        new RegExp(
          `action="/estate/tenancies/${tenancyId}/end"[^>]*multipart/form-data`,
        ),
      );
      assert.match(live.body, /סיום ההשכרה/);
      assert.match(live.body, /עזיבה עתידית היא הודעה, לא סיום/);

      const boundary = '----end154';
      const ended = await client.inject({
        method: 'POST',
        url: `/estate/tenancies/${tenancyId}/end`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: [
          `--${boundary}`,
          'Content-Disposition: form-data; name="csrf"',
          '',
          who.csrf,
          `--${boundary}`,
          'Content-Disposition: form-data; name="actual_move_out"',
          '',
          '2026-09-15',
          `--${boundary}`,
          'Content-Disposition: form-data; name="notice_date"',
          '',
          '',
          `--${boundary}--`,
          '',
        ].join('\r\n'),
      });
      assert.equal(ended.statusCode, 302);
      assert.equal(ended.headers.location, `/estate/tenancies/${tenancyId}`);
      const after = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.match(after.body, /הופסק/);
      assert.doesNotMatch(after.body, /סיום ההשכרה/);
      const row = await pool.query<{
        status: string;
        end_date: string;
        actual_move_out: string;
      }>(
        `SELECT status, end_date::text, actual_move_out::text
           FROM tenancy WHERE tenancy_id = $1`,
        [tenancyId],
      );
      assert.equal(row.rows[0]?.status, 'TERMINATED_EARLY');
      assert.equal(row.rows[0]?.end_date, '2027-08-31');
      assert.equal(row.rows[0]?.actual_move_out, '2026-09-15');
    } finally {
      await a5Cleanup(pool);
      await signOutAll(pool, A5_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('names the date the button arms when only time remains', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(A5_AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await signOutAll(pool, A5_DOMAIN);
    await a5Cleanup(pool);
    const who = await signIn(pool, clock, { email: `ops@${A5_DOMAIN}` });
    const client = asOperator(app, who);
    try {
      await importEstate(pool, a5Plan);
      const unit = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2`,
        [A5_CITY, A5_ADDRESS],
      );
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), `a5-future-${A5_PROJECT}`],
      );
      const tenancyId = newId();
      const partyId = newId();
      await pool.query(
        `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
         VALUES ($1, $2, '2026-11-01', '2027-10-31', 'DRAFT', $3)`,
        [tenancyId, unit.rows[0]?.unit_id, profile.rows[0]?.terms_profile_id],
      );
      await pool.query(
        `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
        [partyId, A5_TENANT],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
        [tenancyId, partyId],
      );
      await linkType(pool, tenancyId, 'lease', 'חוזה שכירות');
      await linkType(pool, tenancyId, 'handover_protocol', 'פרוטוקול מסירה');

      const page = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /הכפתור נדלק ב־/);
      assert.match(page.body, /2026-11-01/);
      assert.match(page.body, /disabled/);
    } finally {
      await a5Cleanup(pool);
      await signOutAll(pool, A5_DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('shows rent from the tenancy row and cites approved captures only', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(A5_AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await signOutAll(pool, A5_DOMAIN);
    await a5Cleanup(pool);
    const who = await signIn(pool, clock, { email: `ops@${A5_DOMAIN}` });
    const client = asOperator(app, who);
    try {
      await importEstate(pool, a5Plan);
      const unit = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2`,
        [A5_CITY, A5_ADDRESS],
      );
      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), `a5-card-${A5_PROJECT}`],
      );
      const tenancyId = newId();
      const partyId = newId();
      await pool.query(
        `INSERT INTO tenancy (
           tenancy_id, unit_id, start_date, end_date, status, terms_profile_id,
           rent_amount, rent_currency, option_end_date
         ) VALUES ($1, $2, '2026-09-01', '2027-08-31', 'DRAFT', $3, 4500, 'ILS', '2028-08-31')`,
        [tenancyId, unit.rows[0]?.unit_id, profile.rows[0]?.terms_profile_id],
      );
      await pool.query(
        `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
        [partyId, A5_TENANT],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
        [tenancyId, partyId],
      );
      const documentId = await linkType(
        pool,
        tenancyId,
        `card-lease-${tenancyId}`,
        'חוזה שכירות',
      );
      const type = await pool.query<{ document_type_id: string }>(
        'SELECT document_type_id FROM document WHERE document_id = $1',
        [documentId],
      );
      const typeId = type.rows[0]?.document_type_id ?? '';
      const depositField = newId();
      const secretField = newId();
      const rentField = newId();
      await pool.query(
        `INSERT INTO document_type_field (
           document_type_field_id, document_type_id, field_key, label_he,
           value_type, is_required, extraction_hint, effective_from, effective_to
         ) VALUES
           ($1, $4, 'card_deposit', 'סכום הפיקדון', 'TEXT', false, NULL, '2020-01-01', NULL),
           ($2, $4, 'card_note', 'הערה', 'TEXT', false, NULL, '2020-01-01', NULL),
           ($3, $4, 'card_rent', 'דמי שכירות', 'TEXT', false, NULL, '2020-01-01', NULL)`,
        [depositField, secretField, rentField, typeId],
      );
      await pool.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'tenancy.rent_amount')`,
        [newId(), rentField],
      );
      const bbox = '{"x":1,"y":2,"width":3,"height":4}';
      const depositRow = newId();
      const secretRow = newId();
      const rentRow = newId();
      await pool.query(
        `INSERT INTO extracted_field (
           extracted_field_id, document_id, document_type_field_id, value,
           page, bbox, confidence, model, extracted_at
         ) VALUES
           ($1, $4, $5, '12000', 3, $8, null, 'fake', $9),
           ($2, $4, $6, 'UNAPPROVED-SECRET', 2, $8, null, 'fake', $9),
           ($3, $4, $7, '9999', 1, $8, null, 'fake', $9)`,
        [
          depositRow,
          secretRow,
          rentRow,
          documentId,
          depositField,
          secretField,
          rentField,
          bbox,
          A5_AT,
        ],
      );
      const stamper = await pool.connect();
      try {
        await stamper.query('BEGIN');
        await stamper.query("SELECT set_config('dona.approving', 'on', true)");
        await stamper.query(
          `UPDATE extracted_field
              SET approved_value = value, approved_by = 'ops@test', approved_at = $1
            WHERE extracted_field_id = ANY($2::uuid[])`,
          [A5_AT, [depositRow, rentRow]],
        );
        await stamper.query('COMMIT');
      } catch (error) {
        await stamper.query('ROLLBACK');
        throw error;
      } finally {
        stamper.release();
      }

      const page = await client.inject({
        method: 'GET',
        url: `/estate/tenancies/${tenancyId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /4500/);
      assert.match(page.body, /ILS/);
      assert.match(page.body, /2028-08-31/);
      assert.match(page.body, /12000/);
      assert.match(
        page.body,
        new RegExp(`href="/documents/${documentId}/read\\?page=3"`),
      );
      assert.doesNotMatch(page.body, /UNAPPROVED-SECRET/);
      assert.doesNotMatch(page.body, />9999</);
    } finally {
      await pool.query('ALTER TABLE extracted_field DISABLE TRIGGER USER');
      try {
        await pool.query(
          `DELETE FROM extracted_field WHERE document_id IN (
             SELECT d.document_id FROM document d
             JOIN document_type t ON t.document_type_id = d.document_type_id
             WHERE t.type_key LIKE 'card-lease-%')`,
        );
        await pool.query(
          `DELETE FROM field_promotion
          WHERE document_type_field_id IN (
            SELECT f.document_type_field_id FROM document_type_field f
            JOIN document_type t ON t.document_type_id = f.document_type_id
            WHERE t.type_key LIKE 'card-lease-%')`,
        );
        await a5Cleanup(pool);
        await pool.query(
          `DELETE FROM document WHERE document_type_id IN (
             SELECT document_type_id FROM document_type WHERE type_key LIKE 'card-lease-%')`,
        );
      } finally {
        await pool.query('ALTER TABLE extracted_field ENABLE TRIGGER USER');
      }
      await pool.query(
        `DELETE FROM document_type_field WHERE document_type_id IN (
           SELECT document_type_id FROM document_type WHERE type_key LIKE 'card-lease-%')`,
      );
      await pool.query(
        `DELETE FROM document_type WHERE type_key LIKE 'card-lease-%'`,
      );
      await signOutAll(pool, A5_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
