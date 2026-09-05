// Contract tests for the estate spine — R1, R2 and R15, plus the two rejections that make the
// acceptance bar a property of the schema rather than of the application above it.
//
// These assert against a real Postgres, through the DDL in src/kernel/migrations/0004_estate.sql,
// because every claim here is a claim about what the database refuses. An application-level check
// would prove that this file and that file agree, which is not the constraint.
//
// The column lists below are the workbook's FIELDS sheet (docs/model/, E1–E4). A migration that
// drifts from it turns this suite red, which is the point: the workbook is a specification, and a
// specification nothing reads is a description.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';

// Postgres SQLSTATEs. Asserting the class and not merely "it threw" is what stops a typo in a
// fixture from reading as a constraint doing its job.
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';

const SPACE_KINDS = [
  'UNIT',
  'COMMON',
  'TECHNICAL',
  'EXTERIOR',
  'PARKING',
  'STORAGE',
] as const;

/**
 * Asserts the statement is rejected with a named SQLSTATE, and leaves the transaction usable.
 *
 * A failed statement aborts the enclosing transaction, so every case that makes more than one
 * assertion after a rejection needs the savepoint — without it the second assertion fails with
 * 25P02 and says nothing about the constraint it was written for.
 */
async function rejects(
  db: PoolClient,
  sqlstate: string,
  statement: () => Promise<unknown>,
): Promise<void> {
  await db.query('SAVEPOINT attempt');
  try {
    await statement();
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    assert.fail(`expected SQLSTATE ${sqlstate}, but the statement succeeded`);
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    const code = (error as { code?: string }).code;
    assert.equal(
      code,
      sqlstate,
      `expected SQLSTATE ${sqlstate}, got ${code ?? 'no code'}: ${(error as Error).message}`,
    );
  }
}

async function insertProject(db: PoolClient): Promise<string> {
  const projectId = newId();
  await db.query(
    `INSERT INTO project (project_id, name, project_code, tender_ref, status)
     VALUES ($1, 'Shoham — Rakefet', 'SHM-01', '2024/17', 'ACTIVE')`,
    [projectId],
  );
  return projectId;
}

async function insertBuilding(
  db: PoolClient,
  projectId: string | null = null,
): Promise<string> {
  const buildingId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, project_id,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'Shoham — Rakefet 12', 'Rakefet 12', 'Shoham', $2,
             '2026-01-01', '2027-01-01', 'ACTIVE')`,
    [buildingId, projectId],
  );
  return buildingId;
}

async function insertSpace(
  db: PoolClient,
  buildingId: string,
  kind: string,
  name = 'Apartment 12',
): Promise<string> {
  const spaceId = newId();
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name) VALUES ($1, $2, $3, $4)`,
    [spaceId, buildingId, kind, name],
  );
  return spaceId;
}

function insertUnit(
  db: PoolClient,
  spaceId: string,
  extra: { parking?: string | null; storage?: string | null } = {},
): Promise<unknown> {
  return db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, area_sqm, has_mamad,
                       parking_space_id, storage_space_id, warranty_end_date, condition_status)
     VALUES ($1, '12', 3.5, 82.5, true, $2, $3, NULL, 'READY')`,
    [spaceId, extra.parking ?? null, extra.storage ?? null],
  );
}

async function columnsOf(db: PoolClient, table: string): Promise<string[]> {
  const result = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

describe('estate · the schema is the constraint', () => {
  it('holds R1, R2, R15 and the vocabularies', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      // R15 — Project sits above Building, optionally.
      await t.test('R15 · a building needs no project', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await insertBuilding(db);
          const row = await db.query<{ project_id: string | null }>(
            'SELECT project_id FROM building WHERE building_id = $1',
            [buildingId],
          );
          assert.equal(row.rows[0]?.project_id, null);
        });
      });

      await t.test(
        'R15 · a building may name one, and only a real one',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const projectId = await insertProject(db);
            const buildingId = await insertBuilding(db, projectId);
            const row = await db.query<{ project_id: string }>(
              'SELECT project_id FROM building WHERE building_id = $1',
              [buildingId],
            );
            assert.equal(row.rows[0]?.project_id, projectId);
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              insertBuilding(db, newId()),
            );
          });
        },
      );

      // R1 — every space belongs to exactly one building.
      await t.test('R1 · a space cannot float free of a building', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await rejects(db, NOT_NULL_VIOLATION, () =>
            db.query(
              `INSERT INTO space (space_id, building_id, space_kind, name)
               VALUES ($1, NULL, 'COMMON', 'Lobby')`,
              [newId()],
            ),
          );
          await rejects(db, FOREIGN_KEY_VIOLATION, () =>
            insertSpace(db, newId(), 'COMMON', 'Lobby'),
          );
        });
      });

      await t.test(
        'R1 · a building with spaces cannot be deleted',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const buildingId = await insertBuilding(db);
            await insertSpace(db, buildingId, 'COMMON', 'Lobby');
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              db.query('DELETE FROM building WHERE building_id = $1', [
                buildingId,
              ]),
            );
          });
        },
      );

      // R2 — the acceptance bar. An apartment is a Space with a Unit extension; a lobby is a Space
      // with none; and the schema is what says so.
      await t.test(
        'R2 · an apartment is a space with a unit, a lobby is a space with none',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const buildingId = await insertBuilding(db);
            const apartment = await insertSpace(db, buildingId, 'UNIT');
            await insertUnit(db, apartment);
            const lobby = await insertSpace(db, buildingId, 'COMMON', 'Lobby');

            const spaces = await db.query<{ n: string }>(
              'SELECT count(*) AS n FROM space WHERE building_id = $1',
              [buildingId],
            );
            assert.equal(spaces.rows[0]?.n, '2');

            // The unit's key IS the space's key: there is no second identifier to disagree.
            const units = await db.query<{ unit_id: string }>(
              `SELECT u.unit_id FROM unit u
               JOIN space s ON s.space_id = u.unit_id
               WHERE s.building_id = $1`,
              [buildingId],
            );
            assert.deepEqual(
              units.rows.map((row) => row.unit_id),
              [apartment],
            );
            // The lobby needs no unit row and the schema is content with that.
            const lobbyUnit = await db.query(
              'SELECT 1 FROM unit WHERE unit_id = $1',
              [lobby],
            );
            assert.equal(lobbyUnit.rowCount, 0);
          });
        },
      );

      await t.test('R2 · a unit with no space is rejected', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await rejects(db, FOREIGN_KEY_VIOLATION, () =>
            insertUnit(db, newId()),
          );
        });
      });

      await t.test(
        'R2 · a unit on a space that is not a UNIT is rejected',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const buildingId = await insertBuilding(db);
            for (const kind of SPACE_KINDS.filter((k) => k !== 'UNIT')) {
              const spaceId = await insertSpace(db, buildingId, kind, kind);
              await rejects(db, FOREIGN_KEY_VIOLATION, () =>
                insertUnit(db, spaceId),
              );
            }
          });
        },
      );

      await t.test(
        'R2 · a space cannot stop being a UNIT while its unit exists',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const buildingId = await insertBuilding(db);
            const apartment = await insertSpace(db, buildingId, 'UNIT');
            await insertUnit(db, apartment);
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              db.query(
                `UPDATE space SET space_kind = 'COMMON' WHERE space_id = $1`,
                [apartment],
              ),
            );
          });
        },
      );

      // D3 — bays and storage rooms are Space rows, so they can hold a gate motor and receive
      // service calls. Which means the assignment has to point at the right kind of space.
      await t.test(
        'D3 · parking and storage point at their own kinds',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const buildingId = await insertBuilding(db);
            const apartment = await insertSpace(db, buildingId, 'UNIT');
            const bay = await insertSpace(db, buildingId, 'PARKING', 'P-14');
            const room = await insertSpace(db, buildingId, 'STORAGE', 'S-14');
            const lobby = await insertSpace(db, buildingId, 'COMMON', 'Lobby');

            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              insertUnit(db, apartment, { parking: lobby }),
            );
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              insertUnit(db, apartment, { storage: bay }),
            );
            await insertUnit(db, apartment, { parking: bay, storage: room });
            const row = await db.query<{
              parking_space_id: string;
              storage_space_id: string;
            }>(
              'SELECT parking_space_id, storage_space_id FROM unit WHERE unit_id = $1',
              [apartment],
            );
            assert.equal(row.rows[0]?.parking_space_id, bay);
            assert.equal(row.rows[0]?.storage_space_id, room);
          });
        },
      );

      await t.test('D3 · an unassigned bay is the ordinary case', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await insertBuilding(db);
          const apartment = await insertSpace(db, buildingId, 'UNIT');
          await insertUnit(db, apartment);
          const row = await db.query<{ parking_space_id: string | null }>(
            'SELECT parking_space_id FROM unit WHERE unit_id = $1',
            [apartment],
          );
          assert.equal(row.rows[0]?.parking_space_id, null);
        });
      });

      // The vocabularies. Six space kinds and not a seventh: space_kind is what the responsibility
      // rule reads (R4), so an unknown value is a fault with no owner.
      await t.test('all six space kinds, and not a seventh', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await insertBuilding(db);
          for (const kind of SPACE_KINDS) {
            await insertSpace(db, buildingId, kind, kind);
          }
          const kinds = await db.query<{ n: string }>(
            'SELECT count(DISTINCT space_kind) AS n FROM space WHERE building_id = $1',
            [buildingId],
          );
          assert.equal(kinds.rows[0]?.n, String(SPACE_KINDS.length));
          await rejects(db, CHECK_VIOLATION, () =>
            insertSpace(db, buildingId, 'GARDEN', 'Garden'),
          );
        });
      });

      await t.test('the three status vocabularies', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `INSERT INTO project (project_id, name, project_code, status)
               VALUES ($1, 'x', 'x', 'PAUSED')`,
              [newId()],
            ),
          );
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `INSERT INTO building (building_id, name, address_line, city,
                                     handover_date, warranty_end_date, status)
               VALUES ($1, 'x', 'x', 'x', '2026-01-01', '2027-01-01', 'DEMOLISHED')`,
              [newId()],
            ),
          );
          const buildingId = await insertBuilding(db);
          const apartment = await insertSpace(db, buildingId, 'UNIT');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
               VALUES ($1, '12', 3.5, true, 'OCCUPIED')`,
              [apartment],
            ),
          );
        });
      });
    } finally {
      await pool.end();
    }
  });

  it('carries the workbook’s columns, and nothing derived', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        // The FIELDS sheet, E1–E4, sorted. Twenty-eight stored columns.
        assert.deepEqual(await columnsOf(db, 'project'), [
          'name',
          'project_code',
          'project_id',
          'status',
          'tender_ref',
        ]);
        assert.deepEqual(await columnsOf(db, 'building'), [
          'address_line',
          'building_id',
          'city',
          'handover_date',
          'name',
          'project_id',
          'status',
          'warranty_end_date',
        ]);
        assert.deepEqual(await columnsOf(db, 'space'), [
          'access_note',
          'building_id',
          'floor',
          'name',
          'space_id',
          'space_kind',
        ]);
        // Unit's nine, plus three constant discriminators that exist only so R2 and D3 can be
        // composite foreign keys rather than triggers. They are enforcement and not facts: each is
        // pinned to one value by a CHECK, and nothing may write them.
        assert.deepEqual(await columnsOf(db, 'unit'), [
          'area_sqm',
          'condition_status',
          'has_mamad',
          'parking_kind',
          'parking_space_id',
          'rooms',
          'space_kind',
          'storage_kind',
          'storage_space_id',
          'unit_id',
          'unit_number',
          'warranty_end_date',
        ]);
      });

      // R6 and foundation rule 1, asserted as absence. The grep guard over the migrations catches
      // the string `current_tenant`; this catches the other two, and it catches all three in the
      // schema that is actually deployed rather than in the file that was meant to create it.
      await inRolledBackTransaction(pool, async (db) => {
        const derived = await db.query<{
          table_name: string;
          column_name: string;
        }>(
          `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public'
             AND column_name IN ('unit_count', 'occupancy', 'current_tenant')`,
        );
        assert.deepEqual(derived.rows, []);
      });
    } finally {
      await pool.end();
    }
  });
});
