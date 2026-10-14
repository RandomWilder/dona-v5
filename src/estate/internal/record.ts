// The Unit record (CONTEXT.md): what the account currently holds about one Unit, independent of any
// Document. Issue #227, the physical half; #228, the letting active today. #230 adds the Building
// record below it: the Building's own values, one line per Unit, and its bay and storage counts.
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
import type { BuildingStatus, Queryable, Tenure } from './plan.ts';
import { listOccupiedAssignments } from './read-model.ts';

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

/** One Unit in the Building record. Physical facts only: who lives there is the lettings list. */
export interface BuildingRecordUnit {
  unitId: string;
  unitNumber: string;
  floor: string | null;
  rooms: string;
  areaSqm: string | null;
  tenure: Tenure;
  builtParking: string | null;
  builtStorage: string | null;
}

/** How many of one kind of Space the Building has, and how many of them are assigned. */
export interface BuildingRecordCount {
  total: number;
  /** To a Unit as built, or by a letting active today. A Space assigned both ways counts once. */
  assigned: number;
}

/**
 * The Building record (CONTEXT.md). Issue #230. No party and no rent — who is let today stays the
 * lettings list — and no figure the office could read as occupancy beyond the assigned counts.
 */
export interface BuildingRecord {
  buildingId: string;
  name: string;
  addressLine: string;
  city: string;
  projectName: string | null;
  handoverDate: string;
  warrantyEndDate: string;
  status: BuildingStatus;
  units: BuildingRecordUnit[];
  parking: BuildingRecordCount;
  storage: BuildingRecordCount;
}

export async function readBuildingRecord(
  db: Queryable,
  buildingId: string,
  clock: Clock,
): Promise<BuildingRecord> {
  const found = await db.query<
    Omit<BuildingRecord, 'units' | 'parking' | 'storage'>
  >(
    `SELECT b.building_id AS "buildingId",
            b.name,
            b.address_line AS "addressLine",
            b.city,
            p.name AS "projectName",
            b.handover_date::text AS "handoverDate",
            b.warranty_end_date::text AS "warrantyEndDate",
            b.status
       FROM building b
       LEFT JOIN project p ON p.project_id = b.project_id
      WHERE b.building_id = $1`,
    [buildingId],
  );
  const building = found.rows[0];
  if (!building) {
    throw new KernelError('not_found', 'building not found');
  }
  // `getBuilding`'s order: the number as a number, so '10' does not sort before '2'.
  const units = await db.query<BuildingRecordUnit>(
    `SELECT u.unit_id AS "unitId",
            u.unit_number AS "unitNumber",
            s.floor,
            u.rooms::text AS rooms,
            u.area_sqm::text AS "areaSqm",
            u.tenure,
            pk.name AS "builtParking",
            st.name AS "builtStorage"
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       LEFT JOIN space pk ON pk.space_id = u.parking_space_id
       LEFT JOIN space st ON st.space_id = u.storage_space_id
      WHERE s.building_id = $1
      ORDER BY NULLIF(regexp_replace(u.unit_number, '\\D', '', 'g'), '')::int NULLS LAST,
               u.unit_number`,
    [buildingId],
  );
  const assignedByLetting = await assignedByActiveLettings(
    db,
    units.rows.map((unit) => unit.unitId),
    clock,
  );
  const spaces = await db.query<{
    space_id: string;
    space_kind: 'PARKING' | 'STORAGE';
    built: boolean;
  }>(
    `SELECT s.space_id, s.space_kind,
            EXISTS (SELECT 1 FROM unit u
                     WHERE u.parking_space_id = s.space_id
                        OR u.storage_space_id = s.space_id) AS built
       FROM space s
      WHERE s.building_id = $1
        AND s.space_kind IN ('PARKING', 'STORAGE')`,
    [buildingId],
  );
  const count = (kind: 'PARKING' | 'STORAGE'): BuildingRecordCount => {
    const ofKind = spaces.rows.filter((space) => space.space_kind === kind);
    return {
      total: ofKind.length,
      assigned: ofKind.filter(
        (space) => space.built || assignedByLetting.has(space.space_id),
      ).length,
    };
  };
  return {
    ...building,
    units: units.rows,
    parking: count('PARKING'),
    storage: count('STORAGE'),
  };
}

/**
 * The Space ids the lettings active today assign. Which letting counts is scope's answer, asked per
 * Unit: `resolveActiveTenancy` writes no access line, and a letting nobody is on yet still assigns.
 */
async function assignedByActiveLettings(
  db: Queryable,
  unitIds: string[],
  clock: Clock,
): Promise<Set<string>> {
  const tenancyIds: string[] = [];
  for (const unitId of unitIds) {
    const tenancyId = await resolveActiveTenancy(db, unitId, clock);
    if (tenancyId !== null) tenancyIds.push(tenancyId);
  }
  // `listOccupiedAssignments`'s rows: the ids are already today's, so the read has no day predicate.
  const rows = await listOccupiedAssignments(db, tenancyIds);
  return new Set(
    rows
      .flatMap((row) => [
        row.parking_space_id,
        row.second_parking_space_id,
        row.storage_space_id,
        row.second_storage_space_id,
      ])
      .filter((id): id is string => id !== null),
  );
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
