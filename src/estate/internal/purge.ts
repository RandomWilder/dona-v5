// Operator purge of a Building or a Unit. Not a screen. Screens still have no delete.
//
// Local and staging only. List by address or id; apply by id. The Document row is what
// frees file_hash; bytes are a later call to infra/docs-delete.sh.
import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';
import type { Queryable } from './plan.ts';

export type EstatePurgeKind = 'building' | 'unit';

export interface EstatePurgeListQuery {
  address?: string;
  city?: string;
  buildingId?: string;
  unitId?: string;
}

export interface EstatePurgeApplySpec {
  kind: EstatePurgeKind;
  id: string;
}

export interface EstatePurgeUnitLine {
  unitId: string;
  unitNumber: string;
}

export interface EstatePurgeTarget {
  buildingId: string;
  name: string;
  addressLine: string;
  city: string;
  units: EstatePurgeUnitLine[];
  documentCount: number;
  tenancyCount: number;
  threadCount: number;
}

export interface EstatePurgeReport {
  kind: EstatePurgeKind;
  id: string;
  documentCount: number;
  unitCount: number;
  tenancyCount: number;
  partyCount: number;
  threadCount: number;
  storageUris: string[];
  objectPrefixes: string[];
}

export type EstatePurgeArgs =
  | { mode: 'list'; query: EstatePurgeListQuery }
  | { mode: 'apply'; spec: EstatePurgeApplySpec; yes: boolean };

export function refuseProdDatabase(databaseUrl: string | undefined): void {
  if (databaseUrl !== undefined && /dona-prod\b/.test(databaseUrl)) {
    throw new KernelError('not_allowed', 'operator purge refuses prod');
  }
}

export function parseEstatePurgeArgs(argv: string[]): EstatePurgeArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'list' && mode !== 'apply') {
    throw new KernelError(
      'invalid',
      'usage: estate:purge list|apply [--address …] [--city …] [--building <id>] [--unit <id>] [--yes]',
    );
  }
  const flags = readFlags(rest);
  if (mode === 'list') {
    if (
      flags.address === undefined &&
      flags.buildingId === undefined &&
      flags.unitId === undefined
    ) {
      throw new KernelError(
        'invalid',
        'list needs --address, --building, or --unit',
      );
    }
    return {
      mode: 'list',
      query: {
        address: flags.address,
        city: flags.city,
        buildingId: flags.buildingId,
        unitId: flags.unitId,
      },
    };
  }
  if (flags.buildingId !== undefined && flags.unitId !== undefined) {
    throw new KernelError(
      'invalid',
      'apply takes --building or --unit, not both',
    );
  }
  if (flags.buildingId !== undefined) {
    return {
      mode: 'apply',
      spec: { kind: 'building', id: flags.buildingId },
      yes: flags.yes,
    };
  }
  if (flags.unitId !== undefined) {
    return {
      mode: 'apply',
      spec: { kind: 'unit', id: flags.unitId },
      yes: flags.yes,
    };
  }
  throw new KernelError(
    'invalid',
    'apply requires --building <id> or --unit <id>',
  );
}

function readFlags(argv: string[]): {
  address?: string;
  city?: string;
  buildingId?: string;
  unitId?: string;
  yes: boolean;
} {
  const out: {
    address?: string;
    city?: string;
    buildingId?: string;
    unitId?: string;
    yes: boolean;
  } = { yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--yes') {
      out.yes = true;
      continue;
    }
    const value = argv[i + 1];
    if (token === '--address' && value !== undefined) {
      out.address = value;
      i += 1;
      continue;
    }
    if (token === '--city' && value !== undefined) {
      out.city = value;
      i += 1;
      continue;
    }
    if (token === '--building' && value !== undefined) {
      out.buildingId = validId(value, 'buildingId');
      i += 1;
      continue;
    }
    if (token === '--unit' && value !== undefined) {
      out.unitId = validId(value, 'unitId');
      i += 1;
      continue;
    }
    throw new KernelError('invalid', `unknown argument: ${token}`);
  }
  return out;
}

export async function listEstatePurge(
  db: Queryable,
  query: EstatePurgeListQuery,
): Promise<EstatePurgeTarget[]> {
  const buildings = await findBuildings(db, query);
  const scopedUnit = query.unitId;
  const targets: EstatePurgeTarget[] = [];
  for (const building of buildings) {
    const units = await listUnits(db, building.buildingId, scopedUnit);
    if (scopedUnit !== undefined && units.length === 0) continue;
    const ids = await collectIds(
      db,
      scopedUnit === undefined
        ? { kind: 'building', id: building.buildingId }
        : { kind: 'unit', id: scopedUnit },
    );
    targets.push({
      buildingId: building.buildingId,
      name: building.name,
      addressLine: building.addressLine,
      city: building.city,
      units,
      documentCount: ids.documentIds.length,
      tenancyCount: ids.tenancyIds.length,
      threadCount: ids.threadIds.length,
    });
  }
  return targets;
}

export async function applyEstatePurge(
  db: Queryable,
  spec: EstatePurgeApplySpec,
): Promise<EstatePurgeReport> {
  const id = validId(
    spec.id,
    spec.kind === 'building' ? 'buildingId' : 'unitId',
  );
  const ids = await collectIds(db, { kind: spec.kind, id });
  if (spec.kind === 'building' && ids.buildingId === null) {
    throw new KernelError('not_found', 'building not found');
  }
  if (spec.kind === 'unit' && ids.unitIds.length === 0) {
    throw new KernelError('not_found', 'unit not found');
  }

  const storage = await loadStorage(db, ids.documentIds);
  let disabledTriggers = false;
  try {
    await db.query('SET LOCAL session_replication_role = replica');
  } catch {
    await db.query('ALTER TABLE extracted_field DISABLE TRIGGER USER');
    await db.query('ALTER TABLE tenancy_event DISABLE TRIGGER USER');
    disabledTriggers = true;
  }
  try {
    await deleteBag(db, ids);
  } finally {
    if (disabledTriggers) {
      await db.query('ALTER TABLE extracted_field ENABLE TRIGGER USER');
      await db.query('ALTER TABLE tenancy_event ENABLE TRIGGER USER');
    }
  }

  const partyCount = await deleteOrphanParties(db, ids.partyIds);
  return {
    kind: spec.kind,
    id,
    documentCount: ids.documentIds.length,
    unitCount: ids.unitIds.length,
    tenancyCount: ids.tenancyIds.length,
    partyCount,
    threadCount: ids.threadIds.length,
    storageUris: storage.uris,
    objectPrefixes: storage.prefixes,
  };
}

interface PlaceIds {
  dropBuilding: boolean;
  buildingId: string | null;
  spaceIds: string[];
  unitIds: string[];
  tenancyIds: string[];
  assetIds: string[];
  obligationIds: string[];
  documentIds: string[];
  threadIds: string[];
  parkingIds: string[];
  storageIds: string[];
  partyIds: string[];
}

interface BuildingRow {
  buildingId: string;
  name: string;
  addressLine: string;
  city: string;
}

async function findBuildings(
  db: Queryable,
  query: EstatePurgeListQuery,
): Promise<BuildingRow[]> {
  if (query.buildingId !== undefined) {
    const id = validId(query.buildingId, 'buildingId');
    const { rows } = await db.query<BuildingRow>(
      `SELECT building_id AS "buildingId", name, address_line AS "addressLine", city
         FROM building WHERE building_id = $1`,
      [id],
    );
    return rows;
  }
  if (query.unitId !== undefined) {
    const id = validId(query.unitId, 'unitId');
    const { rows } = await db.query<BuildingRow>(
      `SELECT b.building_id AS "buildingId", b.name, b.address_line AS "addressLine", b.city
         FROM building b
         JOIN space s ON s.building_id = b.building_id
        WHERE s.space_id = $1`,
      [id],
    );
    return rows;
  }
  const address = query.address?.trim() ?? '';
  if (address.length === 0) {
    throw new KernelError(
      'invalid',
      'list needs --address, --building, or --unit',
    );
  }
  const city = query.city?.trim();
  const { rows } = await db.query<BuildingRow>(
    `SELECT building_id AS "buildingId", name, address_line AS "addressLine", city
       FROM building
      WHERE address_line LIKE '%' || $1 || '%'
        AND ($2::text IS NULL OR city = $2)
      ORDER BY city, address_line`,
    [address, city === undefined || city.length === 0 ? null : city],
  );
  return rows;
}

async function listUnits(
  db: Queryable,
  buildingId: string,
  onlyUnitId?: string,
): Promise<EstatePurgeUnitLine[]> {
  const { rows } = await db.query<EstatePurgeUnitLine>(
    `SELECT u.unit_id AS "unitId", u.unit_number AS "unitNumber"
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
      WHERE s.building_id = $1
        AND ($2::uuid IS NULL OR u.unit_id = $2)
      ORDER BY u.unit_number`,
    [buildingId, onlyUnitId ?? null],
  );
  return rows;
}

async function collectIds(
  db: Queryable,
  spec: EstatePurgeApplySpec,
): Promise<PlaceIds> {
  const id = validId(
    spec.id,
    spec.kind === 'building' ? 'buildingId' : 'unitId',
  );
  let buildingId: string | null = spec.kind === 'building' ? id : null;
  if (spec.kind === 'unit') {
    const found = await db.query<{ building_id: string }>(
      `SELECT building_id FROM space WHERE space_id = $1 AND space_kind = 'UNIT'`,
      [id],
    );
    buildingId = found.rows[0]?.building_id ?? null;
  } else {
    const found = await db.query<{ building_id: string }>(
      `SELECT building_id FROM building WHERE building_id = $1`,
      [id],
    );
    if (found.rows[0] === undefined) {
      return emptyIds();
    }
  }

  const units = await db.query<{ unit_id: string }>(
    spec.kind === 'building'
      ? `SELECT u.unit_id
           FROM unit u
           JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`
      : `SELECT unit_id FROM unit WHERE unit_id = $1`,
    [id],
  );
  const unitIds = units.rows.map((row) => row.unit_id);
  if (spec.kind === 'unit' && unitIds.length === 0) {
    return emptyIds();
  }

  const spaces = await db.query<{ space_id: string }>(
    spec.kind === 'building'
      ? `SELECT space_id FROM space WHERE building_id = $1`
      : `SELECT space_id FROM space WHERE space_id = $1
         UNION
         SELECT parking_space_id FROM unit WHERE unit_id = $1 AND parking_space_id IS NOT NULL
         UNION
         SELECT storage_space_id FROM unit WHERE unit_id = $1 AND storage_space_id IS NOT NULL`,
    [id],
  );
  const spaceIds = spaces.rows.map((row) => row.space_id);

  const bays = await db.query<{
    parking_id: string | null;
    storage_id: string | null;
  }>(
    spec.kind === 'building'
      ? `SELECT u.parking_space_id AS parking_id, u.storage_space_id AS storage_id
           FROM unit u
           JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`
      : `SELECT parking_space_id AS parking_id, storage_space_id AS storage_id
           FROM unit WHERE unit_id = $1`,
    [id],
  );
  const parkingIds = unique(
    bays.rows
      .map((row) => row.parking_id)
      .filter((value): value is string => value !== null),
  );
  const storageIds = unique(
    bays.rows
      .map((row) => row.storage_id)
      .filter((value): value is string => value !== null),
  );

  const tenancies = await db.query<{ tenancy_id: string }>(
    `SELECT tenancy_id FROM tenancy WHERE unit_id = ANY($1::uuid[])`,
    [unitIds],
  );
  const tenancyIds = tenancies.rows.map((row) => row.tenancy_id);

  const parties = await db.query<{ party_id: string }>(
    `SELECT DISTINCT party_id FROM tenancy_party WHERE tenancy_id = ANY($1::uuid[])`,
    [tenancyIds],
  );
  const partyIds = parties.rows.map((row) => row.party_id);

  const assets = await db.query<{ asset_id: string }>(
    `SELECT asset_id FROM asset WHERE space_id = ANY($1::uuid[])`,
    [spaceIds],
  );
  const assetIds = assets.rows.map((row) => row.asset_id);

  const obligations = await db.query<{ obligation_id: string }>(
    `SELECT obligation_id FROM obligation WHERE tenancy_id = ANY($1::uuid[])`,
    [tenancyIds],
  );
  const obligationIds = obligations.rows.map((row) => row.obligation_id);

  const documentIds = await documentIdsInBag(db, {
    kind: spec.kind,
    buildingId,
    unitIds,
    spaceIds,
    tenancyIds,
    assetIds,
    obligationIds,
  });

  const threads = await db.query<{ office_retrieval_thread_id: string }>(
    spec.kind === 'building'
      ? `SELECT office_retrieval_thread_id
           FROM office_retrieval_thread
          WHERE (bound_kind = 'building' AND bound_id = $1)
             OR (bound_kind = 'unit' AND bound_id = ANY($2::uuid[]))`
      : `SELECT office_retrieval_thread_id
           FROM office_retrieval_thread
          WHERE bound_kind = 'unit' AND bound_id = ANY($1::uuid[])`,
    spec.kind === 'building' ? [buildingId, unitIds] : [unitIds],
  );

  return {
    dropBuilding: spec.kind === 'building',
    buildingId,
    spaceIds,
    unitIds,
    tenancyIds,
    assetIds,
    obligationIds,
    documentIds,
    threadIds: threads.rows.map((row) => row.office_retrieval_thread_id),
    parkingIds,
    storageIds,
    partyIds,
  };
}

function emptyIds(): PlaceIds {
  return {
    dropBuilding: false,
    buildingId: null,
    spaceIds: [],
    unitIds: [],
    tenancyIds: [],
    assetIds: [],
    obligationIds: [],
    documentIds: [],
    threadIds: [],
    parkingIds: [],
    storageIds: [],
    partyIds: [],
  };
}

async function documentIdsInBag(
  db: Queryable,
  bag: {
    kind: EstatePurgeKind;
    buildingId: string | null;
    unitIds: string[];
    spaceIds: string[];
    tenancyIds: string[];
    assetIds: string[];
    obligationIds: string[];
  },
): Promise<string[]> {
  const { rows } = await db.query<{ document_id: string }>(
    `SELECT DISTINCT l.document_id
       FROM document_link l
      WHERE (
              (l.entity_type = 'UNIT' AND l.entity_id = ANY($1::uuid[]))
           OR (l.entity_type = 'SPACE' AND l.entity_id = ANY($2::uuid[]))
           OR (l.entity_type = 'TENANCY' AND l.entity_id = ANY($3::uuid[]))
           OR (l.entity_type = 'ASSET' AND l.entity_id = ANY($4::uuid[]))
           OR (l.entity_type = 'OBLIGATION' AND l.entity_id = ANY($5::uuid[]))
           OR ($6::text = 'building' AND l.entity_type = 'BUILDING' AND l.entity_id = $7)
            )
        AND NOT EXISTS (
              SELECT 1
                FROM document_link other
               WHERE other.document_id = l.document_id
                 AND other.entity_type = 'UNIT'
                 AND other.entity_id <> ALL($1::uuid[])
            )`,
    [
      bag.unitIds,
      bag.spaceIds,
      bag.tenancyIds,
      bag.assetIds,
      bag.obligationIds,
      bag.kind,
      bag.buildingId,
    ],
  );
  return rows.map((row) => row.document_id);
}

async function loadStorage(
  db: Queryable,
  documentIds: string[],
): Promise<{ uris: string[]; prefixes: string[] }> {
  if (documentIds.length === 0) {
    return { uris: [], prefixes: [] };
  }
  const { rows } = await db.query<{ storage_uri: string }>(
    `SELECT storage_uri FROM document WHERE document_id = ANY($1::uuid[])`,
    [documentIds],
  );
  const uris = rows.map((row) => row.storage_uri);
  const prefixes = unique(
    uris.map(objectPrefix).filter((value) => value.length > 0),
  );
  return { uris, prefixes };
}

function objectPrefix(uri: string): string {
  const match = /^gs:\/\/[^/]+\/(.+)\/[^/]+$/.exec(uri);
  return match?.[1] === undefined ? '' : `${match[1]}/`;
}

async function deleteBag(db: Queryable, ids: PlaceIds): Promise<void> {
  if (ids.threadIds.length > 0) {
    await db.query(
      `DELETE FROM office_retrieval_thread
        WHERE office_retrieval_thread_id = ANY($1::uuid[])`,
      [ids.threadIds],
    );
  }
  if (ids.obligationIds.length > 0) {
    await db.query(
      `DELETE FROM obligation WHERE obligation_id = ANY($1::uuid[])`,
      [ids.obligationIds],
    );
  }
  if (ids.tenancyIds.length > 0) {
    await db.query(
      `DELETE FROM tenancy_completeness_exception WHERE tenancy_id = ANY($1::uuid[])`,
      [ids.tenancyIds],
    );
    await db.query(
      `DELETE FROM tenancy_event WHERE tenancy_id = ANY($1::uuid[])`,
      [ids.tenancyIds],
    );
    await db.query(
      `DELETE FROM tenancy_party WHERE tenancy_id = ANY($1::uuid[])`,
      [ids.tenancyIds],
    );
    await db.query(`DELETE FROM tenancy WHERE tenancy_id = ANY($1::uuid[])`, [
      ids.tenancyIds,
    ]);
  }
  if (ids.assetIds.length > 0) {
    await db.query(
      `UPDATE asset
          SET last_certificate_document_id = NULL, source_document_id = NULL
        WHERE asset_id = ANY($1::uuid[])`,
      [ids.assetIds],
    );
    await db.query(`DELETE FROM asset WHERE asset_id = ANY($1::uuid[])`, [
      ids.assetIds,
    ]);
  }
  if (ids.documentIds.length > 0) {
    await db.query(
      `DELETE FROM document_link WHERE document_id = ANY($1::uuid[])`,
      [ids.documentIds],
    );
    await db.query(`DELETE FROM document WHERE document_id = ANY($1::uuid[])`, [
      ids.documentIds,
    ]);
  }
  if (ids.unitIds.length > 0) {
    await db.query(
      `UPDATE unit
          SET parking_space_id = NULL, storage_space_id = NULL
        WHERE unit_id = ANY($1::uuid[])`,
      [ids.unitIds],
    );
    await db.query(`DELETE FROM unit WHERE unit_id = ANY($1::uuid[])`, [
      ids.unitIds,
    ]);
  }
  const spacesToDrop = unique([
    ...ids.spaceIds,
    ...ids.parkingIds,
    ...ids.storageIds,
  ]);
  if (spacesToDrop.length > 0) {
    await db.query(`DELETE FROM space WHERE space_id = ANY($1::uuid[])`, [
      spacesToDrop,
    ]);
  }
  if (ids.dropBuilding && ids.buildingId !== null) {
    await db.query(`DELETE FROM space WHERE building_id = $1`, [
      ids.buildingId,
    ]);
    await db.query(`DELETE FROM building WHERE building_id = $1`, [
      ids.buildingId,
    ]);
  }
}

async function deleteOrphanParties(
  db: Queryable,
  partyIds: string[],
): Promise<number> {
  if (partyIds.length === 0) return 0;
  const { rows } = await db.query<{ party_id: string }>(
    `SELECT p.party_id
       FROM party p
      WHERE p.party_id = ANY($1::uuid[])
        AND NOT EXISTS (
              SELECT 1 FROM tenancy_party tp WHERE tp.party_id = p.party_id
            )`,
    [partyIds],
  );
  const orphans = rows.map((row) => row.party_id);
  if (orphans.length === 0) return 0;
  await db.query(`DELETE FROM party_contact WHERE party_id = ANY($1::uuid[])`, [
    orphans,
  ]);
  await db.query(`DELETE FROM party WHERE party_id = ANY($1::uuid[])`, [
    orphans,
  ]);
  return orphans.length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
