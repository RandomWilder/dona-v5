// The Unit record (CONTEXT.md): what the account currently holds about one Unit, independent of any
// Document. Issue #227, the physical half; the letting half is #228.
//
// A typed value and not text. How the office turn words it for a model is evidence's business; what
// the account holds, and that a missing value comes back as null rather than as a guess, is estate's.
// Current values only — estate events are not read. No phone and no ID number, ever: the record is
// not a second contact book.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable, Tenure } from './plan.ts';

export interface UnitRecord {
  unitId: string;
  unitNumber: string;
  buildingName: string;
  addressLine: string;
  city: string;
  floor: string | null;
  rooms: string;
  areaSqm: string | null;
  hasMamad: boolean;
  tenure: Tenure;
  /** The bay the flat was built with, by number. Not the bay a letting assigns. */
  builtParking: string | null;
  /** The numbered storage room the flat was built with. Not the one a letting assigns. */
  builtStorage: string | null;
}

export async function readUnitRecord(
  db: Queryable,
  unitId: string,
): Promise<UnitRecord> {
  const result = await db.query<UnitRecord>(
    `SELECT u.unit_id AS "unitId",
            u.unit_number AS "unitNumber",
            b.name AS "buildingName",
            b.address_line AS "addressLine",
            b.city,
            s.floor,
            u.rooms::text AS rooms,
            u.area_sqm::text AS "areaSqm",
            u.has_mamad AS "hasMamad",
            u.tenure,
            pk.name AS "builtParking",
            st.name AS "builtStorage"
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
       LEFT JOIN space pk ON pk.space_id = u.parking_space_id
       LEFT JOIN space st ON st.space_id = u.storage_space_id
      WHERE u.unit_id = $1`,
    [unitId],
  );
  const record = result.rows[0];
  if (!record) {
    // `getUnit`'s rule: an id that does not exist and one that exists elsewhere look the same.
    throw new KernelError('not_found', 'unit not found');
  }
  return record;
}
