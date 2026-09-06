// The importer's one property: **the same plan applied twice leaves the same rows, with the same
// ids.** Slice 1.11.
//
// This suite was red before `0005_estate_natural_keys.sql` existed, and red in the way that matters:
// against `0004` alone the second run inserted a second building and another 72 units, because
// nothing in the estate spine was unique but its primary keys. The numbers are in
// tasks/evidence/1.11.md. A test written after the constraint asserts what the code already did and
// keeps passing once someone removes it.
//
// **Every plan below carries a city of its own, and none of them is the seed fixture's.** These
// cases run in a rolled-back transaction against a database other suites are using at the same
// moment — `node --test` runs files in parallel, and `src/estate/routes.test.ts` commits — and a
// developer who has run `npm run seed` has רקפת 12 committed too. So nothing here counts a whole
// table: the report is a fact about the plan, and every query is scoped to the building it is about.
// The first version of this file counted tables, passed locally, and went red in CI within the hour.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';
import { shohamPlan } from './fixtures/shoham.ts';

const CITY = 'שוהם — בדיקת ייבוא';
const FIXTURE_CITY = 'שוהם — בדיקת פיקסצ׳ר';

// A two-unit building, so the cases about identity are not read through 72 rows. The Shoham plan
// itself is exercised at the bottom, where the acceptance bar is a count.
function smallPlan(
  overrides: Partial<EstatePlan['buildings'][number]> = {},
): EstatePlan {
  return {
    projects: [
      {
        name: 'שוהם — רקפת',
        projectCode: 'SHM-IMPORT-TEST',
        tenderRef: '2024/17',
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: 'בניין רקפת 12',
        addressLine: 'רקפת 12',
        city: CITY,
        projectCode: 'SHM-IMPORT-TEST',
        handoverDate: '2025-03-01',
        warrantyEndDate: '2027-03-01',
        status: 'ACTIVE',
        spaces: [
          { kind: 'UNIT', name: 'דירה 1', floor: '1', accessNote: null },
          { kind: 'UNIT', name: 'דירה 2', floor: '1', accessNote: null },
          { kind: 'COMMON', name: 'לובי', floor: 'קרקע', accessNote: null },
          { kind: 'PARKING', name: 'ח-1', floor: 'מרתף', accessNote: null },
          { kind: 'STORAGE', name: 'מ-1', floor: 'מרתף', accessNote: null },
        ],
        units: [
          {
            spaceName: 'דירה 1',
            unitNumber: '1',
            rooms: 3.5,
            areaSqm: 78.5,
            hasMamad: false,
            parkingSpaceName: 'ח-1',
            storageSpaceName: 'מ-1',
            warrantyEndDate: null,
            conditionStatus: 'READY',
          },
          {
            spaceName: 'דירה 2',
            unitNumber: '2',
            rooms: 4,
            areaSqm: null,
            hasMamad: true,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'RENOVATION',
          },
        ],
        ...overrides,
      },
    ],
  };
}

/** The Shoham fixture, at a city of its own so a seeded database cannot answer for it. */
function shohamTestPlan(): EstatePlan {
  const plan = shohamPlan();
  plan.projects[0].projectCode = 'SHM-FIXTURE-TEST';
  plan.buildings[0].projectCode = 'SHM-FIXTURE-TEST';
  plan.buildings[0].city = FIXTURE_CITY;
  return plan;
}

/** Every building id and unit id in one city, ordered. Never an unscoped `SELECT ... FROM unit`. */
async function idsIn(db: PoolClient, city: string): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT b.building_id AS id FROM building b WHERE b.city = $1
     UNION ALL
     SELECT u.unit_id FROM unit u
     JOIN space s ON s.space_id = u.unit_id
     JOIN building b ON b.building_id = s.building_id
     WHERE b.city = $1
     ORDER BY id`,
    [city],
  );
  return result.rows.map((row) => row.id);
}

describe('estate · the import runs twice', () => {
  it('is a no-op the second time, down to the ids', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'the first run creates, the second only updates',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const first = await importEstate(db, smallPlan());
            assert.deepEqual(first, {
              project: { created: 1, updated: 0 },
              building: { created: 1, updated: 0 },
              space: { created: 5, updated: 0 },
              unit: { created: 2, updated: 0 },
            });

            const afterFirst = await idsIn(db, CITY);

            const second = await importEstate(db, smallPlan());
            assert.deepEqual(second, {
              project: { created: 0, updated: 1 },
              building: { created: 0, updated: 1 },
              space: { created: 0, updated: 5 },
              unit: { created: 0, updated: 2 },
            });

            // `created: 0` is the weak half of the claim. The ids staying still is the strong half:
            // a re-import that renumbered every unit would satisfy a count and break everything
            // that ever pointed at one.
            assert.deepEqual(await idsIn(db, CITY), afterFirst);
          });
        },
      );

      await t.test(
        'an address that differs only in spacing and case is the same building',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const first = await importEstate(db, smallPlan());
            assert.equal(first.building.created, 1);
            // What a second export of the same building looks like. `address_key` normalises it in
            // the database, so no importer has to remember to.
            const second = await importEstate(
              db,
              smallPlan({ addressLine: '  רקפת   12 ' }),
            );
            assert.deepEqual(second.building, { created: 0, updated: 1 });
            const buildings = await db.query<{ n: string }>(
              'SELECT count(*) AS n FROM building WHERE city = $1',
              [CITY],
            );
            assert.equal(buildings.rows[0]?.n, '1');
          });
        },
      );

      await t.test(
        'a re-import corrects a changed fact rather than duplicating it',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, smallPlan());
            const corrected = smallPlan();
            const unit = corrected.buildings[0].units[1];
            unit.areaSqm = 92.5;
            unit.conditionStatus = 'READY';
            await importEstate(db, corrected);
            const row = await db.query<{
              area_sqm: string;
              condition_status: string;
            }>(
              `SELECT u.area_sqm, u.condition_status FROM unit u
               JOIN space s ON s.space_id = u.unit_id
               JOIN building b ON b.building_id = s.building_id
               WHERE b.city = $1 AND u.unit_number = '2'`,
              [CITY],
            );
            assert.equal(row.rowCount, 1);
            assert.equal(Number(row.rows[0]?.area_sqm), 92.5);
            assert.equal(row.rows[0]?.condition_status, 'READY');
          });
        },
      );

      await t.test(
        'the Shoham plan is 1 building, 184 spaces and 72 units',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const report = await importEstate(db, shohamTestPlan());
            assert.equal(report.building.created, 1);
            assert.equal(report.space.created, 184);
            assert.equal(report.unit.created, 72);

            // Coverage, asserted rather than described: a fixture that quietly became 72 identical
            // apartments would still satisfy the counts above. Scoped to this building, because the
            // database is shared and the numbers would otherwise be somebody else's.
            const shape = await db.query<Record<string, string>>(
              `WITH b AS (SELECT building_id FROM building WHERE city = $1),
                    u AS (SELECT unit.* FROM unit
                          JOIN space s ON s.space_id = unit.unit_id
                          JOIN b ON b.building_id = s.building_id)
               SELECT (SELECT count(DISTINCT s.space_kind)::text FROM space s
                        JOIN b ON b.building_id = s.building_id) AS kinds,
                      (SELECT count(*)::text FROM u WHERE has_mamad = false) AS no_mamad,
                      (SELECT count(*)::text FROM u WHERE area_sqm IS NULL) AS unmeasured,
                      (SELECT count(*)::text FROM u WHERE warranty_end_date IS NOT NULL)
                        AS own_warranty,
                      (SELECT count(*)::text FROM u WHERE parking_space_id IS NULL)
                        AS unassigned_parking,
                      (SELECT count(*)::text FROM u WHERE condition_status <> 'READY') AS not_ready,
                      (SELECT count(*)::text FROM u WHERE unit_number ~ '[A-Z]$') AS split`,
              [FIXTURE_CITY],
            );
            assert.deepEqual(shape.rows[0], {
              kinds: '6',
              no_mamad: '6',
              unmeasured: '4',
              own_warranty: '2',
              unassigned_parking: '12',
              not_ready: '4',
              split: '2',
            });
          });
        },
      );

      await t.test('the Shoham plan is a no-op the second time', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, shohamTestPlan());
          const second = await importEstate(db, shohamTestPlan());
          assert.deepEqual(second.building, { created: 0, updated: 1 });
          assert.deepEqual(second.space, { created: 0, updated: 184 });
          assert.deepEqual(second.unit, { created: 0, updated: 72 });
        });
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a plan that is wrong before it reaches a constraint', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      const cases: Array<[string, () => EstatePlan]> = [
        [
          'a unit on a space that is not in the plan',
          () => {
            const plan = smallPlan();
            plan.buildings[0].units[0].spaceName = 'דירה 9';
            return plan;
          },
        ],
        [
          'a parking assignment pointing at a storage room',
          () => {
            const plan = smallPlan();
            plan.buildings[0].units[0].parkingSpaceName = 'מ-1';
            return plan;
          },
        ],
        [
          'two spaces with one kind and one name',
          () => {
            const plan = smallPlan();
            plan.buildings[0].spaces.push({
              kind: 'UNIT',
              name: 'דירה 1',
              floor: '1',
              accessNote: null,
            });
            return plan;
          },
        ],
        [
          'a building naming a project that is not in the plan',
          () => {
            const plan = smallPlan();
            plan.buildings[0].projectCode = 'SHM-NOT-IN-PLAN';
            return plan;
          },
        ],
      ];
      for (const [name, build] of cases) {
        await t.test(name, async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await assert.rejects(
              () => importEstate(db, build()),
              (error: { code?: string }) => error.code === 'invalid',
            );
          });
        });
      }
    } finally {
      await pool.end();
    }
  });
});
