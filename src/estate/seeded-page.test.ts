// What a seeded building shows on נכסים — SPEC-estate.md, "Tenure, and what a developer sheet adds
// to a flat". A sold flat is neither let nor vacant; a flat for sale is still vacant stock; a
// disabled bay says נכה; a storage room carries its area; a flat its type.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan, UnitPlan } from './contract.ts';
import { seedBuilding } from './contract.ts';

const DOMAIN = 'estate-seeded-page.test';
const CITY = 'עיר זריעה בדף';

function flat(n: string, extra: Partial<UnitPlan>): UnitPlan {
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
    ...extra,
  };
}

function plan(): EstatePlan {
  return {
    projects: [],
    buildings: [
      {
        name: 'בניין זריעה',
        addressLine: 'רחוב זריעה 3',
        city: CITY,
        projectCode: null,
        handoverDate: '2026-09-01',
        warrantyEndDate: '2028-09-01',
        status: 'ACTIVE',
        spaces: [
          { kind: 'UNIT', name: '1', floor: '1', accessNote: null },
          { kind: 'UNIT', name: '2', floor: '1', accessNote: null },
          { kind: 'UNIT', name: '3', floor: '2', accessNote: null },
          {
            kind: 'PARKING',
            name: '114',
            floor: '-1',
            accessNote: null,
            disabledBay: true,
          },
          {
            kind: 'STORAGE',
            name: '101',
            floor: '-1',
            accessNote: null,
            areaSqm: 6.2,
          },
        ],
        units: [
          flat('1', {
            tenure: 'FOR_RENT',
            flatType: 'BG',
            rentalTrack: 'REGULATED',
          }),
          flat('2', { tenure: 'FOR_SALE' }),
          flat('3', { tenure: 'SOLD', balconySqm: 14 }),
        ],
      },
    ],
  };
}

async function cleanup(pool: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  for (const statement of [
    `DELETE FROM unit WHERE unit_id IN (
       SELECT space_id FROM space s JOIN building b ON b.building_id = s.building_id
       WHERE b.city = $1)`,
    `DELETE FROM space WHERE building_id IN (SELECT building_id FROM building WHERE city = $1)`,
    'DELETE FROM building WHERE city = $1',
  ]) {
    await pool.query(statement, [CITY]);
  }
}

describe('estate · a seeded building on נכסים', () => {
  it('shows tenure, the disabled bay, the storage area and the type', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);
    const admin = await signIn(pool, systemClock, {
      email: `seeded@${DOMAIN}`,
      role: 'ADMIN',
    });
    try {
      const { buildingId } = await seedBuilding(pool, plan(), {
        update: false,
      });
      const client = asOperator(app, admin);
      const page = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}`,
      });
      assert.equal(page.statusCode, 200);
      const html = page.body;
      // Three flats, none let: the sold one is not vacant stock.
      assert.match(
        html,
        /דירות פנויות<\/span><span class="stat-value"><span dir="ltr">2<\/span>/,
      );
      assert.match(html, /2 פנויות|<span dir="ltr">2<\/span> פנויות/);
      assert.match(html, /נמכרה/);
      assert.match(html, /למכירה/);
      assert.match(html, /<span class="sub">נכה<\/span>/);
      assert.match(html, /<span dir="ltr">6\.2<\/span> מ״ר/);
      assert.match(html, /טיפוס <span dir="ltr">BG<\/span>/);
      assert.match(html, /<span class="sub">מפוקח<\/span>/);
      assert.match(html, /סינון לפי מסלול/);
      assert.match(html, /שוק חופשי <span class="n"><span dir="ltr">2<\/span>/);
      assert.match(html, /מפוקח <span class="n"><span dir="ltr">1<\/span>/);

      const ids = await pool.query<{ unit_number: string; unit_id: string }>(
        `SELECT u.unit_number, u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         WHERE s.building_id = $1`,
        [buildingId],
      );
      const idOf = (n: string) =>
        ids.rows.find((row) => row.unit_number === n)?.unit_id ?? '';
      const regulated = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}?track=REGULATED`,
      });
      assert.equal(regulated.statusCode, 200);
      assert.match(regulated.body, new RegExp(`/estate/units/${idOf('1')}`));
      assert.doesNotMatch(
        regulated.body,
        new RegExp(`/estate/units/${idOf('2')}`),
      );
      assert.doesNotMatch(
        regulated.body,
        new RegExp(`/estate/units/${idOf('3')}`),
      );
      const refused = await client.inject({
        method: 'GET',
        url: `/estate/inventory/${buildingId}?track=CAPPED`,
      });
      assert.equal(refused.statusCode, 400);

      const sold = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
         WHERE s.building_id = $1 AND u.unit_number = '3'`,
        [buildingId],
      );
      const unitPage = await client.inject({
        method: 'GET',
        url: `/estate/units/${sold.rows[0]?.unit_id}`,
      });
      assert.equal(unitPage.statusCode, 200);
      assert.match(unitPage.body, /<span class="chip">נמכרה<\/span>/);
      assert.match(unitPage.body, /<span class="chip">שוק חופשי<\/span>/);
      assert.match(unitPage.body, /מרפסת <span dir="ltr">14<\/span> מ״ר/);
      const regulatedFlat = await client.inject({
        method: 'GET',
        url: `/estate/units/${idOf('1')}`,
      });
      assert.equal(regulatedFlat.statusCode, 200);
      assert.match(regulatedFlat.body, /<span class="chip">מפוקח<\/span>/);
    } finally {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
