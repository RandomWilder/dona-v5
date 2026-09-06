// What the screens read. Slice 1.11.
//
// The claim worth a suite is the first one: **`unit_count` is counted and never stored** (R6). A
// number on a screen is exactly where a stored count would be convenient, so this is where the rule
// has to hold — `src/estate/schema.test.ts` asserts the column does not exist, and this asserts the
// count is right without it.
//
// Everything here runs against a real Postgres inside a rolled-back transaction: the read model is
// SQL, and a fake would prove this file and that file agree.
//
// The fixture carries a city of its own and every assertion is scoped to it. `listBuildings` returns
// the whole table by design — it is what the screen shows — so a case that asserted on its length
// would be asserting about whatever else is in the database, which on a developer's machine is the
// seed and in CI is whichever suite committed first.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { BuildingSummary, EstatePlan } from './contract.ts';
import { getBuilding, importEstate, listBuildings } from './contract.ts';
import { shohamPlan } from './fixtures/shoham.ts';

const CITY = 'שוהם — בדיקת מודל קריאה';

/** The Shoham fixture at a city of its own, so nothing else can answer for it. */
function plan(): EstatePlan {
  const built = shohamPlan();
  built.projects[0].projectCode = 'SHM-READ-TEST';
  built.buildings[0].projectCode = 'SHM-READ-TEST';
  built.buildings[0].city = CITY;
  return built;
}

/**
 * The building this suite created, out of everything the screen lists.
 *
 * `find`, and deliberately not "assert there is exactly one row": `listBuildings` returns the whole
 * table because that is what the screen shows, and every other row belongs to another suite, to a
 * developer's `npm run seed`, or to whatever lands here next year. A case that asserts on rows it
 * did not create is a case that fails for someone else's reason.
 */
function ours(buildings: BuildingSummary[]): BuildingSummary {
  const found = buildings.find((building) => building.city === CITY);
  assert.ok(found, 'the building this suite imported is in the list');
  return found;
}

describe('estate · the read model', () => {
  it('serves the two screens', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'counts the units rather than reading a column',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, shohamPlan());
            const buildings = await listBuildings(db);
            assert.equal(buildings.length, 1);
            const building = buildings[0];
            assert.equal(building.unit_count, '72');
            assert.equal(building.space_count, '184');
            assert.equal(building.city, 'שוהם');
            assert.equal(building.project_code, 'SHM-01');
            // Cast in SQL, not converted in JavaScript: a date that arrives as a JS Date at local
            // midnight is a date that moves when the server's timezone does.
            assert.equal(building.handover_date, '2025-03-01');
          });
        },
      );

      await t.test('shows a building with no project (R15)', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const withoutProject = plan();
          withoutProject.projects = [];
          withoutProject.buildings[0].projectCode = null;
          await importEstate(db, withoutProject);
          const building = ours(await listBuildings(db));
          assert.equal(building.project_code, null);
          assert.equal(building.project_name, null);
          assert.equal(building.unit_count, '72');
        });
      });

      await t.test('orders units by number and not by text', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, plan());
          const summary = ours(await listBuildings(db));
          const detail = await getBuilding(db, summary.building_id);
          const numbers = detail.units.map((unit) => unit.unit_number);
          assert.equal(numbers.length, 72);
          // '10' sorts before '2' as text, which is the one thing a list of 72 apartments must not
          // do. The split unit's letter breaks the tie after the digits, so 12A and 12B are
          // adjacent and in order.
          assert.deepEqual(numbers.slice(0, 14), [
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            '10',
            '11',
            '12A',
            '12B',
            '13',
          ]);
          assert.equal(numbers[71], '71');
        });
      });

      await t.test(
        'carries what a unit card shows, gaps included',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, shohamPlan());
            const [summary] = await listBuildings(db);
            const detail = await getBuilding(db, summary.building_id);

            const first = detail.units[0];
            assert.equal(first.unit_number, '1');
            assert.equal(first.floor, '1');
            assert.equal(first.rooms, '3');
            assert.equal(first.has_mamad, false);
            assert.equal(first.parking_name, 'ח-1');
            assert.equal(first.storage_name, 'מ-1');

            // The unassigned case is the ordinary one (D3), and something has to render the gap.
            const last = detail.units[71];
            assert.equal(last.parking_name, null);
            assert.equal(last.storage_name, null);

            assert.equal(
              detail.units.filter((unit) => unit.area_sqm === null).length,
              4,
            );
            assert.equal(
              detail.units.filter((unit) => unit.warranty_end_date !== null)
                .length,
              2,
            );

            // Every space kind, largest first — the chips on the building screen.
            assert.deepEqual(
              detail.kinds.map((kind) => [kind.space_kind, kind.n]),
              [
                ['UNIT', '72'],
                ['PARKING', '60'],
                ['STORAGE', '40'],
                ['COMMON', '5'],
                ['TECHNICAL', '4'],
                ['EXTERIOR', '3'],
              ],
            );
          });
        },
      );

      await t.test('refuses an id that is not there', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await assert.rejects(
            () => getBuilding(db, '11111111-1111-4111-8111-111111111111'),
            (error: { code?: string; message?: string }) =>
              error.code === 'not_found' &&
              error.message === 'building not found',
          );
        });
      });
    } finally {
      await pool.end();
    }
  });
});
