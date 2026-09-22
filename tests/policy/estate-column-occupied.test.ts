// **Occupied, one level down, means the estate column is not null.** Issue #145.
//
// #130's occupancy is a stamp from a *different* extracted field on a letting, not a register date.
// That carve-out does not survive the move to estate columns: `unit.rooms` is NOT NULL and is written
// by A13 or the register, with no `extracted_field` behind it. A promotion that still looked for a
// stamp would find none and overwrite the typed value. `space.floor` is nullable but written by the
// same two hands, and has the same problem whenever it is set.
//
// **Why it is in tests/policy/** (docs/pipeline.md §6): whether a model's reading of a lease may
// silently replace an operator's typed room count is not a screen judgement. SPEC-evidence.md,
// *A promotion onto an occupied column* — one level down.
//
// **Why this is a seam, not promoteExtractedField.** Promote cannot yet reach an estate column;
// widening `field_promotion.target` is #141. That ticket consumes `occupantOfEstateColumn` rather
// than re-deriving it. The refusal-and-supersede path stays #130's, unchanged, for tenancy.
//
// **Red first.** Before #145 a non-null estate column had no occupant definition at all.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import { occupantOfEstateColumn } from '../../src/estate/contract.ts';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a non-null estate column is occupied whoever wrote it', () => {
  it('treats a typed unit.rooms as occupied, and a space.floor as occupied only when set', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const buildingId = newId();
      const unitId = newId();
      const parkingId = newId();
      await db.query(
        `INSERT INTO building (building_id, name, address_line, city,
                               handover_date, warranty_end_date, status)
         VALUES ($1, 'policy-145-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
        [buildingId, `Policy ${buildingId.slice(24)}`],
      );
      await db.query(
        `INSERT INTO space (space_id, building_id, space_kind, name)
         VALUES ($1, $2, 'UNIT', 'דירה 7')`,
        [unitId, buildingId],
      );
      await db.query(
        `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
         VALUES ($1, '7', 3.5, true, 'READY')`,
        [unitId],
      );
      await db.query(
        `INSERT INTO space (space_id, building_id, space_kind, name, floor)
         VALUES ($1, $2, 'PARKING', 'חניה 1', NULL)`,
        [parkingId, buildingId],
      );

      assert.equal(
        await occupantOfEstateColumn(db, {
          target: 'unit.rooms',
          entityId: unitId,
        }),
        '3.5',
        'a typed room count had no occupant, so a promotion would overwrite it',
      );
      assert.equal(
        await occupantOfEstateColumn(db, {
          target: 'space.floor',
          entityId: parkingId,
        }),
        null,
        'a null floor is unoccupied',
      );

      await db.query(`UPDATE space SET floor = '2' WHERE space_id = $1`, [
        parkingId,
      ]);
      assert.equal(
        await occupantOfEstateColumn(db, {
          target: 'space.floor',
          entityId: parkingId,
        }),
        '2',
        'a set floor had no occupant',
      );
    });
  });
});
