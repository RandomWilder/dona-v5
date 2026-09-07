// Flow A6, end to end: file a protocol, confirm the proposal, estate rows appear.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  applyDocumentTypeCatalogue,
  confirmProtocol,
  fileDocument,
  type IntakeDeps,
  proposeProtocol,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const BUCKET = 'dona-v5-test-docs';
const AT = new Date('2026-09-07T09:00:00.000Z');

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

async function insertUnit(db: PoolClient): Promise<{
  buildingId: string;
  unitId: string;
}> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'seed-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Seed ${buildingId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 12')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'COMMON', 'לובי')`,
    [newId(), buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '12', 3.5, true, 'READY')`,
    [unitId],
  );
  return { buildingId, unitId };
}

function intake(db: PoolClient, text: string): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText([text]),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
  };
}

describe('evidence · flow A6 confirms a protocol into estate', () => {
  it('dates the unit and writes its appliances', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const { unitId } = await insertUnit(db);
        const deps = intake(db, specimen('handover-protocol.md'));
        const filed = await fileDocument(deps, {
          bytes: pdfBytes('unit-protocol'),
          typeKey: 'handover_protocol',
          place: { kind: 'UNIT', id: unitId },
          tenancyId: null,
        });
        assert.equal(filed.filed, true);
        if (!filed.filed) return;

        const proposed = await proposeProtocol(
          {
            db,
            objects: deps.objects,
            pdf: deps.pdf,
            bucket: BUCKET,
          },
          filed.documentId,
        );
        assert.equal(proposed.proposal.handoverDate, '2024-06-01');
        assert.ok(proposed.proposal.assets.length > 0);

        const confirmed = await confirmProtocol(
          {
            db,
            objects: deps.objects,
            pdf: deps.pdf,
            bucket: BUCKET,
          },
          filed.documentId,
        );
        assert.equal(confirmed.warrantyEndDate, '2026-06-01');
        assert.equal(confirmed.alreadySeeded, false);
        assert.ok(confirmed.assetsWritten > 0);

        const unit = await db.query<{ warranty_end_date: string }>(
          `SELECT warranty_end_date::text AS warranty_end_date FROM unit WHERE unit_id = $1`,
          [unitId],
        );
        assert.equal(unit.rows[0]?.warranty_end_date, '2026-06-01');

        const assets = await db.query<{ asset_type: string }>(
          `SELECT asset_type FROM asset WHERE space_id = $1 ORDER BY asset_type`,
          [unitId],
        );
        assert.ok(assets.rows.some((row) => row.asset_type === 'WATER_HEATER'));
        assert.ok(assets.rows.some((row) => row.asset_type === 'AC'));

        const again = await confirmProtocol(
          {
            db,
            objects: deps.objects,
            pdf: deps.pdf,
            bucket: BUCKET,
          },
          filed.documentId,
        );
        assert.equal(again.alreadySeeded, true);
        assert.equal(again.assetsWritten, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('corrects the building’s placeholder handover date', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const { buildingId } = await insertUnit(db);
        const deps = intake(db, specimen('building-handover-protocol.md'));
        const filed = await fileDocument(deps, {
          bytes: pdfBytes('building-protocol'),
          typeKey: 'building_handover_protocol',
          place: { kind: 'BUILDING', id: buildingId },
          tenancyId: null,
        });
        assert.equal(filed.filed, true);
        if (!filed.filed) return;

        const confirmed = await confirmProtocol(
          {
            db,
            objects: deps.objects,
            pdf: deps.pdf,
            bucket: BUCKET,
          },
          filed.documentId,
        );
        assert.equal(confirmed.warrantyEndDate, '2026-03-01');

        const building = await db.query<{
          handover_date: string;
          warranty_end_date: string;
        }>(
          `SELECT handover_date::text AS handover_date,
                  warranty_end_date::text AS warranty_end_date
             FROM building WHERE building_id = $1`,
          [buildingId],
        );
        assert.equal(building.rows[0]?.handover_date, '2024-03-01');
        assert.equal(building.rows[0]?.warranty_end_date, '2026-03-01');
      });
    } finally {
      await pool.end();
    }
  });
});
