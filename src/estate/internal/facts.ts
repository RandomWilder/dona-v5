// #210. Correct the five facts an admin can change on a seeded flat.
//
// Not `upsertUnitRow`: that rewrite also sets the unit number, the ממ״ד, the
// condition, the warranty and the built bay. Not `applyPromotedField`: that
// appends `estate_event`, and a hand correction has no source document.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './plan.ts';

export interface FlatFacts {
  rooms: number;
  floor: string | null;
  areaSqm: number | null;
  flatType: string | null;
  balconySqm: number | null;
}

export async function correctUnitFacts(
  db: Queryable,
  unitId: string,
  facts: FlatFacts,
): Promise<void> {
  const updated = await db.query(
    `UPDATE unit
        SET rooms = $2,
            area_sqm = $3,
            flat_type = $4,
            balcony_sqm = $5
      WHERE unit_id = $1`,
    [unitId, facts.rooms, facts.areaSqm, facts.flatType, facts.balconySqm],
  );
  if (updated.rowCount === 0) {
    throw new KernelError('not_found', 'unit not found');
  }
  await db.query(`UPDATE space SET floor = $2 WHERE space_id = $1`, [
    unitId,
    facts.floor,
  ]);
}
