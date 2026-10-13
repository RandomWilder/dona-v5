// The four facts a developer sheet carries that 0064 could not hold — 0066. SPEC-estate.md, "Four
// more facts a developer sheet carries": a garden flat and its garden area, a sukkah balcony, a
// storage room attached to the flat with no number, and a numbered storage room above the parking.
// Each case is a claim about what the database refuses, so it runs against a real Postgres.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';

const CHECK_VIOLATION = '23514';

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

let counter = 0;

async function building(db: PoolClient): Promise<string> {
  counter += 1;
  const buildingId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'Markings', $2, 'Markings city', '2026-01-01', '2027-01-01', 'ACTIVE')`,
    [buildingId, `Markings ${counter} ${newId()}`],
  );
  return buildingId;
}

async function space(
  db: PoolClient,
  buildingId: string,
  kind: string,
): Promise<string> {
  const spaceId = newId();
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name) VALUES ($1, $2, $3, $4)`,
    [spaceId, buildingId, kind, spaceId],
  );
  return spaceId;
}

async function flat(db: PoolClient): Promise<string> {
  const unitId = await space(db, await building(db), 'UNIT');
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '1', 4, true, 'READY')`,
    [unitId],
  );
  return unitId;
}

describe('estate · the flat markings (0066)', () => {
  it('holds the rules', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'a flat has no garden, sukkah or attached room unless told',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const unitId = await flat(db);
            const row = await db.query<{
              garden_sqm: string | null;
              sukkah_balcony: boolean;
              attached_storage: string | null;
            }>(
              'SELECT garden_sqm, sukkah_balcony, attached_storage FROM unit WHERE unit_id = $1',
              [unitId],
            );
            assert.deepEqual(row.rows[0], {
              garden_sqm: null,
              sukkah_balcony: false,
              attached_storage: null,
            });
          });
        },
      );

      await t.test('a garden area is not negative', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const unitId = await flat(db);
          await db.query(
            'UPDATE unit SET garden_sqm = 224.74 WHERE unit_id = $1',
            [unitId],
          );
          await rejects(db, CHECK_VIOLATION, () =>
            db.query('UPDATE unit SET garden_sqm = -1 WHERE unit_id = $1', [
              unitId,
            ]),
          );
        });
      });

      await t.test(
        'an attached room opens from the garden or the balcony',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const unitId = await flat(db);
            for (const from of ['GARDEN', 'BALCONY']) {
              await db.query(
                'UPDATE unit SET attached_storage = $2 WHERE unit_id = $1',
                [unitId, from],
              );
            }
            await rejects(db, CHECK_VIOLATION, () =>
              db.query(
                "UPDATE unit SET attached_storage = 'ROOF' WHERE unit_id = $1",
                [unitId],
              ),
            );
          });
        },
      );

      await t.test('only a storage room is above the parking', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await building(db);
          const store = await space(db, buildingId, 'STORAGE');
          const fresh = await db.query<{ over_parking: boolean }>(
            'SELECT over_parking FROM space WHERE space_id = $1',
            [store],
          );
          assert.equal(fresh.rows[0]?.over_parking, false);
          await db.query(
            'UPDATE space SET over_parking = true WHERE space_id = $1',
            [store],
          );
          const bay = await space(db, buildingId, 'PARKING');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              'UPDATE space SET over_parking = true WHERE space_id = $1',
              [bay],
            ),
          );
        });
      });
    } finally {
      await pool.end();
    }
  });
});
