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
import type {
  BuildingPlan,
  EstatePlan,
  ImportReport,
  Queryable,
  TableCount,
} from './plan.ts';

const TABLES = ['project', 'building', 'space', 'unit'] as const;
type Table = (typeof TABLES)[number];

async function countRows(db: Queryable, table: Table): Promise<number> {
  // `table` is one of four literals from TABLES and never a caller's string: there is no
  // parameterised form of an identifier, so the safety here is that no request-derived value can
  // reach it.
  const result = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

// Sequential, not Promise.all: handed a PoolClient these share one connection, and pg deprecates
// (and serialises) a second query issued while the first is in flight.
async function countAll(db: Queryable): Promise<Record<Table, number>> {
  const counts = {} as Record<Table, number>;
  for (const table of TABLES) {
    counts[table] = await countRows(db, table);
  }
  return counts;
}

function delta(before: number, after: number): TableCount {
  return { before, after, created: after - before };
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
): Promise<void> {
  await db.query(
    `INSERT INTO project (project_id, name, project_code, tender_ref, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_code) DO UPDATE
       SET name = EXCLUDED.name,
           tender_ref = EXCLUDED.tender_ref,
           status = EXCLUDED.status`,
    [
      newId(),
      project.name,
      project.projectCode,
      project.tenderRef,
      project.status,
    ],
  );
}

async function upsertBuilding(
  db: Queryable,
  building: BuildingPlan,
): Promise<string> {
  // project_id is resolved by the tender code rather than carried in the plan, so a plan never holds
  // an id and the two halves cannot disagree about which project a building is in.
  const result = await db.query<{ building_id: string }>(
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
     RETURNING building_id`,
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
  const buildingId = result.rows[0]?.building_id;
  if (!buildingId) {
    throw new KernelError('conflict', 'building upsert returned no row', {
      building: building.name,
    });
  }
  return buildingId;
}

/** Space ids by `kind\nname`, which is the natural key `0005_` declares, minus the building. */
type SpaceIndex = Map<string, string>;

const spaceKey = (kind: string, name: string) => `${kind}\n${name}`;

async function upsertSpaces(
  db: Queryable,
  buildingId: string,
  building: BuildingPlan,
): Promise<SpaceIndex> {
  const index: SpaceIndex = new Map();
  for (const space of building.spaces) {
    const result = await db.query<{ space_id: string }>(
      `INSERT INTO space (space_id, building_id, space_kind, name, floor, access_note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (building_id, space_kind, name) DO UPDATE
         SET floor = EXCLUDED.floor,
             access_note = EXCLUDED.access_note
       RETURNING space_id`,
      [
        newId(),
        buildingId,
        space.kind,
        space.name,
        space.floor,
        space.accessNote,
      ],
    );
    const spaceId = result.rows[0]?.space_id;
    if (!spaceId) {
      throw new KernelError('conflict', 'space upsert returned no row', {
        space: space.name,
      });
    }
    index.set(spaceKey(space.kind, space.name), spaceId);
  }
  return index;
}

async function upsertUnits(
  db: Queryable,
  building: BuildingPlan,
  spaces: SpaceIndex,
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
    // The conflict target is the primary key, and it is the natural key: R2 makes a unit's identity
    // its space's, so there is no second key here to keep in step with the first.
    await db.query(
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
             condition_status = EXCLUDED.condition_status`,
      [
        unitId,
        unit.unitNumber,
        unit.rooms,
        unit.areaSqm,
        unit.hasMamad,
        parking,
        storage,
        unit.warrantyEndDate,
        unit.conditionStatus,
      ],
    );
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
  const before = await countAll(db);
  for (const project of plan.projects) {
    await upsertProject(db, project);
  }
  for (const building of plan.buildings) {
    const buildingId = await upsertBuilding(db, building);
    const spaces = await upsertSpaces(db, buildingId, building);
    await upsertUnits(db, building, spaces);
  }
  const after = await countAll(db);
  return {
    project: delta(before.project, after.project),
    building: delta(before.building, after.building),
    space: delta(before.space, after.space),
    unit: delta(before.unit, after.unit),
  };
}
