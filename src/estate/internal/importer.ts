// The importer. Slice 1.11, and the reason `0005_estate_natural_keys.sql` exists.
//
// One property, and everything here serves it: **running the same plan twice leaves the same rows.**
// Not "does not crash" — the same primary keys, so anything that later points at a unit still points
// at it. That is what a re-runnable import means, and it is the difference between a seed and a
// duplicate.
//
// The mechanism is `ON CONFLICT (<natural key>) DO UPDATE ... RETURNING <pk>`, one statement per row.
// The id is *proposed*: on a second run the conflict fires and Postgres returns the id already there.
// `DO UPDATE` rather than `DO NOTHING` for two reasons -- DO NOTHING returns no row, so the importer
// would have to re-select to learn the id it just failed to insert, and an import correcting a typo
// in a floor or an area should correct it.
//
// Everything runs in one transaction. A half-imported building is not a state anyone should have to
// reason about, and the whole plan is one screen's worth of rows.
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED } from '../../kernel/upsert.ts';
import type {
  BuildingPlan,
  EstatePlan,
  ImportReport,
  Queryable,
  SpacePlan,
  TableCount,
  UnitPlan,
  UnitRowResult,
  UnitRowSpec,
} from './plan.ts';

class Tally {
  created = 0;
  updated = 0;
  count(inserted: boolean): void {
    if (inserted) {
      this.created += 1;
    } else {
      this.updated += 1;
    }
  }
  get report(): TableCount {
    return { created: this.created, updated: this.updated };
  }
}

// Validation at the edge (AGENTS.md). Every one of these is a plan that would otherwise fail deep
// inside a foreign key with a message about a uuid, which says nothing about the line of the fixture
// that is wrong.
function validatePlan(plan: EstatePlan): void {
  const codes = new Set<string>();
  for (const project of plan.projects) {
    if (codes.has(project.projectCode)) {
      throw new KernelError('invalid', 'two projects share a project_code', {
        projectCode: project.projectCode,
      });
    }
    codes.add(project.projectCode);
  }
  const addresses = new Set<string>();
  for (const building of plan.buildings) {
    const address = `${building.city}|${building.addressLine}`;
    if (addresses.has(address)) {
      throw new KernelError('invalid', 'two buildings share an address', {
        address,
      });
    }
    addresses.add(address);
    if (building.projectCode !== null && !codes.has(building.projectCode)) {
      throw new KernelError('invalid', 'building names an unknown project', {
        building: building.name,
        projectCode: building.projectCode,
      });
    }
    validateBuildingSpaces(building);
  }
}

function validateBuildingSpaces(building: BuildingPlan): void {
  const byKind = new Map<string, Set<string>>();
  for (const space of building.spaces) {
    const names = byKind.get(space.kind) ?? new Set<string>();
    if (names.has(space.name)) {
      throw new KernelError('invalid', 'two spaces share a kind and a name', {
        building: building.name,
        kind: space.kind,
        name: space.name,
      });
    }
    names.add(space.name);
    byKind.set(space.kind, names);
  }
  const requireSpace = (kind: string, name: string | null, field: string) => {
    if (name === null) return;
    if (!byKind.get(kind)?.has(name)) {
      throw new KernelError(
        'invalid',
        `unit names a ${field} that is not a ${kind} space`,
        {
          building: building.name,
          name,
        },
      );
    }
  };
  const numbers = new Set<string>();
  for (const unit of building.units) {
    if (numbers.has(unit.unitNumber)) {
      throw new KernelError('invalid', 'two units share a unit_number', {
        building: building.name,
        unitNumber: unit.unitNumber,
      });
    }
    numbers.add(unit.unitNumber);
    requireSpace('UNIT', unit.spaceName, 'space');
    requireSpace('PARKING', unit.parkingSpaceName, 'parking space');
    requireSpace('STORAGE', unit.storageSpaceName, 'storage space');
  }
}

async function upsertProject(
  db: Queryable,
  project: EstatePlan['projects'][number],
): Promise<boolean> {
  const result = await db.query<{ inserted: boolean }>(
    `INSERT INTO project (project_id, name, project_code, tender_ref, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_code) DO UPDATE
       SET name = EXCLUDED.name,
           tender_ref = EXCLUDED.tender_ref,
           status = EXCLUDED.status
     RETURNING ${INSERTED}`,
    [
      newId(),
      project.name,
      project.projectCode,
      project.tenderRef,
      project.status,
    ],
  );
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) {
    throw new KernelError('conflict', 'project upsert returned no row', {
      projectCode: project.projectCode,
    });
  }
  return inserted;
}

async function upsertBuilding(
  db: Queryable,
  building: BuildingPlan,
): Promise<{ buildingId: string; inserted: boolean }> {
  // project_id is resolved by the tender code rather than carried in the plan, so a plan never holds
  // an id and the two halves cannot disagree about which project a building is in.
  const result = await db.query<{ building_id: string; inserted: boolean }>(
    `INSERT INTO building (building_id, name, address_line, city, project_id,
                           handover_date, warranty_end_date, status)
     VALUES ($1, $2, $3, $4,
             (SELECT project_id FROM project WHERE project_code = $5),
             $6, $7, $8)
     ON CONFLICT (address_key) DO UPDATE
       SET name = EXCLUDED.name,
           project_id = EXCLUDED.project_id,
           handover_date = EXCLUDED.handover_date,
           warranty_end_date = EXCLUDED.warranty_end_date,
           status = EXCLUDED.status
     RETURNING building_id, ${INSERTED}`,
    [
      newId(),
      building.name,
      building.addressLine,
      building.city,
      building.projectCode,
      building.handoverDate,
      building.warrantyEndDate,
      building.status,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'building upsert returned no row', {
      building: building.name,
    });
  }
  return { buildingId: row.building_id, inserted: row.inserted };
}

/** Space ids by `kind\nname`, which is the natural key `0005_` declares, minus the building. */
type SpaceIndex = Map<string, string>;

const spaceKey = (kind: string, name: string) => `${kind}\n${name}`;

async function upsertSpace(
  db: Queryable,
  buildingId: string,
  space: SpacePlan,
): Promise<{ spaceId: string; inserted: boolean }> {
  const result = await db.query<{ space_id: string; inserted: boolean }>(
    `INSERT INTO space (space_id, building_id, space_kind, name, floor, access_note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (building_id, space_kind, name) DO UPDATE
       SET floor = EXCLUDED.floor,
           access_note = EXCLUDED.access_note
     RETURNING space_id, ${INSERTED}`,
    [
      newId(),
      buildingId,
      space.kind,
      space.name,
      space.floor,
      space.accessNote,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'space upsert returned no row', {
      space: space.name,
    });
  }
  return { spaceId: row.space_id, inserted: row.inserted };
}

async function upsertSpaces(
  db: Queryable,
  buildingId: string,
  building: BuildingPlan,
  tally: Tally,
): Promise<SpaceIndex> {
  const index: SpaceIndex = new Map();
  for (const space of building.spaces) {
    const { spaceId, inserted } = await upsertSpace(db, buildingId, space);
    tally.count(inserted);
    index.set(spaceKey(space.kind, space.name), spaceId);
  }
  return index;
}

async function upsertUnit(
  db: Queryable,
  ids: { unitId: string; parking: string | null; storage: string | null },
  unit: UnitPlan,
): Promise<boolean> {
  // The conflict target is the primary key, and it is the natural key: R2 makes a unit's identity
  // its space's, so there is no second key here to keep in step with the first.
  const result = await db.query<{ inserted: boolean }>(
    `INSERT INTO unit (unit_id, unit_number, rooms, area_sqm, has_mamad,
                       parking_space_id, storage_space_id, warranty_end_date, condition_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (unit_id) DO UPDATE
       SET unit_number = EXCLUDED.unit_number,
           rooms = EXCLUDED.rooms,
           area_sqm = EXCLUDED.area_sqm,
           has_mamad = EXCLUDED.has_mamad,
           parking_space_id = EXCLUDED.parking_space_id,
           storage_space_id = EXCLUDED.storage_space_id,
           warranty_end_date = EXCLUDED.warranty_end_date,
           condition_status = EXCLUDED.condition_status
     RETURNING ${INSERTED}`,
    [
      ids.unitId,
      unit.unitNumber,
      unit.rooms,
      unit.areaSqm,
      unit.hasMamad,
      ids.parking,
      ids.storage,
      unit.warrantyEndDate,
      unit.conditionStatus,
    ],
  );
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) {
    throw new KernelError('conflict', 'unit upsert returned no row', {
      unitNumber: unit.unitNumber,
    });
  }
  return inserted;
}

async function upsertUnits(
  db: Queryable,
  building: BuildingPlan,
  spaces: SpaceIndex,
  tally: Tally,
): Promise<void> {
  for (const unit of building.units) {
    // Non-null by validatePlan, which has already checked every one of these three against the
    // plan's own spaces.
    const unitId = spaces.get(spaceKey('UNIT', unit.spaceName)) as string;
    const parking = unit.parkingSpaceName
      ? (spaces.get(spaceKey('PARKING', unit.parkingSpaceName)) as string)
      : null;
    const storage = unit.storageSpaceName
      ? (spaces.get(spaceKey('STORAGE', unit.storageSpaceName)) as string)
      : null;
    tally.count(await upsertUnit(db, { unitId, parking, storage }, unit));
  }
}

/**
 * Applies a plan. Idempotent: the second run over the same plan creates nothing and changes no id.
 *
 * The caller owns the transaction when it hands a `PoolClient`; handed a `Pool`, each statement is
 * its own transaction, which is why `src/seed.ts` opens one.
 */
export async function importEstate(
  db: Queryable,
  plan: EstatePlan,
): Promise<ImportReport> {
  validatePlan(plan);
  const project = new Tally();
  const buildings = new Tally();
  const space = new Tally();
  const unit = new Tally();
  for (const row of plan.projects) {
    project.count(await upsertProject(db, row));
  }
  for (const building of plan.buildings) {
    const { buildingId, inserted } = await upsertBuilding(db, building);
    buildings.count(inserted);
    const spaces = await upsertSpaces(db, buildingId, building, space);
    await upsertUnits(db, building, spaces, unit);
  }
  return {
    project: project.report,
    building: buildings.report,
    space: space.report,
    unit: unit.report,
  };
}

/**
 * Upserts one register line's worth of estate — one project, one building, one `UNIT` space, one
 * unit — and **returns the `unit_id`**, which is what `importEstate` does not.
 *
 * Slice 2.4. The register (SPEC-register.md) is a flat file whose rows repeat their building, so its
 * importer needs a row-shaped call rather than a plan-shaped one, and it needs the id back in order
 * to hang a tenancy off it. A plan-shaped caller already knows its own shape and never had to ask.
 *
 * It is the same four upserts, extracted rather than copied: `importEstate` and this function call
 * one function per table. That is what keeps `src/register/` from writing SQL against tables this
 * module owns — and it is why a change to how a building is keyed changes one statement, not two.
 *
 * No `validatePlan` here. Its checks are all about a plan's *internal* consistency — a unit naming a
 * space the plan does not contain, two buildings sharing an address — and a single row has no
 * internals to be inconsistent with. The register's own row validation is `src/register/`'s, where
 * a rejection can carry a line number.
 */
export async function upsertUnitRow(
  db: Queryable,
  spec: UnitRowSpec,
): Promise<UnitRowResult> {
  const project = spec.project ? await upsertProject(db, spec.project) : null;
  const building = await upsertBuilding(db, {
    ...spec.building,
    spaces: [],
    units: [],
  });

  // A register carries apartments and nothing else — no lobby, no plant room — so the one space a
  // row implies is the `UNIT` it names. Parking bays and storage rooms are Space rows too (workbook
  // D3) and reach the system through a plan, which is where a handover protocol will put them.
  const space = await upsertSpace(db, building.buildingId, {
    kind: 'UNIT',
    name: spec.unit.spaceName,
    floor: spec.floor,
    accessNote: null,
  });
  const unit = await upsertUnit(
    db,
    { unitId: space.spaceId, parking: null, storage: null },
    { ...spec.unit, parkingSpaceName: null, storageSpaceName: null },
  );
  return {
    unitId: space.spaceId,
    inserted: {
      project,
      building: building.inserted,
      space: space.inserted,
      unit,
    },
  };
}
