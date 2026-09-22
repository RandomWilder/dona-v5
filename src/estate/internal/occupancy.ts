// Occupancy of an estate column for promotion. Issue #145.
//
// Tenancy occupancy is a stamp from a different extracted field, not a register date. Estate
// occupancy is the column itself: non-null whoever wrote it. Evidence issues no estate SQL, so
// this is the definition #141's promotion family consumes rather than re-deriving.
import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';
import type { Queryable } from './plan.ts';

export type EstatePromotionColumn = 'unit.rooms' | 'space.floor';

export async function occupantOfEstateColumn(
  db: Queryable,
  spec: { target: EstatePromotionColumn; entityId: string },
): Promise<string | null> {
  const entityId = validId(spec.entityId, 'entity');
  if (spec.target === 'unit.rooms') {
    const result = await db.query<{ value: string }>(
      `SELECT rooms::text AS value FROM unit WHERE unit_id = $1`,
      [entityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new KernelError('not_found', 'unit not found');
    }
    return row.value;
  }
  if (spec.target === 'space.floor') {
    const result = await db.query<{ value: string | null }>(
      `SELECT floor AS value FROM space WHERE space_id = $1`,
      [entityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new KernelError('not_found', 'space not found');
    }
    return row.value;
  }
  throw new KernelError(
    'invalid',
    'that column is not an estate promotion target',
  );
}
