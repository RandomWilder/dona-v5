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
//
// **That rule was written at 1.11 and two cases in this file did not follow it**, which slice 1.12
// found the way it is always found: a red `gate` on a pull request whose diff was markdown. They
// imported the seed fixture's own city and read `listBuildings(db)[0]`, so `src/estate/routes.test.ts`
// — which has to commit, because the routes read through the pool — could answer for them. Every
// case here now imports `plan()` and finds its building with `ours()`. `shohamPlan` is imported by
// `plan()` alone.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { BuildingSummary, EstatePlan } from './contract.ts';
import {
  countUnitsByBuilding,
  getBuilding,
  importEstate,
  listBuildings,
  listExpiringLeases,
  searchEstate,
} from './contract.ts';
import { shohamPlan } from './fixtures/shoham.ts';

const CITY = 'שוהם — בדיקת מודל קריאה';
/** Unique to this suite, so a search for it cannot be answered by another suite's rows. */
const BUILDING = 'בניין בדיקת מודל קריאה';

/** The Shoham fixture at a city of its own, so nothing else can answer for it. */
function plan(): EstatePlan {
  const built = shohamPlan();
  built.projects[0].projectCode = 'SHM-READ-TEST';
  built.buildings[0].projectCode = 'SHM-READ-TEST';
  built.buildings[0].city = CITY;
  built.buildings[0].name = BUILDING;
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
            await importEstate(db, plan());
            const building = ours(await listBuildings(db));
            assert.equal(building.unit_count, '72');
            assert.equal(building.space_count, '184');
            // The project join, which is the other half of what this row is: a building carries its
            // project's code and name without storing either.
            assert.equal(building.project_code, 'SHM-READ-TEST');
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
            await importEstate(db, plan());
            const summary = ours(await listBuildings(db));
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

// Slice 2.6. The portfolio-scale reads, and every case scoped to this suite's own city for 1.11's
// reason: these queries are whole-portfolio by design, so a case that asserted on a count would be
// asserting on whatever else is in the database — a developer's seed, a generated register, another
// suite's rows. `find` and `filter`, never `length` of the whole answer.
describe('estate · the portfolio-scale reads', () => {
  it('searches, lists what is ending, and counts by building', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'finds a building by its name, and a city narrows to buildings',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, plan());
            const byName = await searchEstate(db, BUILDING);
            assert.ok(
              byName.buildings.some((building) => building.city === CITY),
              'the building is in the buildings half',
            );
            assert.ok(
              byName.units.some((unit) => unit.city === CITY),
              'its units are in the units half',
            );
            // The asymmetry the read model states, asserted rather than assumed: a city holds
            // hundreds of apartments, and sixty arbitrary ones is a worse answer than the buildings
            // that contain them.
            const byCity = await searchEstate(db, CITY);
            assert.ok(
              byCity.buildings.some((building) => building.city === CITY),
            );
            assert.equal(
              byCity.units.filter((unit) => unit.city === CITY).length,
              0,
            );
          });
        },
      );

      await t.test('treats a wildcard as text, not as a wildcard', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, plan());
          // The whole of the escaping decision, asserted rather than reasoned about: unescaped, `%`
          // is every building in the portfolio and `_` is every one-character name. A search box is
          // user input and a bound parameter is not the same thing as a safe pattern.
          const wild = await searchEstate(db, '%');
          assert.equal(wild.buildings.length, 0, 'a lone % matched rows');
          assert.equal(wild.units.length, 0);
          const underscore = await searchEstate(db, '_');
          assert.equal(underscore.buildings.length, 0);
        });
      });

      await t.test(
        'lists a lease ending inside the window and not one outside it',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, plan());
            const unit = await db.query<{ unit_id: string }>(
              `SELECT u.unit_id FROM unit u
               JOIN space s ON s.space_id = u.unit_id
               JOIN building b ON b.building_id = s.building_id
              WHERE b.city = $1 ORDER BY u.unit_number LIMIT 2`,
              [CITY],
            );
            const [soon, later] = unit.rows;
            assert.ok(soon && later);
            const profile = await db.query<{ terms_profile_id: string }>(
              `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING terms_profile_id`,
              [
                '88888888-8888-4888-8888-888888888888',
                'נספח — בדיקת מודל קריאה',
              ],
            );
            const today = new Date('2026-09-06T00:00:00Z');
            for (const [unitId, end] of [
              [soon.unit_id, '2026-10-01'],
              [later.unit_id, '2027-10-01'],
            ] as const) {
              await db.query(
                `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                                    terms_profile_id)
               VALUES ($1, $2, '2025-01-01', $3, 'ACTIVE', $4)`,
                [newId(), unitId, end, profile.rows[0]?.terms_profile_id],
              );
            }
            const ending = await listExpiringLeases(db, today);
            const mine = ending.filter((lease) => lease.city === CITY);
            assert.deepEqual(
              mine.map((lease) => [
                lease.unit_id,
                lease.end_date,
                lease.days_left,
              ]),
              [[soon.unit_id, '2026-10-01', 25]],
            );
          });
        },
      );

      await t.test('counts the units it was given, by building', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, plan());
          const summary = ours(await listBuildings(db));
          const detail = await getBuilding(db, summary.building_id);
          const some = detail.units.slice(0, 5).map((unit) => unit.unit_id);
          const counted = await countUnitsByBuilding(db, some);
          assert.equal(counted.get(summary.building_id), 5);
          // The empty case is the buildings list on a morning when nothing is let, and an `= ANY`
          // over an empty array is a query worth not running.
          assert.equal((await countUnitsByBuilding(db, [])).size, 0);
        });
      });
    } finally {
      await pool.end();
    }
  });
});
