// Tenure and the three facts a developer sheet carries — 0064. Every case here is a claim about what
// the database refuses, so it runs against a real Postgres, the way schema.test.ts does.
//
// The rules are SPEC-estate.md, "Tenure, and what a developer sheet adds to a flat": sold is
// terminal; no DRAFT or ACTIVE letting on a sold flat; a let flat cannot be sold; a disabled bay is
// only a PARKING Space and a Space's area only a STORAGE one.
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
const RESTRICT_VIOLATION = '23001';

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
     VALUES ($1, 'Tenure', $2, 'Tenure city', '2026-01-01', '2027-01-01', 'ACTIVE')`,
    [buildingId, `Tenure ${counter} ${newId()}`],
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

async function flat(
  db: PoolClient,
  tenure: string | null = null,
): Promise<string> {
  const unitId = await space(db, await building(db), 'UNIT');
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '1', 4, true, 'READY')`,
    [unitId],
  );
  if (tenure !== null) {
    await db.query('UPDATE unit SET tenure = $2 WHERE unit_id = $1', [
      unitId,
      tenure,
    ]);
  }
  return unitId;
}

async function letting(
  db: PoolClient,
  unitId: string,
  status: string,
  startDate = '2026-01-01',
): Promise<unknown> {
  const profile = await db.query<{ terms_profile_id: string }>(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING terms_profile_id`,
    [newId(), 'tenure test annex'],
  );
  return db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, '2027-01-01', $4, $5)`,
    [newId(), unitId, startDate, status, profile.rows[0]?.terms_profile_id],
  );
}

describe('estate · tenure and the sheet facts (0064)', () => {
  it('holds the rules', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test('a flat is for rent unless told otherwise', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const unitId = await flat(db);
          const row = await db.query<{ tenure: string }>(
            'SELECT tenure FROM unit WHERE unit_id = $1',
            [unitId],
          );
          assert.equal(row.rows[0]?.tenure, 'FOR_RENT');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query("UPDATE unit SET tenure = 'LEASED' WHERE unit_id = $1", [
              unitId,
            ]),
          );
        });
      });

      await t.test(
        'designated for sale goes back to rent; sold goes nowhere',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const unitId = await flat(db, 'FOR_SALE');
            await db.query(
              "UPDATE unit SET tenure = 'FOR_RENT' WHERE unit_id = $1",
              [unitId],
            );
            await db.query(
              "UPDATE unit SET tenure = 'SOLD' WHERE unit_id = $1",
              [unitId],
            );
            for (const back of ['FOR_RENT', 'FOR_SALE']) {
              await rejects(db, RESTRICT_VIOLATION, () =>
                db.query('UPDATE unit SET tenure = $2 WHERE unit_id = $1', [
                  unitId,
                  back,
                ]),
              );
            }
            // A sold flat's other facts are still correctable.
            await db.query('UPDATE unit SET rooms = 4.5 WHERE unit_id = $1', [
              unitId,
            ]);
          });
        },
      );

      await t.test('a sold flat takes no new letting', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const unitId = await flat(db, 'SOLD');
          await rejects(db, RESTRICT_VIOLATION, () =>
            letting(db, unitId, 'DRAFT'),
          );
          await rejects(db, RESTRICT_VIOLATION, () =>
            letting(db, unitId, 'ACTIVE'),
          );
          // History from before the sale can still be filed.
          await letting(db, unitId, 'ENDED', '2024-01-01');
        });
      });

      await t.test(
        'a let flat cannot be sold, but may be designated for sale',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const unitId = await flat(db);
            await letting(db, unitId, 'ACTIVE');
            await db.query(
              "UPDATE unit SET tenure = 'FOR_SALE' WHERE unit_id = $1",
              [unitId],
            );
            await rejects(db, RESTRICT_VIOLATION, () =>
              db.query("UPDATE unit SET tenure = 'SOLD' WHERE unit_id = $1", [
                unitId,
              ]),
            );
          });
        },
      );

      await t.test('a disabled bay is a parking bay', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await building(db);
          const bay = await space(db, buildingId, 'PARKING');
          await db.query(
            'UPDATE space SET disabled_bay = true WHERE space_id = $1',
            [bay],
          );
          const store = await space(db, buildingId, 'STORAGE');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              'UPDATE space SET disabled_bay = true WHERE space_id = $1',
              [store],
            ),
          );
        });
      });

      await t.test('a space has an area only as a storage room', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const buildingId = await building(db);
          const store = await space(db, buildingId, 'STORAGE');
          await db.query(
            'UPDATE space SET area_sqm = 6.5 WHERE space_id = $1',
            [store],
          );
          const bay = await space(db, buildingId, 'PARKING');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query('UPDATE space SET area_sqm = 12 WHERE space_id = $1', [
              bay,
            ]),
          );
        });
      });
    } finally {
      await pool.end();
    }
  });
});
