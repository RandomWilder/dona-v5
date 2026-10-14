// The Unit record (CONTEXT.md): what the account currently holds about one Unit, independent of any
// Document. Issue #227, the physical half; #228, the letting active today.
//
// A typed value and not text. How the office turn words it for a model is evidence's business; what
// the account holds, and that a missing value comes back as null rather than as a guess, is estate's.
// Current values only — estate events are not read. No phone and no ID number, ever: the record is
// not a second contact book.
//
// Which letting counts today is scope's answer (`resolveActiveTenancy`), not this file's: a day
// predicate here would be a second copy of the tenancy-active rule. Tenancy then reads that one
// letting by id. A draft, an ended or a future letting never reaches the record.
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import {
  resolveActiveTenancy,
  resolvePartiesInUnit,
  type ScopeActor,
} from '../../scope/contract.ts';
import { getTenancy } from '../../tenancy/contract.ts';
import type { Queryable, Tenure } from './plan.ts';

/** One person on the letting, by name and role. No contact, no identifier. */
export interface RecordParty {
  fullName: string;
  role: string;
}

/** The letting active today. A null is a value the account does not hold. */
export interface RecordLetting {
  tenancyId: string;
  startDate: string;
  endDate: string;
  optionEndDate: string | null;
  rentAmount: string | null;
  rentCurrency: string | null;
  /** The bays the letting assigns, by number. Not the bay the flat was built with. */
  assignedParking: string[];
  /** The storage rooms the letting assigns. Not the one the flat was built with. */
  assignedStorage: string[];
  parties: RecordParty[];
}

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
  /** Null when no letting is active today. */
  letting: RecordLetting | null;
}

export async function readUnitRecord(
  db: Queryable,
  unitId: string,
  clock: Clock,
  /** Who the scope read's access line names. Required: a default would log staff as `system`. */
  actor: ScopeActor,
): Promise<UnitRecord> {
  const result = await db.query<Omit<UnitRecord, 'letting'>>(
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
  return { ...record, letting: await readLetting(db, unitId, clock, actor) };
}

async function readLetting(
  db: Queryable,
  unitId: string,
  clock: Clock,
  actor: ScopeActor,
): Promise<RecordLetting | null> {
  // Not from the party read: a letting nobody is on yet still counts as let.
  const tenancyId = await resolveActiveTenancy(db, unitId, clock);
  if (tenancyId === null) return null;
  const occupants = await resolvePartiesInUnit(db, unitId, clock, { actor });
  const tenancy = await getTenancy(db, tenancyId);
  const named = (values: (string | null)[]): string[] =>
    values.filter((value): value is string => value !== null);
  return {
    tenancyId,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
    optionEndDate: tenancy.option_end_date,
    rentAmount: tenancy.rent_amount,
    rentCurrency: tenancy.rent_currency,
    assignedParking: named([tenancy.parking_name, tenancy.second_parking_name]),
    assignedStorage: named([tenancy.storage_name, tenancy.second_storage_name]),
    parties: occupants
      .filter((row) => row.tenancy_id === tenancyId)
      .map((row) => ({ fullName: row.full_name, role: row.role })),
  };
}
