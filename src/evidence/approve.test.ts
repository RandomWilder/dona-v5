// Slice 7.3. Approval: a person signs a reading, and the reading itself is never overwritten.
//
// The suite files a real lease through `fileDocument` — the same path 4.3's promote suite uses —
// because what is under test is a stamp on rows the extractor actually wrote, and a hand-built row
// would prove this file and that file agree rather than proving the command works.
//
// Read quality is set by hand after filing. `confidence` is not written by the approval path and has
// no trigger on it; the fake reader gives every word the same score, and a fixture whose rows are all
// equally legible cannot exercise a threshold.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import type { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { upsertTenancy, upsertTermsProfile } from '../tenancy/contract.ts';
import type { ExtractedRow, IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  approveExtractedField,
  approveUnflagged,
  fileDocument,
  listExtractedFields,
  promoteExtractedField,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-15T09:00:00.000Z');
const CLOCK = fixedClock(AT);
const BUCKET = 'dona-v5-test-approve';
const MARKERS = 'חוזה שכירות המושכר תקופת השכירות השוכר';
const SIGNER = 'approve@example.test';

const deps = (db: PoolClient) => ({
  db,
  audit: createAuditLog(db, CLOCK),
  clock: CLOCK,
});

async function insertUnit(db: PoolClient): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'approve-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Approve ${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 24')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '24', 3, true, 'READY')`,
    [unitId],
  );
  return unitId;
}

/** A filed lease with four readings on it, and a letting for the dates to be promoted onto. */
async function fileLease(
  db: PoolClient,
  marker: string,
): Promise<{ documentId: string; tenancyId: string; unitId: string }> {
  await applyDocumentTypeCatalogue(db, seedDocumentTypes);
  const unitId = await insertUnit(db);
  const profile = await upsertTermsProfile(db, `approve-${unitId.slice(24)}`);
  const tenancy = await upsertTenancy(db, {
    unitId,
    startDate: '2025-01-01',
    endDate: '2026-12-31',
    status: 'ACTIVE',
    termsProfileId: profile.id,
    noticeDate: null,
    actualMoveOut: null,
  });
  const filed = await fileDocument(
    {
      db,
      objects: createMemoryStore(),
      pdf: createFakePdfText([MARKERS]),
      audit: createAuditLog(db, CLOCK),
      clock: CLOCK,
      bucket: BUCKET,
      extractor: createFakeExtractor(() => ({
        findings: [
          { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
          { field_key: 'tenant_name', value: 'אבי כהן', word_ids: [1] },
          { field_key: 'apartment_number', value: '24', word_ids: [2] },
          { field_key: 'tenant_id_number', value: '123456782', word_ids: [3] },
        ],
      })),
      extractModel: 'gpt-test',
    } satisfies IntakeDeps,
    {
      bytes: Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1'),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: unitId },
      tenancyId: tenancy.id,
    },
  );
  assert.equal(filed.filed, true);
  if (!filed.filed) throw new Error('unreachable');
  return { documentId: filed.documentId, tenancyId: tenancy.id, unitId };
}

/** Read quality, set per field so the threshold has something to cut. */
async function setQuality(
  db: PoolClient,
  documentId: string,
  quality: Record<string, number | null>,
): Promise<void> {
  for (const [fieldKey, confidence] of Object.entries(quality)) {
    await db.query(
      `UPDATE extracted_field e
          SET confidence = $3
         FROM document_type_field f
        WHERE f.document_type_field_id = e.document_type_field_id
          AND e.document_id = $1 AND f.field_key = $2`,
      [documentId, fieldKey, confidence],
    );
  }
}

const by = (rows: readonly ExtractedRow[], fieldKey: string): ExtractedRow => {
  const row = rows.find((candidate) => candidate.fieldKey === fieldKey);
  assert.ok(row, `no reading for ${fieldKey}`);
  return row;
};

describe('evidence · approve a reading', () => {
  it('signs it as read, and refuses the second signature', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { documentId } = await fileLease(db, 'approve-once');
        const start = by(
          await listExtractedFields(db, documentId),
          'start_date',
        );

        const result = await approveExtractedField(deps(db), {
          extractedFieldId: start.extractedFieldId,
          approvedBy: SIGNER,
          mayReadIdentifiers: false,
        });
        assert.equal(result.edited, false);

        const stamped = by(
          await listExtractedFields(db, documentId),
          'start_date',
        );
        assert.equal(stamped.value, '2026-03-01');
        assert.equal(stamped.approvedValue, '2026-03-01');
        assert.equal(stamped.approvedBy, SIGNER);
        assert.equal(stamped.approvedAt?.toISOString(), AT.toISOString());

        // An approval is a signature at a moment, not a field that can be edited.
        await assert.rejects(
          () =>
            approveExtractedField(deps(db), {
              extractedFieldId: start.extractedFieldId,
              approvedBy: SIGNER,
              mayReadIdentifiers: false,
            }),
          (error: KernelError) => error.code === 'conflict',
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('writes a correction beside the reading and never over it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { documentId } = await fileLease(db, 'approve-edit');
        const name = by(
          await listExtractedFields(db, documentId),
          'tenant_name',
        );

        const result = await approveExtractedField(deps(db), {
          extractedFieldId: name.extractedFieldId,
          approvedValue: 'אבי לוי',
          approvedBy: SIGNER,
          mayReadIdentifiers: false,
        });
        assert.equal(result.edited, true);

        // **The dataset.** The reader said one thing, the person signed another, and the row holds
        // both — which is the whole reason this slice adds a column instead of an UPDATE.
        const stamped = by(
          await listExtractedFields(db, documentId),
          'tenant_name',
        );
        assert.equal(stamped.value, 'אבי כהן');
        assert.equal(stamped.approvedValue, 'אבי לוי');

        const line = await db.query<{ inputs: { edited: boolean } }>(
          `SELECT inputs FROM audit_log
            WHERE action = 'evidence.approve_field' AND subject_id = $1`,
          [name.extractedFieldId],
        );
        assert.equal(line.rows.length, 1);
        assert.equal(line.rows[0]?.inputs.edited, true);
        // PII never reaches a log, and a line carrying the correction would defeat what it records.
        assert.equal(
          JSON.stringify(line.rows[0]?.inputs).includes('לוי'),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('approves in bulk only what was measured and legible', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { documentId } = await fileLease(db, 'approve-bulk');
        await setQuality(db, documentId, {
          start_date: 0.96,
          tenant_name: 0.71,
          apartment_number: null,
          tenant_id_number: 0.91,
        });

        const result = await approveUnflagged(deps(db), {
          documentId,
          approvedBy: SIGNER,
        });
        assert.equal(result.approved, 1);
        assert.equal(result.flagged, 3);

        const rows = await listExtractedFields(db, documentId);
        assert.notEqual(by(rows, 'start_date').approvedAt, null);
        // 91% and never in the set: a ת.ז. does not reach a screen until somebody asks for it by
        // name, so bulk-approving one would sign a value the signer has not been shown.
        assert.equal(by(rows, 'tenant_id_number').approvedAt, null);
        assert.equal(by(rows, 'tenant_name').approvedAt, null, 'below the cut');
        assert.equal(
          by(rows, 'apartment_number').approvedAt,
          null,
          'no read quality at all is not a high read quality',
        );

        // A second press has nothing left to sign and refuses nothing.
        const again = await approveUnflagged(deps(db), {
          documentId,
          approvedBy: SIGNER,
        });
        assert.equal(again.approved, 0);
        assert.equal(again.flagged, 3);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses to let a viewer sign a reading that is withheld from them', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { documentId } = await fileLease(db, 'approve-identifier');
        await setQuality(db, documentId, {
          start_date: 0.96,
          tenant_name: 0.96,
          apartment_number: 0.96,
          tenant_id_number: 0.96,
        });
        const rows = await listExtractedFields(db, documentId);

        // Approving is an attestation. A stamp from somebody who was never shown the value is a
        // false record in the one dataset this command exists to produce.
        await assert.rejects(
          () =>
            approveExtractedField(deps(db), {
              extractedFieldId: by(rows, 'tenant_id_number').extractedFieldId,
              approvedBy: SIGNER,
              mayReadIdentifiers: false,
            }),
          (error: KernelError) => error.code === 'not_allowed',
        );

        const bulk = await approveUnflagged(deps(db), {
          documentId,
          approvedBy: SIGNER,
        });
        assert.equal(bulk.approved, 3, 'the three ordinary rows');
        assert.equal(
          bulk.flagged,
          1,
          'the identifier is left to be revealed and signed on its own',
        );
        const after = await listExtractedFields(db, documentId);
        assert.equal(by(after, 'tenant_id_number').approvedAt, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('promotes the value a person signed, not the one the reader produced', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { documentId, tenancyId } = await fileLease(
          db,
          'approve-promote',
        );
        const start = by(
          await listExtractedFields(db, documentId),
          'start_date',
        );

        await approveExtractedField(deps(db), {
          extractedFieldId: start.extractedFieldId,
          approvedValue: '2026-04-01',
          approvedBy: SIGNER,
          mayReadIdentifiers: false,
        });
        const promoted = await promoteExtractedField(deps(db), {
          extractedFieldId: start.extractedFieldId,
          promotedBy: SIGNER,
        });
        assert.equal(promoted.value, '2026-04-01');

        const tenancy = await db.query<{ start_date: string }>(
          'SELECT start_date::text FROM tenancy WHERE tenancy_id = $1',
          [tenancyId],
        );
        assert.equal(tenancy.rows[0]?.start_date, '2026-04-01');
        // And the reader's own answer is still on the row, still wrong, still measurable.
        assert.equal(
          by(await listExtractedFields(db, documentId), 'start_date').value,
          '2026-03-01',
        );
      });
    } finally {
      await pool.end();
    }
  });
});
