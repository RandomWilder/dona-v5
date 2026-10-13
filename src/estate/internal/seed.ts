// Seeding one building from a building plan file. SPEC-estate.md, "Seeding a building from a
// developer sheet (operator, not a screen)".
//
// The system reads one format and no developer's. The file is JSON in the shape of `EstatePlan`, one
// project at most and exactly one building, and it is read strictly here: an unknown field is a typo
// that would otherwise import as nothing, so it is refused with its path, like every other mistake.
// A plan file attaches no bay or storage room to a flat — who parks where comes from the leases.
import { gunzipSync } from 'node:zlib';
import { KernelError } from '../../kernel/errors.ts';
import { importEstate } from './importer.ts';
import type {
  AttachedStorage,
  BuildingPlan,
  EstatePlan,
  ImportReport,
  ProjectPlan,
  Queryable,
  RentalTrack,
  SpacePlan,
  Tenure,
  UnitPlan,
} from './plan.ts';

export interface EstateSeedArgs {
  mode: 'list' | 'apply';
  update: boolean;
  source: { kind: 'file'; path: string } | { kind: 'b64'; data: string };
}

const USAGE =
  'usage: estate:seed list|apply <plan.json> [--update]  (a job passes --plan-b64 <data> instead)';

export function parseEstateSeedArgs(argv: string[]): EstateSeedArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'list' && mode !== 'apply') {
    throw new KernelError('invalid', USAGE);
  }
  let update = false;
  let source: EstateSeedArgs['source'] | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--update') {
      update = true;
    } else if (arg === '--plan-b64' && rest[i + 1] && source === undefined) {
      source = { kind: 'b64', data: rest[i + 1] };
      i += 1;
    } else if (!arg.startsWith('--') && source === undefined) {
      source = { kind: 'file', path: arg };
    } else {
      throw new KernelError('invalid', USAGE);
    }
  }
  if (source === undefined) throw new KernelError('invalid', USAGE);
  return { mode, update, source };
}

/** The job's argument back into JSON: base64 of the gzipped file, which carries no comma. */
export function decodeSeedPayload(data: string): unknown {
  return JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8'));
}

// ── reading the file ─────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function bad(path: string, message: string): never {
  throw new KernelError('invalid', `${path}: ${message}`);
}

function object(value: unknown, path: string, allowed: readonly string[]): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bad(path, 'expected an object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) bad(path, `unknown field ${key}`);
  }
  return value as Obj;
}

function text(o: Obj, key: string, path: string): string {
  const value = o[key];
  if (typeof value !== 'string' || value.trim() === '') {
    bad(`${path}.${key}`, 'expected non-empty text');
  }
  return value;
}

function textOrNull(o: Obj, key: string, path: string): string | null {
  return o[key] === null ? null : text(o, key, path);
}

/** Optional with #143's meaning: absent stays `undefined`, so the importer leaves the row. */
function optional<T>(o: Obj, key: string, read: () => T): T | undefined {
  return key in o ? read() : undefined;
}

function number(o: Obj, key: string, path: string, min = 0): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    bad(`${path}.${key}`, `expected a number ≥ ${min}`);
  }
  return value;
}

function numberOrNull(o: Obj, key: string, path: string): number | null {
  return o[key] === null ? null : number(o, key, path);
}

function boolean(o: Obj, key: string, path: string): boolean {
  if (typeof o[key] !== 'boolean')
    bad(`${path}.${key}`, 'expected true or false');
  return o[key] as boolean;
}

function oneOf<T extends string>(
  o: Obj,
  key: string,
  path: string,
  values: readonly T[],
): T {
  const value = o[key];
  if (typeof value !== 'string' || !values.includes(value as T)) {
    bad(`${path}.${key}`, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function date(o: Obj, key: string, path: string): string {
  const value = o[key];
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    bad(`${path}.${key}`, 'expected a date YYYY-MM-DD');
  }
  return value;
}

function dateOrNull(o: Obj, key: string, path: string): string | null {
  return o[key] === null ? null : date(o, key, path);
}

function list(o: Obj, key: string, path: string): unknown[] {
  if (!Array.isArray(o[key])) bad(`${path}.${key}`, 'expected a list');
  return o[key] as unknown[];
}

function readProject(value: unknown, path: string): ProjectPlan {
  const o = object(value, path, ['name', 'projectCode', 'tenderRef', 'status']);
  return {
    name: text(o, 'name', path),
    projectCode: text(o, 'projectCode', path),
    tenderRef: textOrNull(o, 'tenderRef', path),
    status: oneOf(o, 'status', path, ['PLANNING', 'ACTIVE', 'EXITED']),
  };
}

function readSpace(value: unknown, path: string): SpacePlan {
  const o = object(value, path, [
    'kind',
    'name',
    'floor',
    'accessNote',
    'disabledBay',
    'areaSqm',
    'overParking',
  ]);
  // -- pii. How a technician gets into a home does not travel in a layout file.
  if (o.accessNote !== null) bad(`${path}.accessNote`, 'must be null');
  const space: SpacePlan = {
    kind: oneOf(o, 'kind', path, [
      'UNIT',
      'COMMON',
      'TECHNICAL',
      'EXTERIOR',
      'PARKING',
      'STORAGE',
    ]),
    name: text(o, 'name', path),
    floor: textOrNull(o, 'floor', path),
    accessNote: null,
  };
  const disabledBay = optional(o, 'disabledBay', () =>
    boolean(o, 'disabledBay', path),
  );
  if (disabledBay !== undefined) space.disabledBay = disabledBay;
  const areaSqm = optional(o, 'areaSqm', () =>
    numberOrNull(o, 'areaSqm', path),
  );
  if (areaSqm !== undefined) space.areaSqm = areaSqm;
  const overParking = optional(o, 'overParking', () =>
    boolean(o, 'overParking', path),
  );
  if (overParking !== undefined) space.overParking = overParking;
  return space;
}

function readUnit(value: unknown, path: string): UnitPlan {
  const o = object(value, path, [
    'spaceName',
    'unitNumber',
    'rooms',
    'areaSqm',
    'hasMamad',
    'parkingSpaceName',
    'storageSpaceName',
    'warrantyEndDate',
    'conditionStatus',
    'tenure',
    'rentalTrack',
    'flatType',
    'balconySqm',
    'gardenSqm',
    'sukkahBalcony',
    'attachedStorage',
  ]);
  for (const key of ['parkingSpaceName', 'storageSpaceName']) {
    if (o[key] !== null) {
      bad(
        `${path}.${key}`,
        'a plan file attaches no bay or storage room to a flat; leave it null',
      );
    }
  }
  const unit: UnitPlan = {
    spaceName: text(o, 'spaceName', path),
    unitNumber: text(o, 'unitNumber', path),
    rooms: number(o, 'rooms', path, 0.5),
    areaSqm: numberOrNull(o, 'areaSqm', path),
    hasMamad: boolean(o, 'hasMamad', path),
    parkingSpaceName: null,
    storageSpaceName: null,
    warrantyEndDate: dateOrNull(o, 'warrantyEndDate', path),
    conditionStatus: oneOf(o, 'conditionStatus', path, [
      'READY',
      'RENOVATION',
      'WITHHELD',
    ]),
  };
  const tenure = optional(o, 'tenure', () =>
    oneOf<Tenure>(o, 'tenure', path, ['FOR_RENT', 'FOR_SALE', 'SOLD']),
  );
  if (tenure !== undefined) unit.tenure = tenure;
  const rentalTrack = optional(o, 'rentalTrack', () =>
    oneOf<RentalTrack>(o, 'rentalTrack', path, ['FREE_MARKET', 'REGULATED']),
  );
  if (rentalTrack !== undefined) unit.rentalTrack = rentalTrack;
  const flatType = optional(o, 'flatType', () =>
    textOrNull(o, 'flatType', path),
  );
  if (flatType !== undefined) unit.flatType = flatType;
  const balconySqm = optional(o, 'balconySqm', () =>
    numberOrNull(o, 'balconySqm', path),
  );
  if (balconySqm !== undefined) unit.balconySqm = balconySqm;
  const gardenSqm = optional(o, 'gardenSqm', () =>
    numberOrNull(o, 'gardenSqm', path),
  );
  if (gardenSqm !== undefined) unit.gardenSqm = gardenSqm;
  const sukkahBalcony = optional(o, 'sukkahBalcony', () =>
    boolean(o, 'sukkahBalcony', path),
  );
  if (sukkahBalcony !== undefined) unit.sukkahBalcony = sukkahBalcony;
  const attachedStorage = optional(o, 'attachedStorage', () =>
    o.attachedStorage === null
      ? null
      : oneOf<AttachedStorage>(o, 'attachedStorage', path, [
          'GARDEN',
          'BALCONY',
        ]),
  );
  if (attachedStorage !== undefined) unit.attachedStorage = attachedStorage;
  return unit;
}

function readBuilding(value: unknown, path: string): BuildingPlan {
  const o = object(value, path, [
    'name',
    'addressLine',
    'city',
    'projectCode',
    'handoverDate',
    'warrantyEndDate',
    'status',
    'gush',
    'helka',
    'buildingNumber',
    'spaces',
    'units',
  ]);
  const building: BuildingPlan = {
    name: text(o, 'name', path),
    addressLine: text(o, 'addressLine', path),
    city: text(o, 'city', path),
    projectCode: textOrNull(o, 'projectCode', path),
    handoverDate: date(o, 'handoverDate', path),
    warrantyEndDate: date(o, 'warrantyEndDate', path),
    status: oneOf(o, 'status', path, ['ACTIVE', 'IN_CONSTRUCTION', 'EXITED']),
    spaces: list(o, 'spaces', path).map((s, i) =>
      readSpace(s, `${path}.spaces[${i}]`),
    ),
    units: list(o, 'units', path).map((u, i) =>
      readUnit(u, `${path}.units[${i}]`),
    ),
  };
  for (const key of ['gush', 'helka', 'buildingNumber'] as const) {
    const read = optional(o, key, () => textOrNull(o, key, path));
    if (read !== undefined) building[key] = read;
  }
  // validatePlan checks that every flat names a UNIT space. This is the other direction: a UNIT
  // space with no flat would be a door with no rooms, floor or tenure.
  const flats = new Set(building.units.map((u) => u.spaceName));
  for (const space of building.spaces) {
    if (space.kind === 'UNIT' && !flats.has(space.name)) {
      bad(path, `UNIT space ${space.name} has no flat`);
    }
  }
  return building;
}

/** The file, read strictly. Throws `invalid` naming the first bad field's path. */
export function readSeedPlan(json: unknown): EstatePlan {
  const o = object(json, 'plan', ['projects', 'buildings']);
  const projects = list(o, 'projects', 'plan');
  if (projects.length > 1) bad('projects', 'at most one project');
  const buildings = list(o, 'buildings', 'plan');
  if (buildings.length !== 1) bad('buildings', 'exactly one building');
  return {
    projects: projects.map((p, i) => readProject(p, `projects[${i}]`)),
    buildings: [readBuilding(buildings[0], 'buildings[0]')],
  };
}

// ── what it would write ──────────────────────────────────────────────────────────────────────────

/**
 * `קרקע` first, then floors outward from it — 1, 2, 3 upward and -1, -2, -3 downward, the way a
 * basement is walked — then any other floor name as written.
 */
function floorOrder(a: string, b: string): number {
  const rank = (f: string) => {
    if (f === 'קרקע') return 0;
    if (!/^-?\d+$/.test(f)) return Number.POSITIVE_INFINITY;
    const n = Number(f);
    return n < 0 ? -n + 0.5 : n;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

function byFloor(spaces: readonly SpacePlan[]): string {
  const counts = new Map<string, number>();
  for (const space of spaces) {
    const floor = space.floor ?? '—';
    counts.set(floor, (counts.get(floor) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => floorOrder(a, b))
    .map(([floor, n]) => `${floor} ${n}`)
    .join(' · ');
}

export function summariseSeedPlan(plan: EstatePlan): string[] {
  const building = plan.buildings[0];
  const project = plan.projects[0];
  const of = (kind: string) => building.spaces.filter((s) => s.kind === kind);
  const tenure = (t: string) =>
    building.units.filter((u) => (u.tenure ?? 'FOR_RENT') === t).length;
  const regulated = building.units.filter(
    (u) => u.rentalTrack === 'REGULATED',
  ).length;
  const floors = [...new Set(of('UNIT').map((s) => s.floor ?? '—'))].sort(
    floorOrder,
  );
  const types = new Set(building.units.map((u) => u.flatType ?? null));
  types.delete(null);
  const parking = of('PARKING');
  const storage = of('STORAGE');
  const other =
    building.spaces.length -
    of('UNIT').length -
    parking.length -
    storage.length;
  return [
    `building  ${building.name} · ${building.addressLine}, ${building.city} · ${building.status}`,
    `          project ${project ? `${project.projectCode} (${project.name})` : (building.projectCode ?? '—')} · handover ${building.handoverDate} → warranty ${building.warrantyEndDate}`,
    `flats     ${building.units.length} · FOR_RENT ${tenure('FOR_RENT')} · FOR_SALE ${tenure('FOR_SALE')} · SOLD ${tenure('SOLD')} · regulated ${regulated} · floors ${floors[0] ?? '—'}–${floors.at(-1) ?? '—'} · types ${types.size}`,
    `parking   ${parking.length}${parking.length ? ` · ${byFloor(parking)}` : ''} · disabled ${parking.filter((s) => s.disabledBay).length}`,
    `markings  garden ${building.units.filter((u) => u.gardenSqm != null).length} · sukkah ${building.units.filter((u) => u.sukkahBalcony).length} · attached storage ${building.units.filter((u) => u.attachedStorage != null).length}`,
    `storage   ${storage.length}${storage.length ? ` · ${byFloor(storage)}` : ''} · over parking ${storage.filter((s) => s.overParking).length}`,
    `other     ${other}`,
  ];
}

// ── writing it ───────────────────────────────────────────────────────────────────────────────────

/** The building already at this address, by the same normalisation `address_key` is generated with. */
export async function findSeededBuilding(
  db: Queryable,
  building: Pick<BuildingPlan, 'city' | 'addressLine'>,
): Promise<string | null> {
  const result = await db.query<{ building_id: string }>(
    `SELECT building_id FROM building
     WHERE address_key = lower(
       btrim(regexp_replace($1, '\\s+', ' ', 'g')) || '|' ||
       btrim(regexp_replace($2, '\\s+', ' ', 'g')))`,
    [building.city, building.addressLine],
  );
  return result.rows[0]?.building_id ?? null;
}

export interface SeedResult {
  buildingId: string;
  /** The building that was already there, which only `--update` writes over. */
  existingBuildingId: string | null;
  report: ImportReport;
}

/**
 * Writes the plan with `importEstate`. A building that already exists at the address is refused
 * unless `update`: it was seeded once, and what an admin has typed on it since must not be
 * overwritten by a second run of the same file. The caller owns the transaction.
 */
export async function seedBuilding(
  db: Queryable,
  plan: EstatePlan,
  options: { update: boolean },
): Promise<SeedResult> {
  const building = plan.buildings[0];
  const existingBuildingId = await findSeededBuilding(db, building);
  if (existingBuildingId !== null && !options.update) {
    throw new KernelError(
      'conflict',
      `building already exists at ${building.addressLine}, ${building.city} (${existingBuildingId}); rerun with --update to write over its facts`,
    );
  }
  const report = await importEstate(db, plan);
  const buildingId = await findSeededBuilding(db, building);
  if (buildingId === null) {
    throw new KernelError('conflict', 'seeded building is not at its address');
  }
  return { buildingId, existingBuildingId, report };
}
