// #172 — בניינים stays served and stays unlinked.
//
// One crawl of every signed-in screen this fixture can open. A href to `/estate` or to
// `/estate/buildings/:id` is a failure, except on the old pages themselves and on A11 and A13,
// which are allowed to point at each other. Reverting the unit page, the נכסים list, search,
// חוזים מסתיימים, or a document screen is what this catches.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';

const DOMAIN = 'estate-hidden-flow.test';
const CITY = 'עיר מוסתרת';
const ADDRESS = 'רחוב מוסתר 4';
const PROJECT = 'TEST-HIDDEN-172';
const BUILDING_NAME = 'בניין מוסתר';
const WHEN = new Date('2026-09-29T09:00:00.000Z');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז מוסתר',
      projectCode: PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: BUILDING_NAME,
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [{ kind: 'UNIT', name: 'דירה 3', floor: '1', accessNote: null }],
      units: [
        {
          spaceName: 'דירה 3',
          unitNumber: '3',
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

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

function bare(href: string): string {
  const text = href.replaceAll('&amp;', '&').split('#')[0] ?? href;
  return text.split('?')[0] ?? text;
}

function isOldTarget(href: string): boolean {
  const path = bare(href);
  if (path === '/estate' || path === '/estate/') return true;
  return new RegExp(`^/estate/buildings/${UUID}/?$`, 'i').test(path);
}

/** The old list, the old building page, A11, and A13. Their links to each other stay. */
function isExempt(url: string): boolean {
  const path = bare(url);
  if (path === '/estate' || path === '/estate/') return true;
  if (path === '/estate/buildings/new') return true;
  if (new RegExp(`^/estate/buildings/${UUID}/?$`, 'i').test(path)) return true;
  return new RegExp(`^/estate/buildings/${UUID}/units/new$`, 'i').test(path);
}

function enqueueable(href: string): string | null {
  const text = href.replaceAll('&amp;', '&').split('#')[0] ?? '';
  if (!text.startsWith('/') || text.startsWith('//')) return null;
  const path = bare(text);
  if (
    path.startsWith('/ui/') ||
    path === '/staff/logout' ||
    path === '/health'
  ) {
    return null;
  }
  return text;
}

async function cleanup(pool: Pool): Promise<void> {
  const buildings = `(SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`;
  const units = `(SELECT space_id FROM space s WHERE s.building_id IN ${buildings})`;
  const documents = `(SELECT document_id FROM document WHERE storage_uri LIKE 'gs://dona-hidden-172/%')`;
  const place = [CITY, ADDRESS];
  await pool.query(
    'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
  );
  try {
    for (const statement of [
      `DELETE FROM document_passage WHERE document_id IN ${documents}`,
      `DELETE FROM document_link WHERE document_id IN ${documents}`,
      `DELETE FROM document WHERE document_id IN ${documents}`,
    ]) {
      await pool.query(statement);
    }
    for (const statement of [
      `DELETE FROM tenancy_event WHERE tenancy_id IN (
         SELECT t.tenancy_id FROM tenancy t WHERE t.unit_id IN ${units})`,
      `DELETE FROM tenancy_party WHERE tenancy_id IN (
         SELECT t.tenancy_id FROM tenancy t WHERE t.unit_id IN ${units})`,
      `DELETE FROM tenancy_completeness_exception WHERE tenancy_id IN (
         SELECT t.tenancy_id FROM tenancy t WHERE t.unit_id IN ${units})`,
      `DELETE FROM tenancy WHERE unit_id IN ${units}`,
      `DELETE FROM unit WHERE unit_id IN ${units}`,
      `DELETE FROM space WHERE building_id IN ${buildings}`,
      `DELETE FROM building WHERE city = $1 AND address_line = $2`,
    ]) {
      await pool.query(statement, place);
    }
    await pool.query('DELETE FROM project WHERE project_code = $1', [PROJECT]);
    await pool.query('DELETE FROM terms_profile WHERE name = $1', [
      `hidden-${PROJECT}`,
    ]);
  } finally {
    await pool.query(
      'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
    );
  }
}

describe('estate · the hidden buildings flow', () => {
  it('links the old building pages from nowhere except themselves and A11/A13', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(WHEN);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      await importEstate(pool, plan);
      const found = await pool.query<{
        building_id: string;
        unit_id: string;
      }>(
        `SELECT b.building_id, u.unit_id
           FROM building b
           JOIN space s ON s.building_id = b.building_id
           JOIN unit u ON u.unit_id = s.space_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY, ADDRESS],
      );
      const buildingId = found.rows[0]?.building_id ?? '';
      const unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(buildingId && unitId);

      const profile = await pool.query<{ terms_profile_id: string }>(
        `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING terms_profile_id`,
        [newId(), `hidden-${PROJECT}`],
      );
      await pool.query(
        `INSERT INTO tenancy (
           tenancy_id, unit_id, start_date, end_date, status, terms_profile_id
         ) VALUES ($1, $2, '2026-01-01', '2026-10-20', 'ACTIVE', $3)`,
        [newId(), unitId, profile.rows[0]?.terms_profile_id],
      );

      const type = await pool.query<{ document_type_id: string }>(
        `INSERT INTO document_type (
           document_type_id, type_key, label_he, label_en, verification_terms, is_active
         ) VALUES ($1, 'lease', 'חוזה שכירות', NULL, NULL, true)
         ON CONFLICT (type_key) DO UPDATE SET type_key = EXCLUDED.type_key
         RETURNING document_type_id`,
        [newId()],
      );
      const typeId = type.rows[0]?.document_type_id ?? '';
      const zeros = `[${Array.from({ length: embeddingColumnDimensions }, () => '0').join(',')}]`;
      const filed: Array<{ id: string; place: 'building' | 'unit' }> = [
        { id: newId(), place: 'building' },
        { id: newId(), place: 'unit' },
      ];
      for (const doc of filed) {
        const hash = digest(`hidden-172-${doc.id}`);
        const placeId = doc.place === 'building' ? buildingId : unitId;
        await pool.query(
          `INSERT INTO document (
             document_id, document_type_id, storage_uri, file_hash,
             ingested_at, verification_verdict
           ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
          [
            doc.id,
            typeId,
            `gs://dona-hidden-172/${doc.place}/${placeId}/lease/${hash}.pdf`,
            hash,
            WHEN,
          ],
        );
        await pool.query(
          `INSERT INTO document_passage (
             document_passage_id, document_id, page, ordinal, body, embedding
           ) VALUES ($1, $2, 1, 0, 'עמוד', $3::vector)`,
          [newId(), doc.id, zeros],
        );
        await pool.query(
          `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
           VALUES ($1, $2, $3, 'SUBJECT')`,
          [doc.id, doc.place === 'building' ? 'BUILDING' : 'UNIT', placeId],
        );
      }

      const search = `/estate/search?q=${encodeURIComponent(BUILDING_NAME)}`;
      const queue = ['/', search];
      const seen = new Set<string>();
      const htmlOf = new Map<string, string>();
      const violations: string[] = [];
      const broken: string[] = [];

      while (queue.length > 0 && seen.size < 200) {
        const url = queue.shift();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const response = await client.inject({ method: 'GET', url });
        const type = String(response.headers['content-type'] ?? '');
        if (response.statusCode !== 200 || !type.includes('text/html')) {
          // The list screens are the whole portfolio. A document filed outside this
          // fixture has no bytes in the test store, so its read page is not one of
          // the screens this case opened.
          const foreign = /^\/documents\/([0-9a-f-]{36})\//i.exec(bare(url));
          const ours = filed.some((doc) => doc.id === foreign?.[1]);
          if (!foreign || ours) broken.push(`${response.statusCode} ${url}`);
          continue;
        }
        htmlOf.set(url, response.body);
        if (!isExempt(url)) {
          for (const match of response.body.matchAll(/href="([^"]*)"/g)) {
            const href = match[1] ?? '';
            if (isOldTarget(href)) violations.push(`${url} → ${href}`);
          }
        }
        for (const match of response.body.matchAll(/href="([^"]*)"/g)) {
          const next = enqueueable(match[1] ?? '');
          if (next && !seen.has(next)) queue.push(next);
        }
      }
      if (queue.length > 0) broken.push('crawl stopped at 200 screens');

      const oldList = await client.inject({ method: 'GET', url: '/estate' });
      const oldBuilding = await client.inject({
        method: 'GET',
        url: `/estate/buildings/${buildingId}`,
      });
      assert.equal(oldList.statusCode, 200);
      assert.equal(oldBuilding.statusCode, 200);
      assert.match(oldList.body, /<h1>בניינים<\/h1>/);
      assert.match(
        oldBuilding.body,
        new RegExp(`href="/estate/buildings/${buildingId}/units/new"`),
      );

      const home = htmlOf.get('/') ?? '';
      assert.match(home, /href="\/estate\/inventory"/);
      assert.match(home, />נכסים</);
      assert.doesNotMatch(home, /nav-label">בניינים</);

      const mustVisit = [
        '/',
        '/estate/inventory',
        `/estate/inventory/${buildingId}`,
        `/estate/units/${unitId}`,
        search,
        '/estate/expiring',
        '/documents/new',
        `/documents/new?unit=${unitId}`,
        ...filed.flatMap((doc) => [
          `/documents/${doc.id}/read`,
          `/documents/${doc.id}/fields`,
        ]),
      ];
      const missed = mustVisit.filter((url) => !htmlOf.has(url));
      assert.deepEqual(missed, [], 'screens the fixture should have opened');
      assert.deepEqual(broken, []);
      assert.deepEqual(violations, []);

      const expiring = htmlOf.get('/estate/expiring') ?? '';
      assert.match(
        expiring,
        new RegExp(`href="/estate/inventory/${buildingId}"`),
      );
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
