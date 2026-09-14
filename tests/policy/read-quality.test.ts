// **No row is approved in bulk on a signal this system does not have.** Slice 7.3.
//
// `אישור כל מה שלא סומן` exists because approve-all would become a reflex within a week on a
// fourteen-page lease whose rows are mostly above 90%, and the per-field accuracy dataset would be
// worthless from that day. The control is only worth the screen space if the *unflagged* set is
// honest, and the number it is computed from is not what its name suggests:
//
//   - `extracted_field.confidence` is the **minimum OCR word confidence** of the words the reader
//     pointed at (`min()` in `internal/extract.ts`), never the model's confidence in the mapping.
//     The extraction schema deliberately refuses a model-supplied one.
//   - `src/kernel/pdf.ts` gives every native-text word `confidence: null`, and that `min()` turns any
//     null into a null field — so **every field of every digitally-produced lease has no confidence
//     at all**. A predicate that treats null as passing lets one press approve a whole document on
//     no signal whatsoever, which is the exact failure this control was drawn to prevent.
//
// **Why it is in tests/policy/ and not beside the module.** docs/pipeline.md §6 is the gate for
// everything no model may decide. Which readings a person is allowed to wave through without looking
// is not a judgement call: it is a deterministic rule about a number, and it governs the integrity of
// the measurement the whole track exists to produce.
//
// **Red first**, and it stays red-able: it builds the rows itself in a transaction that is rolled
// back, and asserts against `READ_QUALITY_THRESHOLD` — the guard's own constant, never a second copy
// of `0.8`, because a case carrying its own number goes green after somebody moves the real one.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import {
  approveUnflagged,
  ingestDocument,
  isFlagged,
  listExtractedFields,
  READ_QUALITY_THRESHOLD,
  upsertDocumentType,
  upsertDocumentTypeField,
} from '../../src/evidence/contract.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-15T09:00:00.000Z');
const ON = '2026-09-15';
const CLOCK = fixedClock(AT);

// This suite's own `type_key` block. `node --test` runs files in parallel against one database and
// `type_key` is UNIQUE, so two suites seeding one key wait on each other's speculative insertion —
// the 40P01 slice 2.4 met. Rows roll back either way; the block stops the collision happening.
const BLOCK = 't73';
let sequence = 0;

/** A document of a type of its own, and one declaration to hang readings on. */
async function seedDocument(
  db: PoolClient,
): Promise<{ documentId: string; documentTypeFieldId: string }> {
  sequence += 1;
  const type = await upsertDocumentType(db, {
    typeKey: `${BLOCK}-lease-${sequence}`,
    labelHe: 'חוזה שכירות',
    labelEn: 'Lease',
    verificationTerms: ['המושכר'],
    isActive: true,
  });
  const field = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'tenant_name',
    labelHe: 'שם השוכר',
    valueType: 'TEXT',
    isRequired: true,
    extractionHint: 'השוכר',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-policy-read-quality/buildings/${newId()}/${hash}.pdf`,
      fileHash: hash,
      driveFileId: null,
      validFrom: null,
      validTo: null,
      verificationVerdict: 'verified',
    },
    AT,
  );
  return { documentId: document.id, documentTypeFieldId: field.id };
}

/** One reading, at a stated read quality. `null` is what a native-text PDF produces. */
async function readValue(
  db: PoolClient,
  seeded: { documentId: string; documentTypeFieldId: string },
  value: string,
  confidence: number | null,
): Promise<string> {
  const id = newId(CLOCK);
  await db.query(
    `INSERT INTO extracted_field (
       extracted_field_id, document_id, document_type_field_id, value,
       page, bbox, confidence, model, extracted_at
     ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, 'policy-fixture', $7)`,
    [
      id,
      seeded.documentId,
      seeded.documentTypeFieldId,
      value,
      JSON.stringify({ x: 1, y: 1, width: 10, height: 4 }),
      confidence,
      AT,
    ],
  );
  return id;
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a bulk approval is never given on an absent signal', () => {
  it('flags a reading with no measured quality, and one below the threshold', (t) => {
    // The predicate alone, before any row exists. `null` is not a high score and it is not a low
    // one — it is the absence of the measurement, and the only safe reading of an absent measurement
    // is that a person has to look.
    assert.equal(isFlagged(null), true, 'null is not "confident"');
    assert.equal(isFlagged(READ_QUALITY_THRESHOLD - 0.01), true);
    assert.equal(
      isFlagged(READ_QUALITY_THRESHOLD),
      false,
      'the cut is inclusive',
    );
    assert.equal(isFlagged(0.96), false);
    t.diagnostic(`threshold ${String(READ_QUALITY_THRESHOLD)}`);
  });

  it('approves the measured, legible row and leaves the other two alone', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const seeded = await seedDocument(db);
      const legible = await readValue(db, seeded, 'אבי כהן', 0.96);
      const faint = await readValue(db, seeded, 'דנה כהן', 0.71);
      const unmeasured = await readValue(db, seeded, 'יוסי לוי', null);

      const result = await approveUnflagged(
        { db, audit: createAuditLog(db, CLOCK), clock: CLOCK },
        { documentId: seeded.documentId, approvedBy: 'policy@example.test' },
      );

      assert.equal(result.approved, 1, 'exactly one row was unflagged');
      assert.equal(result.flagged, 2);

      const rows = await listExtractedFields(db, seeded.documentId);
      const stamped = new Map(
        rows.map((row) => [row.extractedFieldId, row.approvedAt !== null]),
      );
      assert.equal(stamped.get(legible), true, 'the legible row was approved');
      assert.equal(
        stamped.get(unmeasured),
        false,
        'a row with no measured read quality was approved in bulk',
      );
      assert.equal(
        stamped.get(faint),
        false,
        'a row below the threshold was approved in bulk',
      );
    });
  });
});
