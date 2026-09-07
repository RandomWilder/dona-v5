// E11's governed list, the class/type pair, and the space requirement. Slice 3.5.
//
// docs/pipeline.md §6: everything no model may decide. asset_type is the key the responsibility
// matrix reads, so an unknown type or a SAFETY sprinkler filed as a FIXTURE is a policy defect
// wearing a data costume. Every rejection below is a named SQLSTATE.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';

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
    assert.equal(code, sqlstate, (error as Error).message);
  }
}

async function insertBuilding(db: PoolClient): Promise<string> {
  const buildingId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'x', $2, 'Shoham', '2024-03-01', '2026-03-01', 'ACTIVE')`,
    [buildingId, `Asset ${buildingId.slice(0, 8)}`],
  );
  return buildingId;
}

async function insertSpace(
  db: PoolClient,
  buildingId: string,
  kind = 'UNIT',
): Promise<string> {
  const spaceId = newId();
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, $3, $4)`,
    [spaceId, buildingId, kind, kind],
  );
  return spaceId;
}

const COLS = `asset_id, space_id, asset_class, asset_type, compliance_regime, status`;

describe('policy · asset_type is governed, and an asset sits in a space', () => {
  it('R3 · an asset cannot float free of a space', async (t) => {
    const pool = await policyPool();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await rejects(db, NOT_NULL_VIOLATION, () =>
          db.query(
            `INSERT INTO asset (${COLS})
             VALUES ($1, NULL, 'FIXTURE', 'AC', 'NONE', 'IN_SERVICE')`,
            [newId()],
          ),
        );
        await rejects(db, FOREIGN_KEY_VIOLATION, () =>
          db.query(
            `INSERT INTO asset (${COLS})
             VALUES ($1, $2, 'FIXTURE', 'AC', 'NONE', 'IN_SERVICE')`,
            [newId(), newId()],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('an unknown asset_type is rejected', async (t) => {
    const pool = await policyPool();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const spaceId = await insertSpace(db, await insertBuilding(db));
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO asset (${COLS})
             VALUES ($1, $2, 'FIXTURE', 'DISHWASHER', 'NONE', 'IN_SERVICE')`,
            [newId(), spaceId],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('a SAFETY sprinkler cannot be filed as a FIXTURE', async (t) => {
    const pool = await policyPool();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const spaceId = await insertSpace(db, await insertBuilding(db));
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO asset (${COLS})
             VALUES ($1, $2, 'FIXTURE', 'SPRINKLER', 'NONE', 'IN_SERVICE')`,
            [newId(), spaceId],
          ),
        );
        await db.query(
          `INSERT INTO asset (${COLS})
           VALUES ($1, $2, 'SAFETY', 'SPRINKLER', 'PERIODIC_INSPECTION', 'IN_SERVICE')`,
          [newId(), spaceId],
        );
      });
    } finally {
      await pool.end();
    }
  });
});
