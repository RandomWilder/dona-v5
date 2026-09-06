// The shape an import is given. Slice 1.11.
//
// A *plan* and not a set of rows: it names spaces by their natural key rather than by an id, because
// the whole point of this slice is that the same input can be handed to the importer twice. An input
// carrying ids would be an input that decides identity, and the second run would decide it again.
//
// Vocabularies are the workbook's (docs/model/, E1-E4) and are spelled here as unions so a typo is a
// typecheck failure rather than a CHECK violation at 3am.
import type { Pool, PoolClient } from 'pg';

// Same definition src/scope/ uses. Deliberately not imported from there: scope depends on estate,
// and a type import the other way is the first hop of a cycle.
export type Queryable = Pool | PoolClient;

export type SpaceKind =
  | 'UNIT'
  | 'COMMON'
  | 'TECHNICAL'
  | 'EXTERIOR'
  | 'PARKING'
  | 'STORAGE';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'EXITED';
export type BuildingStatus = 'ACTIVE' | 'IN_CONSTRUCTION' | 'EXITED';
export type ConditionStatus = 'READY' | 'RENOVATION' | 'WITHHELD';

export interface ProjectPlan {
  name: string;
  /** The natural key. One דירה להשכיר tender code is one project. */
  projectCode: string;
  tenderRef: string | null;
  status: ProjectStatus;
}

export interface SpacePlan {
  kind: SpaceKind;
  /** Unique within its building and kind — the natural key `0005_` declares. */
  name: string;
  floor: string | null;
  /** -- pii. Null in every fixture: how a technician gets into a home is not test data. */
  accessNote: string | null;
}

export interface UnitPlan {
  /** The `UNIT` space this extends, by name. R2 — the unit's key *is* the space's. */
  spaceName: string;
  unitNumber: string;
  rooms: number;
  areaSqm: number | null;
  hasMamad: boolean;
  /** A `PARKING` space in the same building, by name. Null is the ordinary case (D3). */
  parkingSpaceName: string | null;
  /** A `STORAGE` space in the same building, by name. */
  storageSpaceName: string | null;
  /** Overrides the building's date when this unit was handed over separately (R14). */
  warrantyEndDate: string | null;
  conditionStatus: ConditionStatus;
}

export interface BuildingPlan {
  name: string;
  addressLine: string;
  city: string;
  /** The project's `projectCode`, or null — R15, a building needs no project. */
  projectCode: string | null;
  handoverDate: string;
  warrantyEndDate: string;
  status: BuildingStatus;
  spaces: SpacePlan[];
  units: UnitPlan[];
}

export interface EstatePlan {
  projects: ProjectPlan[];
  buildings: BuildingPlan[];
}

/**
 * What one table's upserts did — counted from the statements themselves, never from `count(*)`.
 *
 * A whole-table count is not a fact about *this* import: another suite, another environment or a
 * developer's own seed can move it, and an import that reported "created 0" because somebody else's
 * row was already there would be reporting the wrong thing while looking right. Slice 1.11 shipped
 * the count version and CI caught it within the hour, two test files racing over one database.
 */
export interface TableCount {
  created: number;
  updated: number;
}

export interface ImportReport {
  project: TableCount;
  building: TableCount;
  space: TableCount;
  unit: TableCount;
}
