// What an approved mapped row will do on פתיחת טיוטה. The screen and the press
// share this, so the press copies only the rows named here and swallows nothing.
import {
  getUnit,
  listParkingSpacesInBuilding,
  listStorageSpacesInBuilding,
  type UncarriedReason,
} from '../../estate/contract.ts';
import { listExtractedFields } from './extract.ts';
import type { Queryable } from './types.ts';

const SPACE_OF: Readonly<Record<string, 'PARKING' | 'STORAGE'>> = {
  'tenancy.parking_space_id': 'PARKING',
  'tenancy.second_parking_space_id': 'PARKING',
  'tenancy.storage_space_id': 'STORAGE',
  'tenancy.second_storage_space_id': 'STORAGE',
};

const RENT_SIBLING: Readonly<Record<string, string>> = {
  rent_amount: 'rent_currency',
  rent_currency: 'rent_amount',
};

export interface LandingRow {
  extractedFieldId: string;
  fieldKey: string;
  labelHe: string;
  value: string;
  target: string;
  /** Null when the row lands. */
  reason: UncarriedReason | null;
}

function sameRooms(held: string, incoming: string): boolean {
  return Number(held) === Number(incoming);
}

/**
 * Per approved mapped row: where it lands, or why it will not.
 *
 * The reasons are the other rent half, a number that is not a Space in the
 * Building, and a Unit that already holds a different rooms or floor.
 */
export async function whatLands(
  db: Queryable,
  documentId: string,
  unitId: string | null,
): Promise<LandingRow[]> {
  const rows = await listExtractedFields(db, documentId);
  const unit = unitId ? await getUnit(db, unitId) : null;
  const parking = unit
    ? await listParkingSpacesInBuilding(db, unit.building_id)
    : [];
  const storage = unit
    ? await listStorageSpacesInBuilding(db, unit.building_id)
    : [];

  const out: LandingRow[] = [];
  for (const row of rows) {
    if (row.approvedAt === null || row.promotionTarget === null) continue;
    const value = row.approvedValue?.trim() ?? '';
    if (value === '') continue;
    const target = row.promotionTarget;
    let reason: UncarriedReason | null = null;

    const siblingKey = RENT_SIBLING[row.fieldKey];
    if (siblingKey) {
      // The same row the copy takes: the latest capture of the other half.
      const sibling = rows
        .filter((candidate) => candidate.fieldKey === siblingKey)
        .sort((left, right) =>
          left.extractedFieldId < right.extractedFieldId ? 1 : -1,
        )[0];
      if (
        !sibling ||
        sibling.approvedAt === null ||
        sibling.promotionTarget === null ||
        (sibling.approvedValue?.trim() ?? '') === ''
      ) {
        reason = { kind: 'rent-half' };
      }
    }

    if (reason === null && unit && target === 'unit.rooms') {
      const held = unit.rooms ?? null;
      if (held !== null && held !== '' && !sameRooms(held, value)) {
        reason = { kind: 'held', held };
      }
    }
    if (reason === null && unit && target === 'space.floor') {
      const held = unit.floor ?? null;
      if (held !== null && held !== '' && held !== value) {
        reason = { kind: 'held', held };
      }
    }

    const space = SPACE_OF[target];
    // A bay is judged only once the flat is known. Without one, the row is not
    // listed as landing: the press always has the chosen flat and judges it then.
    if (reason === null && space && !unit) continue;
    if (reason === null && unit && space) {
      const names = space === 'PARKING' ? parking : storage;
      const found = names.some((candidate) => candidate.name === value);
      if (!found) {
        reason = {
          kind: 'missing-space',
          number: value,
          buildingId: unit.building_id,
          buildingName: unit.building_name,
          space,
        };
      }
    }

    out.push({
      extractedFieldId: row.extractedFieldId,
      fieldKey: row.fieldKey,
      labelHe: row.labelHe,
      value,
      target,
      reason,
    });
  }
  return out;
}
