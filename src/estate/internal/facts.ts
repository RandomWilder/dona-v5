// Hand corrections on a flat that already exists.
//
// #210 corrects the five facts, and 0066's three. Not `upsertUnitRow`: that rewrite also sets the
// unit number, the ממ״ד, the condition, the warranty and the built bay. Not
// `applyPromotedField`: that appends `estate_event`, and a hand correction has
// no source document.
//
// #211 changes tenure. The column's trigger is the refusal. This write does not
// append `estate_event` either; the route records the change on `audit_log`.
import { KernelError } from '../../kernel/errors.ts';
import type { AttachedStorage, Queryable, Tenure } from './plan.ts';

export interface FlatFacts {
  rooms: number;
  floor: string | null;
  areaSqm: number | null;
  flatType: string | null;
  balconySqm: number | null;
  gardenSqm: number | null;
  sukkahBalcony: boolean;
  attachedStorage: AttachedStorage | null;
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
            balcony_sqm = $5,
            garden_sqm = $6,
            sukkah_balcony = $7,
            attached_storage = $8
      WHERE unit_id = $1`,
    [
      unitId,
      facts.rooms,
      facts.areaSqm,
      facts.flatType,
      facts.balconySqm,
      facts.gardenSqm,
      facts.sukkahBalcony,
      facts.attachedStorage,
    ],
  );
  if (updated.rowCount === 0) {
    throw new KernelError('not_found', 'unit not found');
  }
  await db.query(`UPDATE space SET floor = $2 WHERE space_id = $1`, [
    unitId,
    facts.floor,
  ]);
}

const RESTRICT_VIOLATION = '23001';

/** What the tenure trigger refused, named for the page rather than the SQLSTATE. */
export type TenureRefusal = 'sold' | 'let';

export type TenureChange =
  | { outcome: 'unchanged' }
  | { outcome: 'changed'; from: Tenure; to: Tenure }
  | { outcome: 'refused'; reason: TenureRefusal }
  | { outcome: 'confirm' };

/**
 * #211. `unchanged` when the row already holds `tenure`. Moving to `SOLD`
 * without `confirmSold` is `confirm` and writes nothing. A trigger refusal is
 * `refused` and the column is left as it was; anything else still throws.
 * The read locks the row, so the confirmation and the write see one tenure.
 */
export async function changeUnitTenure(
  db: Queryable,
  unitId: string,
  tenure: Tenure,
  confirmSold: boolean,
): Promise<TenureChange> {
  const current = await db.query<{ tenure: Tenure }>(
    'SELECT tenure FROM unit WHERE unit_id = $1 FOR UPDATE',
    [unitId],
  );
  const from = current.rows[0]?.tenure;
  if (from === undefined) {
    throw new KernelError('not_found', 'unit not found');
  }
  if (tenure === 'SOLD' && from !== 'SOLD' && !confirmSold) {
    return { outcome: 'confirm' };
  }
  if (from === tenure) return { outcome: 'unchanged' };
  await db.query('SAVEPOINT tenure_change');
  try {
    const updated = await db.query(
      'UPDATE unit SET tenure = $2 WHERE unit_id = $1',
      [unitId, tenure],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new KernelError('not_found', 'unit not found');
    }
    await db.query('RELEASE SAVEPOINT tenure_change');
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT tenure_change');
    const pg = error as { code?: string; message?: string };
    if (pg.code === RESTRICT_VIOLATION && pg.message?.includes('stays sold')) {
      return { outcome: 'refused', reason: 'sold' };
    }
    if (
      pg.code === RESTRICT_VIOLATION &&
      pg.message?.includes('active letting')
    ) {
      return { outcome: 'refused', reason: 'let' };
    }
    throw error;
  }
  return { outcome: 'changed', from, to: tenure };
}
