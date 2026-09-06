// The importer's one property: **the same plan applied twice leaves the same rows, with the same
// ids.** Slice 1.11.
//
// This suite was red before `0005_estate_natural_keys.sql` existed, and red in the way that matters:
// against `0004` alone the second run inserted a second building and another 72 units, because
// nothing in the estate spine was unique but its primary keys. The numbers are in
// tasks/evidence/1.11.md. A test written after the constraint asserts what the code already did and
// keeps passing once someone removes it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { EstatePlan } from './contract.ts';
import { importEstate } from './contract.ts';
import { shohamPlan } from './fixtures/shoham.ts';
import { inEmptyEstate } from './test-support.ts';

// A two-unit building, so the cases about identity are not read through 72 rows. The Shoham plan
// itself is exercised once, at the bottom, where the acceptance bar is a count.
function smallPlan(
  overrides: Partial<EstatePlan['buildings'][number]> = {},
): EstatePlan {
  return {
    projects: [
      {
        name: 'שוהם — רקפת',
        projectCode: 'SHM-01',
        tenderRef: '2024/17',
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: 'בניין רקפת 12',
        addressLine: 'רקפת 12',
        city: 'שוהם',
        projectCode: 'SHM-01',
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

async function idsOf(
  db: PoolClient,
  table: string,
  key: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT ${key} AS id FROM ${table} ORDER BY ${key}`,
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
        'the first run creates, the second creates nothing',
        async () => {
          await inEmptyEstate(pool, async (db) => {
            const first = await importEstate(db, smallPlan());
            assert.deepEqual(
              {
                project: first.project.created,
                building: first.building.created,
                space: first.space.created,
                unit: first.unit.created,
              },
              { project: 1, building: 1, space: 5, unit: 2 },
            );

            const buildingsAfterFirst = await idsOf(
              db,
              'building',
              'building_id',
            );
            const unitsAfterFirst = await idsOf(db, 'unit', 'unit_id');

            const second = await importEstate(db, smallPlan());
            assert.deepEqual(
              {
                project: second.project.created,
                building: second.building.created,
                space: second.space.created,
                unit: second.unit.created,
              },
              { project: 0, building: 0, space: 0, unit: 0 },
            );

            // The count staying still is the weak half of the claim. The ids staying still is the
            // strong half: a re-import that renumbered every unit would satisfy a count and break
            // everything that ever pointed at one.
            assert.deepEqual(
              await idsOf(db, 'building', 'building_id'),
              buildingsAfterFirst,
            );
            assert.deepEqual(
              await idsOf(db, 'unit', 'unit_id'),
              unitsAfterFirst,
            );
          });
        },
      );

      await t.test(
        'an address that differs only in spacing and case is the same building',
        async () => {
          await inEmptyEstate(pool, async (db) => {
            await importEstate(db, smallPlan());
            // What a second export of the same building looks like. `address_key` normalises it in
            // the database, so no importer has to remember to.
            await importEstate(db, smallPlan({ addressLine: '  רקפת   12 ' }));
            const buildings = await db.query<{ n: string }>(
              'SELECT count(*) AS n FROM building',
            );
            assert.equal(buildings.rows[0]?.n, '1');
          });
        },
      );

      await t.test(
        'a re-import corrects a changed fact rather than duplicating it',
        async () => {
          await inEmptyEstate(pool, async (db) => {
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
              `SELECT area_sqm, condition_status FROM unit WHERE unit_number = '2'`,
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
          await inEmptyEstate(pool, async (db) => {
            const report = await importEstate(db, shohamPlan());
            assert.equal(report.building.created, 1);
            assert.equal(report.space.created, 184);
            assert.equal(report.unit.created, 72);

            // Coverage, asserted rather than described: a fixture that quietly became 72 identical
            // apartments would still satisfy the count above.
            const shape = await db.query<{
              kinds: string;
              no_mamad: string;
              unmeasured: string;
              own_warranty: string;
              unassigned_parking: string;
              not_ready: string;
              split: string;
            }>(
              `SELECT (SELECT count(DISTINCT space_kind) FROM space) AS kinds,
                    (SELECT count(*) FROM unit WHERE has_mamad = false) AS no_mamad,
                    (SELECT count(*) FROM unit WHERE area_sqm IS NULL) AS unmeasured,
                    (SELECT count(*) FROM unit WHERE warranty_end_date IS NOT NULL) AS own_warranty,
                    (SELECT count(*) FROM unit WHERE parking_space_id IS NULL) AS unassigned_parking,
                    (SELECT count(*) FROM unit WHERE condition_status <> 'READY') AS not_ready,
                    (SELECT count(*) FROM unit WHERE unit_number ~ '[A-Z]$') AS split`,
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
        await inEmptyEstate(pool, async (db) => {
          await importEstate(db, shohamPlan());
          const second = await importEstate(db, shohamPlan());
          assert.equal(second.building.created, 0);
          assert.equal(second.space.created, 0);
          assert.equal(second.unit.created, 0);
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
            plan.buildings[0].projectCode = 'SHM-99';
            return plan;
          },
        ],
      ];
      for (const [name, build] of cases) {
        await t.test(name, async () => {
          await inEmptyEstate(pool, async (db) => {
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
