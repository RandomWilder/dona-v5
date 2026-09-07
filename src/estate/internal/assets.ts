// Asset writes. Slice 3.5, E11 and the E14 stub, and the write half of flow A6.
//
// Evidence owns the reader and the confirm screen; this file owns the rows, because Asset is
// estate's table and a document module that updated building.handover_date would be writing
// through the wall (SPEC-flows.md A6).
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED } from '../../kernel/upsert.ts';
import type {
  AssetClass,
  AssetPlan,
  AssetType,
  ProviderPlan,
  Queryable,
} from './plan.ts';

/** תקופת הבדק as this fixture has always shown it: two calendar years from handover. */
export const WARRANTY_YEARS = 2;

export function addCalendarYears(isoDate: string, years: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new KernelError('invalid', 'handover date is not an iso date', {
      isoDate,
    });
  }
  const year = Number(match[1]) + years;
  return `${String(year).padStart(4, '0')}-${match[2]}-${match[3]}`;
}

export async function upsertProvider(
  db: Queryable,
  provider: ProviderPlan,
): Promise<{ providerId: string; inserted: boolean }> {
  const result = await db.query<{ provider_id: string; inserted: boolean }>(
    `INSERT INTO provider (provider_id, name, provider_kind)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE
       SET provider_kind = EXCLUDED.provider_kind
     RETURNING provider_id, ${INSERTED}`,
    [newId(), provider.name, provider.kind],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'provider upsert returned no row', {
      name: provider.name,
    });
  }
  return { providerId: row.provider_id, inserted: row.inserted };
}

export async function upsertAsset(
  db: Queryable,
  spaceId: string,
  asset: AssetPlan,
  extras: {
    warrantyProviderId: string | null;
    sourceDocumentId: string | null;
  },
): Promise<boolean> {
  const result = await db.query<{ inserted: boolean }>(
    `INSERT INTO asset (asset_id, space_id, asset_class, asset_type, make_model, serial_no,
                        installed_date, warranty_end_date, warranty_provider_id,
                        compliance_regime, next_inspection_due, last_certificate_document_id,
                        source_document_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13)
     ON CONFLICT (space_id, asset_type) DO UPDATE
       SET asset_class = EXCLUDED.asset_class,
           make_model = EXCLUDED.make_model,
           serial_no = EXCLUDED.serial_no,
           installed_date = EXCLUDED.installed_date,
           warranty_end_date = EXCLUDED.warranty_end_date,
           warranty_provider_id = EXCLUDED.warranty_provider_id,
           compliance_regime = EXCLUDED.compliance_regime,
           next_inspection_due = EXCLUDED.next_inspection_due,
           source_document_id = COALESCE(EXCLUDED.source_document_id, asset.source_document_id),
           status = EXCLUDED.status
     RETURNING ${INSERTED}`,
    [
      newId(),
      spaceId,
      asset.assetClass,
      asset.assetType,
      asset.makeModel,
      asset.serialNo,
      asset.installedDate,
      asset.warrantyEndDate,
      extras.warrantyProviderId,
      asset.complianceRegime,
      asset.nextInspectionDue,
      extras.sourceDocumentId,
      asset.status,
    ],
  );
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) {
    throw new KernelError('conflict', 'asset upsert returned no row', {
      assetType: asset.assetType,
    });
  }
  return inserted;
}

export interface ProposedAsset {
  assetClass: AssetClass;
  assetType: AssetType;
}

export interface ProtocolSeed {
  kind: 'unit' | 'building';
  /** The UNIT space, or the building. */
  targetId: string;
  handoverDate: string;
  assets: readonly ProposedAsset[];
  sourceDocumentId: string;
}

export interface ProtocolSeedResult {
  warrantyEndDate: string;
  assetsWritten: number;
  alreadySeeded: boolean;
}

async function firstCommonSpace(
  db: Queryable,
  buildingId: string,
): Promise<string | null> {
  const result = await db.query<{ space_id: string }>(
    `SELECT space_id FROM space
      WHERE building_id = $1 AND space_kind = 'COMMON'
      ORDER BY name
      LIMIT 1`,
    [buildingId],
  );
  return result.rows[0]?.space_id ?? null;
}

/**
 * Writes the confirmed proposal. Idempotent on the assets of this document: a second confirm
 * restates the dates and does not create a second water heater.
 */
export async function applyProtocolSeed(
  db: Queryable,
  seed: ProtocolSeed,
): Promise<ProtocolSeedResult> {
  const warrantyEndDate = addCalendarYears(seed.handoverDate, WARRANTY_YEARS);

  if (seed.kind === 'unit') {
    const updated = await db.query(
      `UPDATE unit SET warranty_end_date = $1 WHERE unit_id = $2`,
      [warrantyEndDate, seed.targetId],
    );
    if (updated.rowCount === 0) {
      throw new KernelError('not_found', 'unit not found');
    }
  } else {
    const updated = await db.query(
      `UPDATE building
          SET handover_date = $1, warranty_end_date = $2
        WHERE building_id = $3`,
      [seed.handoverDate, warrantyEndDate, seed.targetId],
    );
    if (updated.rowCount === 0) {
      throw new KernelError('not_found', 'building not found');
    }
  }

  const existing = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM asset WHERE source_document_id = $1`,
    [seed.sourceDocumentId],
  );
  const alreadySeeded = Number(existing.rows[0]?.n ?? '0') > 0;
  if (alreadySeeded) {
    return { warrantyEndDate, assetsWritten: 0, alreadySeeded: true };
  }

  let spaceId: string | null = seed.kind === 'unit' ? seed.targetId : null;
  if (seed.kind === 'building') {
    spaceId = await firstCommonSpace(db, seed.targetId);
  }
  if (!spaceId) {
    return { warrantyEndDate, assetsWritten: 0, alreadySeeded: false };
  }

  let assetsWritten = 0;
  for (const proposed of seed.assets) {
    const inserted = await upsertAsset(
      db,
      spaceId,
      {
        spaceKind: seed.kind === 'unit' ? 'UNIT' : 'COMMON',
        spaceName: '',
        assetClass: proposed.assetClass,
        assetType: proposed.assetType,
        makeModel: null,
        serialNo: null,
        installedDate: seed.handoverDate,
        warrantyEndDate,
        warrantyProviderName: null,
        complianceRegime:
          proposed.assetClass === 'SAFETY' ? 'PERIODIC_INSPECTION' : 'NONE',
        nextInspectionDue: null,
        status: 'IN_SERVICE',
      },
      { warrantyProviderId: null, sourceDocumentId: seed.sourceDocumentId },
    );
    if (inserted) assetsWritten += 1;
  }
  return { warrantyEndDate, assetsWritten, alreadySeeded: false };
}
