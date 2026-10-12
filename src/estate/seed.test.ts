// Seeding a building from a building plan file — SPEC-estate.md, "Seeding a building from a
// developer sheet". The file is the director's and never in this repo; the plans here are built in
// the test, at a city of their own, because other suites share this database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  decodeSeedPayload,
  parseEstateSeedArgs,
  readSeedPlan,
  seedBuilding,
  summariseSeedPlan,
} from './contract.ts';

const CITY = 'רמלה — בדיקת זריעה';

/** Two flats on two floors, a disabled bay, a storage room with an area. JSON, as the file is. */
function planJson(overrides: Record<string, unknown> = {}): unknown {
  return {
    projects: [
      {
        name: 'פרויקט רמלה',
        projectCode: 'RML-SEED-TEST',
        tenderRef: null,
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: 'בניין 103',
        addressLine: 'הזית 1',
        city: CITY,
        projectCode: 'RML-SEED-TEST',
        handoverDate: '2026-09-01',
        warrantyEndDate: '2028-09-01',
        status: 'ACTIVE',
        buildingNumber: '103',
        spaces: [
          { kind: 'UNIT', name: '1', floor: 'קרקע', accessNote: null },
          { kind: 'UNIT', name: '2', floor: '1', accessNote: null },
          {
            kind: 'PARKING',
            name: '114',
            floor: '-1',
            accessNote: null,
            disabledBay: true,
          },
          { kind: 'PARKING', name: '201', floor: '-2', accessNote: null },
          {
            kind: 'STORAGE',
            name: '101',
            floor: '-1',
            accessNote: null,
            areaSqm: 6.2,
          },
        ],
        units: [
          {
            spaceName: '1',
            unitNumber: '1',
            rooms: 4,
            areaSqm: 98.5,
            hasMamad: true,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'READY',
            tenure: 'FOR_SALE',
            flatType: 'BG',
            balconySqm: 14,
          },
          {
            spaceName: '2',
            unitNumber: '2',
            rooms: 3,
            areaSqm: 76,
            hasMamad: true,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'READY',
            tenure: 'FOR_RENT',
            flatType: 'A',
            balconySqm: 10.5,
          },
        ],
        ...overrides,
      },
    ],
  };
}

describe('estate · seeding a building from a plan file', () => {
  it('takes list or apply, a source, and --update', () => {
    assert.deepEqual(parseEstateSeedArgs(['list', 'a.json']), {
      mode: 'list',
      update: false,
      source: { kind: 'file', path: 'a.json' },
    });
    assert.deepEqual(
      parseEstateSeedArgs(['apply', '--plan-b64', 'H4sI', '--update']),
      {
        mode: 'apply',
        update: true,
        source: { kind: 'b64', data: 'H4sI' },
      },
    );
    assert.throws(() => parseEstateSeedArgs([]), /usage/);
    assert.throws(() => parseEstateSeedArgs(['list']), /usage/);
    assert.throws(
      () => parseEstateSeedArgs(['apply', 'a.json', '--force']),
      /usage/,
    );
  });

  it('carries the file through a job argument intact', () => {
    const json = planJson();
    const data = gzipSync(JSON.stringify(json)).toString('base64');
    assert.deepEqual(decodeSeedPayload(data), json);
  });

  it('refuses a malformed file and names the first bad field', () => {
    const cases: [string, unknown, RegExp][] = [
      ['not an object', [], /plan: expected an object/],
      [
        'two buildings',
        { ...(planJson() as object), buildings: [{}, {}] },
        /buildings: exactly one building/,
      ],
      [
        'a bad date',
        planJson({ handoverDate: '1.9.2026' }),
        /buildings\[0\]\.handoverDate: expected a date/,
      ],
      [
        'an unknown tenure',
        planJson({
          units: [
            {
              ...((planJson() as { buildings: { units: object[] }[] })
                .buildings[0].units[0] as object),
              tenure: 'LEASED',
            },
          ],
        }),
        /buildings\[0\]\.units\[0\]\.tenure: expected one of/,
      ],
      [
        'a bay attached to a flat',
        planJson({
          units: [
            {
              ...((planJson() as { buildings: { units: object[] }[] })
                .buildings[0].units[0] as object),
              parkingSpaceName: '114',
            },
          ],
        }),
        /units\[0\]\.parkingSpaceName: a plan file attaches no bay/,
      ],
      [
        'a typo in a field name',
        planJson({ adressLine: 'x' }),
        /buildings\[0\]: unknown field adressLine/,
      ],
      [
        'a flat space with no flat',
        planJson({
          spaces: [
            { kind: 'UNIT', name: '1', floor: 'קרקע', accessNote: null },
            { kind: 'UNIT', name: '2', floor: '1', accessNote: null },
            { kind: 'UNIT', name: '3', floor: '1', accessNote: null },
          ],
        }),
        /UNIT space 3 has no flat/,
      ],
    ];
    for (const [name, json, message] of cases) {
      assert.throws(() => readSeedPlan(json), message, name);
    }
  });

  it('reads a rental track and counts regulated flats', () => {
    const json = planJson();
    const building = (
      json as { buildings: { units: Record<string, unknown>[] }[] }
    ).buildings[0];
    const unit = building?.units[0];
    if (!unit) throw new Error('plan has no flat');
    unit.rentalTrack = 'REGULATED';
    const plan = readSeedPlan(json);
    assert.equal(plan.buildings[0]?.units[0]?.rentalTrack, 'REGULATED');
    assert.match(summariseSeedPlan(plan).join('\n'), /regulated 1/);
    unit.rentalTrack = 'CAPPED';
    assert.throws(() => readSeedPlan(json), /rentalTrack/);
  });

  it('summarises what it would write', () => {
    const lines = summariseSeedPlan(readSeedPlan(planJson())).join('\n');
    assert.match(
      lines,
      /flats\s+2 · FOR_RENT 1 · FOR_SALE 1 · SOLD 0 · regulated 0/,
    );
    assert.match(lines, /floors קרקע–1/);
    assert.match(lines, /parking\s+2 · -1 1 · -2 1 · disabled 1/);
    assert.match(lines, /storage\s+1 · -1 1/);
  });

  it('writes a new building once, and refuses it a second time without --update', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const plan = readSeedPlan(planJson());
        const first = await seedBuilding(db, plan, { update: false });
        assert.equal(first.existingBuildingId, null);
        assert.equal(first.report.unit.created, 2);
        assert.equal(first.report.space.created, 5);

        await assert.rejects(
          seedBuilding(db, plan, { update: false }),
          /already exists.*--update/,
        );

        const fixed = readSeedPlan(planJson());
        fixed.buildings[0].units[1].rooms = 3.5;
        const second = await seedBuilding(db, fixed, { update: true });
        assert.equal(second.existingBuildingId, first.buildingId);
        assert.equal(second.buildingId, first.buildingId);
        assert.equal(second.report.unit.created, 0);
        const rooms = await db.query<{ rooms: string }>(
          `SELECT u.rooms FROM unit u JOIN space s ON s.space_id = u.unit_id
           WHERE s.building_id = $1 AND u.unit_number = '2'`,
          [first.buildingId],
        );
        assert.equal(Number(rooms.rows[0]?.rooms), 3.5);
      });
    } finally {
      await pool.end();
    }
  });
});
