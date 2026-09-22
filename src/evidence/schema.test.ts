// Contract tests for E12, E13, E15 and E16 — the evidence plane. Slice 3.1.
//
// These assert against a real Postgres, through the DDL in src/kernel/migrations/0011_evidence.sql,
// because every claim here is a claim about what the database refuses. An application-level check
// would prove that this file and that file agree, which is not the constraint (1.9's note, and 2.1's
// after it).
//
// The column lists are the workbook's FIELDS sheet (docs/model/, E12–E13 and E15–E16). A migration
// that drifts from it turns this suite red, which is the point: the workbook is a specification, and
// a specification nothing reads is a description.
//
// **Every rejection below was proved red first** against the same DDL with its constraint removed,
// with the SQLSTATE recorded in tasks/evidence/3.1.md. A constraint test that has never been red
// asserts what the code already did (docs/pipeline.md §10).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  applyDocumentTypeCatalogue,
  declareDocumentTypeField,
  documentTypeFields,
  ingestDocument,
  linkDocument,
  listDocumentTypes,
  retireDocumentTypeField,
  upsertDocumentType,
  upsertDocumentTypeField,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

// Postgres SQLSTATEs. Asserting the class and not merely "it threw" is what stops a typo in a
// fixture from reading as a constraint doing its job.
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
// Raised by the `document_is_immutable` trigger. `restrict_violation` is the closest standard class
// to "this row may not be changed", and naming a class rather than the default P0001 is what lets a
// caller distinguish the rule from any other RAISE somebody adds later.
const RESTRICT_VIOLATION = '23001';

// The clock, fixed. `ingested_at` is supplied by the caller (SPEC.md: no DEFAULT now(), no
// Date.now() in logic), so these tests pass a date rather than reading one.
const INGESTED_AT = new Date('2026-09-07T09:00:00.000Z');
const TODAY = '2026-09-07';

/**
 * Asserts the statement is rejected with a named SQLSTATE, and leaves the transaction usable.
 *
 * A failed statement aborts the enclosing transaction, so every case making more than one assertion
 * after a rejection needs the savepoint — without it the second assertion fails with 25P02 and says
 * nothing about the constraint it was written for. Lifted verbatim in shape from
 * src/parties/schema.test.ts, which is where this pattern was worked out at 2.1.
 */
async function rejects(
  db: PoolClient,
  sqlstate: string,
  statement: () => Promise<unknown>,
): Promise<void> {
  await db.query('SAVEPOINT attempt');
  try {
    await statement();
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    assert.fail(`expected SQLSTATE ${sqlstate}, but the statement succeeded`);
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    const code = (error as { code?: string }).code;
    assert.equal(
      code,
      sqlstate,
      `expected SQLSTATE ${sqlstate}, got ${code ?? 'no code'}: ${(error as Error).message}`,
    );
  }
}

// Every fixture in this file uses a type_key block of its own. `node --test` runs files in parallel
// against one database and `type_key` is UNIQUE, so two suites seeding "lease" would each wait on
// the other's speculative insertion — the 40P01 slice 2.4 met and 2.6 traced to a shared phone
// number. **This suite's block is `t31-`.** Rows are rolled back either way; the block is what stops
// the collision happening at all.
const BLOCK = 't31';
let sequence = 0;
function typeKey(name: string): string {
  sequence += 1;
  return `${BLOCK}-${name}-${sequence}`;
}

async function seedType(
  db: PoolClient,
  overrides: {
    isActive?: boolean;
    verificationTerms?: string[] | null;
    name?: string;
  } = {},
): Promise<string> {
  const result = await upsertDocumentType(db, {
    typeKey: typeKey(overrides.name ?? 'lease'),
    labelHe: 'חוזה שכירות',
    labelEn: 'Lease',
    verificationTerms: overrides.verificationTerms ?? ['המושכר'],
    isActive: overrides.isActive ?? true,
  });
  return result.id;
}

async function seedDocument(
  db: PoolClient,
  documentTypeId: string,
  fileHash: string,
): Promise<string> {
  const result = await ingestDocument(
    db,
    {
      documentTypeId,
      storageUri: `gs://dona-v5-docs/buildings/${newId()}/${fileHash}.pdf`,
      fileHash,
      driveFileId: null,
      validFrom: null,
      validTo: null,
      verificationVerdict: 'verified',
    },
    INGESTED_AT,
  );
  return result.id;
}

let pool: Pool | null = null;

before(async () => {
  pool = await migratedPoolOrNull();
});

after(async () => {
  await pool?.end();
});

describe('E15 · document_type — the catalogue (A8, R17)', () => {
  it('is keyed on type_key, so seeding twice creates once', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('arnona');
      const spec = {
        typeKey: key,
        labelHe: 'ארנונה',
        labelEn: 'Municipal tax bill',
        verificationTerms: ['ארנונה', 'המחזיק'],
        isActive: true,
      };
      const first = await upsertDocumentType(db, spec);
      const second = await upsertDocumentType(db, spec);

      assert.equal(first.inserted, true);
      assert.equal(second.inserted, false, 'the second seed must find the row');
      assert.equal(second.id, first.id, 'and must not mint a second id');
    });
  });

  it('carries the guard terms slice 3.3 reads, and they survive the round trip', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      // The whole reason `verification_terms` is a column and not a Record<TypeKey, string[]> in
      // TypeScript: 3.3's guard reads it off the row, so a type added as a seed row arrives with
      // its own guard rather than shipping unguarded until the next release (slice 3.0).
      await seedType(db, {
        name: 'guarded',
        verificationTerms: ['פרוטוקול מסירה', 'מצב המושכר'],
      });
      const types = await listDocumentTypes(db);
      const seeded = types.filter((row) => row.typeKey.startsWith(BLOCK));
      const guarded = seeded.find((row) => row.typeKey.includes('guarded'));
      assert.deepEqual(guarded?.verificationTerms, [
        'פרוטוקול מסירה',
        'מצב המושכר',
      ]);
    });
  });

  it('accepts a type with no guard terms — unguarded, not unfileable', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const id = await seedType(db, {
        name: 'unguarded',
        verificationTerms: null,
      });
      // The failure direction 3.0 chose on purpose, for a guard whose whole justification is that
      // it is cheap: a type nobody has written terms for is still a type documents can be filed
      // against.
      const found = await seedDocument(db, id, `${BLOCK}-unguarded-hash`);
      assert.ok(found);
    });
  });

  it('is deactivated, never deleted — and the database is what refuses', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const id = await seedType(db, { name: 'retired' });
      await seedDocument(db, id, `${BLOCK}-retired-hash`);

      // R16's rule, applied to R17's table. Deleting a type orphans every historical record that
      // used it — which is exactly the evidence a dispute reads. There is no delete on the
      // contract either, but that only stops people asking; this is what stops it happening.
      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        db.query('DELETE FROM document_type WHERE document_type_id = $1', [id]),
      );

      // Retiring it is the supported move, and a retired type keeps answering for the documents
      // filed under it while leaving the "file a document" list.
      await db.query(
        'UPDATE document_type SET is_active = false WHERE document_type_id = $1',
        [id],
      );
      const active = await listDocumentTypes(db, { activeOnly: true });
      const all = await listDocumentTypes(db, { activeOnly: false });
      assert.equal(
        active.some((row) => row.documentTypeId === id),
        false,
        'a retired type leaves the picker',
      );
      assert.equal(
        all.some((row) => row.documentTypeId === id),
        true,
        'and stays a row',
      );
    });
  });
});

describe('E16 · document_type_field — one version of a schema (A8, R18)', () => {
  it('redeclares a field as a new row and never as an edit', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'versioned' });
      const v1 = {
        documentTypeId,
        fieldKey: 'end_date',
        labelHe: 'סיום תקופת השכירות',
        valueType: 'DATE' as const,
        isRequired: true,
        extractionHint: 'תקופת השכירות',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      };
      const first = await upsertDocumentTypeField(db, v1);
      // The same declaration again is idempotent, so the seed can be re-run.
      const again = await upsertDocumentTypeField(db, v1);
      assert.equal(again.inserted, false);
      assert.equal(again.id, first.id);

      // A corrected declaration at a later date is a **different row**. This is what keeps a value
      // extracted in January explicable after the schema is corrected in July: the extracted value
      // points at the row that governed it, and that row still says what it said.
      const v2 = await upsertDocumentTypeField(db, {
        ...v1,
        labelHe: 'מועד סיום השכירות',
        extractionHint: 'תקופת השכירות המעודכנת',
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      });
      assert.equal(v2.inserted, true);
      assert.notEqual(v2.id, first.id);
    });
  });

  it('refuses two declarations of one field at one effective_from', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'dup' });
      await upsertDocumentTypeField(db, {
        documentTypeId,
        fieldKey: 'start_date',
        labelHe: 'תחילת תקופת השכירות',
        valueType: 'DATE',
        isRequired: true,
        extractionHint: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      });
      // The upsert path takes the conflict, so the raw insert is what exercises the key. Without
      // it, an admin correcting a hint would overwrite the declaration that governed every value
      // already extracted under it.
      await rejects(db, UNIQUE_VIOLATION, () =>
        db.query(
          `INSERT INTO document_type_field (document_type_field_id, document_type_id, field_key,
                                            label_he, value_type, is_required, extraction_hint,
                                            effective_from, effective_to)
           VALUES ($1, $2, 'start_date', 'אחר', 'DATE', true, null, '2026-01-01', null)`,
          [newId(), documentTypeId],
        ),
      );
    });
  });

  it('resolves the declaration governing a given day, and the date is a parameter', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('dated');
      const type = await upsertDocumentType(db, {
        typeKey: key,
        labelHe: 'חוזה שכירות',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      const shared = {
        documentTypeId: type.id,
        fieldKey: 'apartment_number',
        valueType: 'TEXT' as const,
        isRequired: true,
        extractionHint: null,
      };
      await upsertDocumentTypeField(db, {
        ...shared,
        labelHe: 'מספר דירה',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      });
      await upsertDocumentTypeField(db, {
        ...shared,
        labelHe: 'מספר הדירה',
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      });

      const inMarch = await documentTypeFields(db, key, '2026-03-15');
      const inAugust = await documentTypeFields(db, key, '2026-08-15');
      const before = await documentTypeFields(db, key, '2025-12-31');

      assert.equal(inMarch.length, 1);
      assert.equal(inMarch[0]?.labelHe, 'מספר דירה');
      assert.equal(inAugust.length, 1);
      assert.equal(inAugust[0]?.labelHe, 'מספר הדירה');
      assert.deepEqual(
        before,
        [],
        'a day before any declaration declares nothing',
      );
    });
  });

  it('refuses a value type outside the declared union', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'value-type' });
      // The CHECK is `FIELD_VALUE_TYPES` and nothing else, so a value type invented at the insert
      // is refused by the database rather than discovered on a read.
      //
      // **`MONEY` is still one of the refused ones**, and it is named here rather than left to the
      // general case because it is the member somebody reaches for first. It is absent for a
      // different reason than it used to be: not because foundation rule 2 forbade an amount —
      // ADR-0008 retired that — but because an amount is a `NUMBER` beside a `TEXT` currency and
      // has never needed a member of its own. The union did not move when the rule went.
      for (const invented of ['MONEY', 'DECIMAL']) {
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO document_type_field (document_type_field_id, document_type_id, field_key,
                                              label_he, value_type, is_required, effective_from)
             VALUES ($1, $2, 'rent_amount', 'דמי שכירות', $3, true, '2026-01-01')`,
            [newId(), documentTypeId, invented],
          ),
        );
      }
    });
  });

  it('refuses a declaration that closes before it opens', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'ordered' });
      await rejects(db, CHECK_VIOLATION, () =>
        upsertDocumentTypeField(db, {
          documentTypeId,
          fieldKey: 'start_date',
          labelHe: 'תחילת תקופת השכירות',
          valueType: 'DATE',
          isRequired: true,
          extractionHint: null,
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-01-01',
        }),
      );
    });
  });
});

describe('E12 · document — one file, hashed at ingest (R17)', () => {
  it('refuses a document whose type is not in the catalogue', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      // R17. The kind of a document is a row in a catalogue, and a document typed by nothing is a
      // document nothing can be extracted from.
      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        seedDocument(db, newId(), `${BLOCK}-orphan-hash`),
      );
    });
  });

  it('refuses a document with no type at all', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      await rejects(db, NOT_NULL_VIOLATION, () =>
        db.query(
          `INSERT INTO document (document_id, document_type_id, storage_uri, file_hash, ingested_at)
           VALUES ($1, null, 'gs://x/y', $2, $3)`,
          [newId(), `${BLOCK}-untyped-hash`, INGESTED_AT],
        ),
      );
    });
  });

  it('records how many pages were read of how many', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'pages-read' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-pages-read-hash`,
      );
      await db.query(
        `UPDATE document SET page_count = 21, pages_read = 15 WHERE document_id = $1`,
        [documentId],
      );
      const row = await db.query<{ page_count: number; pages_read: number }>(
        `SELECT page_count, pages_read FROM document WHERE document_id = $1`,
        [documentId],
      );
      assert.equal(row.rows[0]?.page_count, 21);
      assert.equal(row.rows[0]?.pages_read, 15);
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `UPDATE document SET page_count = 10, pages_read = 15 WHERE document_id = $1`,
          [documentId],
        ),
      );
    });
  });

  it('keeps file_hash and storage_uri immutable after ingest', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'immutable' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-immutable-hash`,
      );

      // A hash that can be updated is a hash that proves nothing: the value of the column is that
      // the row cannot later be made to describe a different file. `storage_uri` travels with it,
      // because repointing the URI achieves the same substitution without touching the hash.
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query('UPDATE document SET file_hash = $2 WHERE document_id = $1', [
          documentId,
          `${BLOCK}-substituted-hash`,
        ]),
      );
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query(
          'UPDATE document SET storage_uri = $2 WHERE document_id = $1',
          [documentId, 'gs://somewhere-else/other.pdf'],
        ),
      );

      // The rest of the row is not frozen: a document re-filed with a corrected validity window is
      // the same evidence, better described.
      await db.query(
        'UPDATE document SET valid_to = $2 WHERE document_id = $1',
        [documentId, '2027-01-01'],
      );
    });
  });

  it('names the uploader when one is supplied, and keeps the first on conflict', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const { addOperator } = await import('../staff/contract.ts');
      const { fixedClock } = await import('../kernel/clock.ts');
      const clock = fixedClock(INGESTED_AT);
      const first = await addOperator(db, clock, {
        email: `first-${BLOCK}@evidence.test`,
        role: 'OPERATOR',
      });
      const second = await addOperator(db, clock, {
        email: `second-${BLOCK}@evidence.test`,
        role: 'OPERATOR',
      });
      const documentTypeId = await seedType(db, { name: 'uploader' });
      const fileHash = `${BLOCK}-uploader-hash`;
      const one = await ingestDocument(
        db,
        {
          documentTypeId,
          storageUri: `gs://dona-v5-docs/buildings/${newId()}/${fileHash}.pdf`,
          fileHash,
          driveFileId: null,
          validFrom: null,
          validTo: null,
          verificationVerdict: 'verified',
          uploadedBy: first.account.staffAccountId,
        },
        INGESTED_AT,
      );
      const two = await ingestDocument(
        db,
        {
          documentTypeId,
          storageUri: `gs://dona-v5-docs/buildings/${newId()}/${fileHash}.pdf`,
          fileHash,
          driveFileId: null,
          validFrom: null,
          validTo: null,
          verificationVerdict: 'verified',
          uploadedBy: second.account.staffAccountId,
        },
        INGESTED_AT,
      );
      assert.equal(two.id, one.id);
      const row = await db.query<{ uploaded_by: string | null }>(
        'SELECT uploaded_by FROM document WHERE document_id = $1',
        [one.id],
      );
      assert.equal(row.rows[0]?.uploaded_by, first.account.staffAccountId);
    });
  });

  it('accepts a document with no uploader, and refuses an unknown staff id', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'no-uploader' });
      const id = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-no-uploader-hash`,
      );
      const row = await db.query<{ uploaded_by: string | null }>(
        'SELECT uploaded_by FROM document WHERE document_id = $1',
        [id],
      );
      assert.equal(row.rows[0]?.uploaded_by, null);
      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        db.query(
          'UPDATE document SET uploaded_by = $2 WHERE document_id = $1',
          [id, newId()],
        ),
      );
    });
  });

  it('refuses a stored verdict that is not one of the three filed outcomes', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'verdict' });
      // `refused` is a door outcome and never a row (3.3). Figure 5's REJECTED is the review
      // queue and is still not a column. The CHECK is what makes both of those statements true
      // of every list, not of the caller.
      for (const verdict of ['refused', 'REJECTED', 'state']) {
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO document (document_id, document_type_id, storage_uri, file_hash,
                                   ingested_at, verification_verdict)
             VALUES ($1, $2, 'gs://x/y.pdf', $3, $4, $5)`,
            [
              newId(),
              documentTypeId,
              `${BLOCK}-verdict-${verdict}-hash`,
              INGESTED_AT,
              verdict,
            ],
          ),
        );
      }
    });
  });

  it('refuses a document with no verification verdict', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'no-verdict' });
      await rejects(db, NOT_NULL_VIOLATION, () =>
        db.query(
          `INSERT INTO document (document_id, document_type_id, storage_uri, file_hash, ingested_at)
           VALUES ($1, $2, 'gs://x/y.pdf', $3, $4)`,
          [newId(), documentTypeId, `${BLOCK}-no-verdict-hash`, INGESTED_AT],
        ),
      );
    });
  });

  it('lets a verdict change after ingest, because OCR is not a rewrite of the file', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'ocr-later' });
      const filed = await ingestDocument(
        db,
        {
          documentTypeId,
          storageUri: 'gs://dona-v5-docs/x/scan.pdf',
          fileHash: `${BLOCK}-ocr-later-hash`,
          driveFileId: null,
          validFrom: null,
          validTo: null,
          verificationVerdict: 'unverified',
        },
        INGESTED_AT,
      );
      // 4.1 will move unverified → verified once a scan has a text layer. The immutability
      // trigger names file_hash and storage_uri and nothing else, which is the claim.
      await db.query(
        `UPDATE document SET verification_verdict = 'verified' WHERE document_id = $1`,
        [filed.id],
      );
    });
  });

  it('refuses a validity window that ends before it starts', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'window' });
      await rejects(db, CHECK_VIOLATION, () =>
        ingestDocument(
          db,
          {
            documentTypeId,
            storageUri: 'gs://dona-v5-docs/x/y.pdf',
            fileHash: `${BLOCK}-window-hash`,
            driveFileId: null,
            validFrom: '2026-12-31',
            validTo: '2026-01-01',
            verificationVerdict: 'verified',
          },
          INGESTED_AT,
        ),
      );
    });
  });
});

describe('E13 · document_link — one document, several bindings (R13)', () => {
  it('binds one lease to a tenancy, a unit and two signatories', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'bindings' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-bindings-hash`,
      );

      // R13's whole case: six nullable foreign keys on `document` works until the seventh entity
      // needs documents. The ids here are not real rows, and that is the price stated in the
      // migration — `entity_id` points at eight tables, so no foreign key can be written.
      const bindings = [
        { entityType: 'TENANCY' as const, linkRole: 'SUBJECT' as const },
        { entityType: 'UNIT' as const, linkRole: 'SUBJECT' as const },
        { entityType: 'PARTY' as const, linkRole: 'SIGNATORY' as const },
        { entityType: 'PARTY' as const, linkRole: 'SIGNATORY' as const },
      ];
      for (const binding of bindings) {
        await linkDocument(db, {
          documentId,
          entityType: binding.entityType,
          entityId: newId(),
          linkRole: binding.linkRole,
        });
      }

      const count = await db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM document_link WHERE document_id = $1',
        [documentId],
      );
      assert.equal(count.rows[0]?.n, '4');
    });
  });

  it('files the same binding twice as one row', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'rebind' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-rebind-hash`,
      );
      const entityId = newId();
      const first = await linkDocument(db, {
        documentId,
        entityType: 'UNIT',
        entityId,
        linkRole: 'SUBJECT',
      });
      const second = await linkDocument(db, {
        documentId,
        entityType: 'UNIT',
        entityId,
        linkRole: 'SUBJECT',
      });
      assert.equal(first.inserted, true);
      assert.equal(second.inserted, false);
    });
  });

  it('refuses an entity kind that is not one of the workbook’s eight', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'kind' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-kind-hash`,
      );
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO document_link (document_id, entity_type, entity_id)
           VALUES ($1, 'INVOICE', $2)`,
          [documentId, newId()],
        ),
      );
    });
  });
});

describe('the same file ingested twice is one document with two links', () => {
  it('finds the row on the second ingest and adds the binding', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'twice' });
      const fileHash = `${BLOCK}-twice-hash`;
      const spec = {
        documentTypeId,
        storageUri: 'gs://dona-v5-docs/buildings/b/units/u/lease.pdf',
        fileHash,
        driveFileId: null,
        validFrom: null,
        validTo: null,
        verificationVerdict: 'verified' as const,
      };

      // Two administrators, two units, one file — or the same administrator filing twice. The
      // criterion is a statement about repetition, and `UNIQUE (file_hash)` is where it is true:
      // not in the caller's logic, which is why a second caller written next month cannot get it
      // wrong.
      const first = await ingestDocument(db, spec, INGESTED_AT);
      await linkDocument(db, {
        documentId: first.id,
        entityType: 'UNIT',
        entityId: newId(),
        linkRole: 'SUBJECT',
      });
      const second = await ingestDocument(db, spec, INGESTED_AT);
      await linkDocument(db, {
        documentId: second.id,
        entityType: 'TENANCY',
        entityId: newId(),
        linkRole: 'SUBJECT',
      });

      assert.equal(second.id, first.id, 'one document');
      assert.equal(second.inserted, false);

      const documents = await db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM document WHERE file_hash = $1',
        [fileHash],
      );
      const links = await db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM document_link WHERE document_id = $1',
        [first.id],
      );
      assert.equal(documents.rows[0]?.n, '1', 'one document row');
      assert.equal(links.rows[0]?.n, '2', 'two links');
    });
  });
});

describe('extracted_field — one value, one declaration (A8 open half)', () => {
  const EXTRACTED_COLUMNS = [
    'extracted_field_id',
    'document_id',
    'document_type_field_id',
    'value',
    'page',
    'bbox',
    'confidence',
    'model',
    'extracted_at',
    'promoted_to',
    'promoted_by',
    'promoted_at',
    // Slice 7.3. The approval stamp — what a person affirmed, who signed it and when. `value` above
    // is what the reader produced and is never overwritten by any of these.
    'approved_value',
    'approved_by',
    'approved_at',
  ];

  async function seedField(
    db: PoolClient,
    documentTypeId: string,
    fieldKey = 'apartment_number',
  ): Promise<string> {
    const result = await upsertDocumentTypeField(db, {
      documentTypeId,
      fieldKey,
      labelHe: 'מספר הדירה',
      valueType: 'TEXT',
      isRequired: true,
      extractionHint: 'המושכר',
      effectiveFrom: TODAY,
      effectiveTo: null,
    });
    return result.id;
  }

  it('has the pointer columns, the 4.3 stamp, and no schema_version_id', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extracted_field'
          ORDER BY ordinal_position`,
      );
      assert.deepEqual(
        result.rows.map((row) => row.column_name),
        EXTRACTED_COLUMNS,
      );
      assert.equal(
        result.rows.some((row) => row.column_name === 'schema_version_id'),
        false,
      );
      assert.equal(
        result.rows.some((row) => row.column_name === 'field_key'),
        false,
      );
    });
  });

  it('refuses a value whose document or declaration is missing', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'extract-fk' });
      const fieldId = await seedField(db, documentTypeId);
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-extract-fk-hash`,
      );

      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at
           ) VALUES ($1, $2, $3, '14', 1, '{"x":1,"y":2,"width":3,"height":4}',
                     null, 'fake', $4)`,
          [newId(), newId(), fieldId, INGESTED_AT],
        ),
      );
      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at
           ) VALUES ($1, $2, $3, '14', 1, '{"x":1,"y":2,"width":3,"height":4}',
                     null, 'fake', $4)`,
          [newId(), documentId, newId(), INGESTED_AT],
        ),
      );
    });
  });

  it('allows two values for the same declaration on one document', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'extract-two' });
      const fieldId = await seedField(db, documentTypeId, 'tenant_name');
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-extract-two-hash`,
      );
      const bbox = '{"x":1,"y":2,"width":3,"height":4}';
      await db.query(
        `INSERT INTO extracted_field (
           extracted_field_id, document_id, document_type_field_id, value,
           page, bbox, confidence, model, extracted_at
         ) VALUES ($1, $2, $3, 'אלון', 1, $4, null, 'fake', $5),
                  ($6, $2, $3, 'דנה', 1, $4, null, 'fake', $5)`,
        [newId(), documentId, fieldId, bbox, INGESTED_AT, newId()],
      );
      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM extracted_field WHERE document_id = $1`,
        [documentId],
      );
      assert.equal(count.rows[0]?.n, '2');
    });
  });

  it('refuses a page below 1 and a bbox that is not the four edges', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'extract-check' });
      const fieldId = await seedField(db, documentTypeId);
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-extract-check-hash`,
      );
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at
           ) VALUES ($1, $2, $3, '14', 0, '{"x":1,"y":2,"width":3,"height":4}',
                     null, 'fake', $4)`,
          [newId(), documentId, fieldId, INGESTED_AT],
        ),
      );
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at
           ) VALUES ($1, $2, $3, '14', 1, '{"x":1,"y":2}',
                     null, 'fake', $4)`,
          [newId(), documentId, fieldId, INGESTED_AT],
        ),
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  // Slice 7.3 — the approval stamp, and the three things the database refuses about it.
  //
  // Every rejection below was red first against 0028 with the constraint or the trigger removed;
  // the SQLSTATEs are in tasks/evidence/7.3.md. The last assertion is the slice's whole point, and
  // it is a claim about a column that did *not* move: an edited approval leaves `value` exactly as
  // the reader produced it, because the difference between the two is the accuracy dataset.
  // -------------------------------------------------------------------------------------------

  async function seedReading(
    db: PoolClient,
    name: string,
  ): Promise<{ extractedFieldId: string; documentId: string }> {
    const documentTypeId = await seedType(db, { name });
    const fieldId = await seedField(db, documentTypeId, 'tenant_name');
    const documentId = await seedDocument(
      db,
      documentTypeId,
      `${BLOCK}-${name}-hash`,
    );
    const extractedFieldId = newId();
    await db.query(
      `INSERT INTO extracted_field (
         extracted_field_id, document_id, document_type_field_id, value,
         page, bbox, confidence, model, extracted_at
       ) VALUES ($1, $2, $3, 'אבי כהן', 1,
                 '{"x":1,"y":2,"width":3,"height":4}', 0.96, 'fake', $4)`,
      [extractedFieldId, documentId, fieldId, INGESTED_AT],
    );
    return { extractedFieldId, documentId };
  }

  it('refuses a half-written approval stamp', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const { extractedFieldId } = await seedReading(db, 'approve-check');
      await db.query("SELECT set_config('dona.approving', 'on', true)");
      // A value with nobody's name on it, and a name with no moment. Neither is a state this table
      // has: an approval is one act and its three columns arrive together or not at all.
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `UPDATE extracted_field SET approved_value = 'אבי כהן'
            WHERE extracted_field_id = $1`,
          [extractedFieldId],
        ),
      );
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `UPDATE extracted_field SET approved_by = 'אסף', approved_at = $2
            WHERE extracted_field_id = $1`,
          [extractedFieldId, INGESTED_AT],
        ),
      );
    });
  });

  it('refuses an approval written outside the approve path, and a delete of an approved row', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const { extractedFieldId, documentId } = await seedReading(
        db,
        'approve-stamp',
      );

      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query(
          `UPDATE extracted_field
              SET approved_value = 'אבי כהן', approved_by = 'אסף', approved_at = $2
            WHERE extracted_field_id = $1`,
          [extractedFieldId, INGESTED_AT],
        ),
      );
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at,
             approved_value, approved_by, approved_at
           ) SELECT $1, document_id, document_type_field_id, value,
                    page, bbox, confidence, model, extracted_at,
                    'אבי כהן', 'אסף', $3
               FROM extracted_field WHERE extracted_field_id = $2`,
          [newId(), extractedFieldId, INGESTED_AT],
        ),
      );

      await db.query("SELECT set_config('dona.approving', 'on', true)");
      await db.query(
        `UPDATE extracted_field
            SET approved_value = 'אבי לוי', approved_by = 'אסף', approved_at = $2
          WHERE extracted_field_id = $1`,
        [extractedFieldId, INGESTED_AT],
      );
      await db.query("SELECT set_config('dona.approving', 'off', true)");

      // A promoted row is undeletable because the stamp is business truth. An approved row is
      // undeletable because the stamp is a person's word, and re-reading the page does not unsay it
      // — which is also why `extractFiledDocument` now spares it.
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query('DELETE FROM extracted_field WHERE extracted_field_id = $1', [
          extractedFieldId,
        ]),
      );
      // And re-extract's own predicate, which is the query that has to *mean* what the trigger
      // enforces: it matches nothing here, so it succeeds and the approved row survives. A
      // predicate that lost its `approved_at` half would raise the rejection above instead of
      // passing this line, which is the failure worth catching in the same case.
      await db.query(
        `DELETE FROM extracted_field
          WHERE document_id = $1 AND promoted_at IS NULL AND approved_at IS NULL`,
        [documentId],
      );
      const left = await db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM extracted_field WHERE document_id = $1',
        [documentId],
      );
      assert.equal(
        left.rows[0]?.n,
        '1',
        'the approved row survived re-extract',
      );

      // **The point of the slice.** The reader said אבי כהן, the person signed אבי לוי, and both
      // are on the row. One column would have destroyed the measurement on this correction.
      const row = await db.query<{ value: string; approved_value: string }>(
        `SELECT value, approved_value FROM extracted_field
          WHERE extracted_field_id = $1`,
        [extractedFieldId],
      );
      assert.equal(row.rows[0]?.value, 'אבי כהן');
      assert.equal(row.rows[0]?.approved_value, 'אבי לוי');
    });
  });
});

describe('the acceptance bar — a new type costs no DDL', () => {
  // 3.1's criterion, still the criterion. The seed now carries ten types (3.5 added
  // `building_handover_protocol` as a row), so the demonstration is a type that is *not* in the
  // seed — and it still goes through `applyDocumentTypeCatalogue`.
  const EVIDENCE_TABLES = [
    'document',
    'document_link',
    'document_type',
    'document_type_field',
    'extracted_field',
    'field_promotion',
  ];

  async function schemaSnapshot(db: PoolClient): Promise<string> {
    const result = await db.query<{ shape: string }>(
      `SELECT table_name || '.' || column_name || ':' || data_type ||
              ':' || is_nullable AS shape
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [EVIDENCE_TABLES],
    );
    return result.rows.map((row) => row.shape).join('\n');
  }

  it('seeds ten types, and the tenth is building_handover_protocol', async (t) => {
    if (!pool) return t.skip(skipReason);
    assert.equal(seedDocumentTypes.length, 10);
    assert.equal(
      seedDocumentTypes.some(
        (entry) => entry.type.typeKey === 'inspection_certificate',
      ),
      true,
    );
    assert.equal(
      seedDocumentTypes.some(
        (entry) => entry.type.typeKey === 'building_handover_protocol',
      ),
      true,
    );
  });

  // **Ticket #101.** The four amount declarations, asserted as seed data rather than promised in the
  // fixture's comment. A currency is paired with each amount and never shared between them, which is
  // the whole reason there are four rows and not three
  // (docs/decisions/ADR-0008-money-is-ordinary-data.md).
  // No `pool` guard: this reads the seed fixture and touches no database, so gating it on Postgres
  // would be a silent skip on a clean clone (AGENTS.md — a silent skip is a failure).
  it('seeds a rent and a deposit on the lease, each with its own currency', () => {
    const lease = seedDocumentTypes.find(
      (entry) => entry.type.typeKey === 'lease',
    );
    const declared = new Map(
      (lease?.fields ?? []).map((field) => [field.fieldKey, field]),
    );
    for (const [fieldKey, valueType] of [
      ['rent_amount', 'NUMBER'],
      ['rent_currency', 'TEXT'],
      ['deposit_amount', 'NUMBER'],
      ['deposit_currency', 'TEXT'],
    ] as const) {
      const field = declared.get(fieldKey);
      assert.ok(field, `${fieldKey} is declared on the lease`);
      assert.equal(field?.valueType, valueType);
      assert.equal(field?.effectiveFrom, '2026-09-15');
      assert.equal(field?.effectiveTo, null);
    }
    // Each amount's hint names the amount it is not, which is what stops the reader returning the
    // deposit for the rent — the same instrument the two identifier hints use.
    assert.match(
      declared.get('rent_amount')?.extractionHint ?? '',
      /לא סכום הפיקדון/,
    );
    assert.match(
      declared.get('deposit_amount')?.extractionHint ?? '',
      /לא דמי השכירות החודשיים/,
    );
    // No MONEY value type was added to carry them, so the union is untouched.
    assert.equal(
      seedDocumentTypes.some((entry) =>
        entry.fields.some((field) => field.valueType === ('MONEY' as never)),
      ),
      false,
    );
  });

  // **Ticket #131.** The household is named by role so an identifier cannot land on the wrong
  // person, and the terms the specimens actually print join as optional rows. All of it is seed
  // data at a new `effective_from`. The Map in the #101 test above would lose a closed row that
  // shares a key with an open one, so these look up by key and window.
  it('names the lease household by role, and closes the unpaired names rather than editing them', () => {
    const lease = seedDocumentTypes.find(
      (entry) => entry.type.typeKey === 'lease',
    );
    const of = (fieldKey: string) =>
      (lease?.fields ?? []).filter((field) => field.fieldKey === fieldKey);
    const live = (fieldKey: string) =>
      of(fieldKey).find((field) => field.effectiveTo === null);
    const closed = (fieldKey: string) =>
      of(fieldKey).find((field) => field.effectiveTo !== null);

    const tenantName = closed('tenant_name');
    assert.ok(tenantName, 'tenant_name is closed, not deleted');
    assert.equal(tenantName?.effectiveFrom, '2026-09-07');
    assert.equal(tenantName?.effectiveTo, '2026-09-20');
    assert.equal(tenantName?.labelHe, 'שם השוכר');
    assert.equal(live('tenant_name'), undefined);

    const tenantId = closed('tenant_id_number');
    assert.ok(tenantId, 'tenant_id_number is closed, not deleted');
    assert.equal(tenantId?.effectiveFrom, '2026-09-13');
    assert.equal(tenantId?.effectiveTo, '2026-09-20');
    assert.equal(live('tenant_id_number'), undefined);

    const mainName = live('main_tenant_name');
    assert.equal(mainName?.isRequired, true);
    assert.equal(mainName?.valueType, 'TEXT');
    assert.equal(mainName?.effectiveFrom, '2026-09-21');
    assert.equal(
      (lease?.fields ?? []).some((field) => 'groupKey' in field),
      false,
    );

    for (const [fieldKey, valueType] of [
      ['main_tenant_id_number', 'TEXT'],
      ['second_tenant_name', 'TEXT'],
      ['second_tenant_id_number', 'TEXT'],
      ['maintenance_amount', 'NUMBER'],
      ['maintenance_currency', 'TEXT'],
      ['deposit_months', 'NUMBER'],
      ['promissory_note_amount', 'NUMBER'],
      ['promissory_note_currency', 'TEXT'],
      ['option_end_date', 'DATE'],
      ['signed_date', 'DATE'],
    ] as const) {
      const field = live(fieldKey);
      assert.ok(field, `${fieldKey} is declared on the lease`);
      assert.equal(field?.isRequired, false, `${fieldKey} is optional`);
      assert.equal(field?.valueType, valueType);
      assert.equal(field?.effectiveFrom, '2026-09-21');
    }

    assert.equal(live('guarantor_name')?.isRequired, false);
    assert.equal(live('guarantor_id_number')?.isRequired, false);
    assert.equal(
      of('gush').some((field) => field.effectiveFrom === '2026-09-21'),
      false,
    );
    assert.equal(
      of('helka').some((field) => field.effectiveFrom === '2026-09-21'),
      false,
    );
    assert.equal(live('structure_designation'), undefined);
  });

  it('declares the residual place facts as optional seed rows', () => {
    const lease = seedDocumentTypes.find(
      (entry) => entry.type.typeKey === 'lease',
    );
    const live = (fieldKey: string) =>
      (lease?.fields ?? []).find(
        (field) => field.fieldKey === fieldKey && field.effectiveTo === null,
      );

    for (const [fieldKey, valueType] of [
      ['rooms', 'NUMBER'],
      ['floor', 'NUMBER'],
      ['gush', 'TEXT'],
      ['helka', 'TEXT'],
      ['building_number', 'TEXT'],
      ['apartment_type', 'TEXT'],
      ['has_storage', 'BOOLEAN'],
      ['storage_space_number', 'TEXT'],
      ['parking_space_number', 'TEXT'],
    ] as const) {
      const field = live(fieldKey);
      assert.ok(field, `${fieldKey} is declared on the lease`);
      assert.equal(field?.isRequired, false, `${fieldKey} is optional`);
      assert.equal(field?.valueType, valueType);
      assert.equal(field?.effectiveFrom, '2026-09-22');
    }

    assert.equal(live('security_structure'), undefined);
    assert.equal(live('index_base_month'), undefined);
    assert.equal(live('index_publication_date'), undefined);
  });

  it('a September reading still resolves against the unpaired tenant_name', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const columns = await schemaSnapshot(db);
      await applyDocumentTypeCatalogue(db, seedDocumentTypes);
      assert.equal(await schemaSnapshot(db), columns, 'no migration');

      const then = await documentTypeFields(db, 'lease', '2026-09-13');
      const thenKeys = then.map((field) => field.fieldKey);
      assert.equal(thenKeys.includes('tenant_name'), true);
      assert.equal(thenKeys.includes('tenant_id_number'), true);
      assert.equal(thenKeys.includes('main_tenant_name'), false);

      const now = await documentTypeFields(db, 'lease', '2026-09-21');
      const nowKeys = now.map((field) => field.fieldKey);
      assert.equal(nowKeys.includes('main_tenant_name'), true);
      assert.equal(nowKeys.includes('tenant_name'), false);
      assert.equal(nowKeys.includes('tenant_id_number'), false);
      assert.equal(nowKeys.includes('gush'), false);
      assert.equal(nowKeys.includes('helka'), false);

      const next = await documentTypeFields(db, 'lease', '2026-09-22');
      const nextKeys = next.map((field) => field.fieldKey);
      assert.equal(nextKeys.includes('gush'), true);
      assert.equal(nextKeys.includes('parking_space_number'), true);
    });
  });

  it('does not add a group_key column to document_type_field', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'document_type_field'`,
      );
      assert.equal(
        columns.rows.some((row) => row.column_name === 'group_key'),
        false,
      );
    });
  });

  it('adds a type with four fields, and the schema does not move', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const before = await schemaSnapshot(db);

      const tenth = typeKey('vaad-bayit');
      const report = await applyDocumentTypeCatalogue(db, [
        {
          type: {
            typeKey: tenth,
            labelHe: 'הסכם ועד בית',
            labelEn: 'Building committee agreement',
            verificationTerms: ['ועד בית', 'דמי ניהול'],
            isActive: true,
          },
          fields: [
            {
              fieldKey: 'agreement_date',
              labelHe: 'מועד ההסכם',
              valueType: 'DATE',
              isRequired: true,
              extractionHint: 'תאריך',
              effectiveFrom: TODAY,
              effectiveTo: null,
            },
            {
              fieldKey: 'scope',
              labelHe: 'היקף השירות',
              valueType: 'TEXT',
              isRequired: true,
              extractionHint: null,
              effectiveFrom: TODAY,
              effectiveTo: null,
            },
            {
              fieldKey: 'renews_automatically',
              labelHe: 'חידוש אוטומטי',
              valueType: 'BOOLEAN',
              isRequired: false,
              extractionHint: null,
              effectiveFrom: TODAY,
              effectiveTo: null,
            },
            {
              fieldKey: 'notice_period_days',
              labelHe: 'תקופת הודעה מוקדמת בימים',
              valueType: 'NUMBER',
              isRequired: false,
              extractionHint: null,
              effectiveFrom: TODAY,
              effectiveTo: null,
            },
          ],
        },
      ]);

      const after = await schemaSnapshot(db);
      assert.equal(
        after,
        before,
        'adding a document type must not change one column of DDL',
      );
      assert.deepEqual(report, {
        types: { created: 1, updated: 0 },
        fields: { created: 4, updated: 0 },
      });

      // And it is immediately usable: it appears in the picker and declares its four fields, with
      // no deploy between the row and the use.
      const types = await listDocumentTypes(db);
      assert.equal(
        types.some((row) => row.typeKey === tenth),
        true,
      );
      const fields = await documentTypeFields(db, tenth, TODAY);
      assert.deepEqual(fields.map((row) => row.fieldKey).sort(), [
        'agreement_date',
        'notice_period_days',
        'renews_automatically',
        'scope',
      ]);

      // Extract nothing — the slice's words. The point is that the *declaration* costs no schema
      // change; filling it is week 4's, and a document filed against the tenth type today is
      // already citable and searchable.
      const documentId = await seedDocument(
        db,
        types.find((row) => row.typeKey === tenth)?.documentTypeId ?? '',
        `${BLOCK}-tenth-hash`,
      );
      assert.ok(documentId);
    });
  });
});

describe('field_promotion — A8 governed half', () => {
  const PROMOTION_COLUMNS = [
    'field_promotion_id',
    'document_type_field_id',
    'target',
  ];

  async function seedField(
    db: PoolClient,
    documentTypeId: string,
    fieldKey = 'start_date',
  ): Promise<string> {
    const result = await upsertDocumentTypeField(db, {
      documentTypeId,
      fieldKey,
      labelHe: 'תחילת תקופת השכירות',
      valueType: 'DATE',
      isRequired: true,
      extractionHint: 'תקופת השכירות',
      effectiveFrom: TODAY,
      effectiveTo: null,
    });
    return result.id;
  }

  async function insertExtracted(
    db: PoolClient,
    documentId: string,
    fieldId: string,
  ): Promise<string> {
    const id = newId();
    await db.query(
      `INSERT INTO extracted_field (
         extracted_field_id, document_id, document_type_field_id, value,
         page, bbox, confidence, model, extracted_at
       ) VALUES ($1, $2, $3, '2026-01-01', 1,
                 '{"x":1,"y":2,"width":3,"height":4}', null, 'fake', $4)`,
      [id, documentId, fieldId, INGESTED_AT],
    );
    return id;
  }

  it('is a relation, with the mapping columns and no promotes_to on the catalogue', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      await db.query('SELECT 1 FROM field_promotion LIMIT 0');
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'field_promotion'
          ORDER BY ordinal_position`,
      );
      assert.deepEqual(
        result.rows.map((row) => row.column_name),
        PROMOTION_COLUMNS,
      );
      const catalogue = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('document_type', 'document_type_field')
            AND column_name = 'promotes_to'`,
      );
      assert.deepEqual(catalogue.rows, []);
    });
  });

  it('refuses a mapping whose declaration is missing, a second mapping, and an ungoverned target', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'promo-fk' });
      const fieldId = await seedField(db, documentTypeId);
      await rejects(db, FOREIGN_KEY_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'tenancy.start_date')`,
          [newId(), newId()],
        ),
      );
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'tenancy.start_date')`,
        [newId(), fieldId],
      );
      await rejects(db, UNIQUE_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'tenancy.end_date')`,
          [newId(), fieldId],
        ),
      );
      const other = await seedField(db, documentTypeId, 'end_date');
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'tenancy.notice_date')`,
          [newId(), other],
        ),
      );
      const rent = await seedField(db, documentTypeId, 'rent_amount');
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'tenancy.rent_amount')`,
        [newId(), rent],
      );
      const deposit = await seedField(db, documentTypeId, 'deposit_amount');
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'tenancy.deposit_amount')`,
          [newId(), deposit],
        ),
      );
      const rooms = await seedField(db, documentTypeId, 'rooms');
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'unit.rooms')`,
        [newId(), rooms],
      );
      const floor = await seedField(db, documentTypeId, 'floor');
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'space.floor')`,
        [newId(), floor],
      );
      const bay = await seedField(db, documentTypeId, 'parking_space_number');
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'tenancy.parking_space_id')`,
        [newId(), bay],
      );
      const store = await seedField(db, documentTypeId, 'storage_space_number');
      await db.query(
        `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
         VALUES ($1, $2, 'tenancy.storage_space_id')`,
        [newId(), store],
      );
      const built = await seedField(db, documentTypeId, 'built_bay');
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'unit.parking_space_id')`,
          [newId(), built],
        ),
      );
      const builtStore = await seedField(db, documentTypeId, 'built_store');
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'unit.storage_space_id')`,
          [newId(), builtStore],
        ),
      );
      const gush = await seedField(db, documentTypeId, 'gush');
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
           VALUES ($1, $2, 'building.gush')`,
          [newId(), gush],
        ),
      );
    });
  });

  it('refuses a stamp written outside the promotion path, and a delete of a stamped row', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'promo-stamp' });
      const fieldId = await seedField(db, documentTypeId);
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-promo-stamp-hash`,
      );
      const extractedId = await insertExtracted(db, documentId, fieldId);

      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query(
          `UPDATE extracted_field
              SET promoted_to = 'tenancy.start_date',
                  promoted_by = 'אסף',
                  promoted_at = $2
            WHERE extracted_field_id = $1`,
          [extractedId, INGESTED_AT],
        ),
      );
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at,
             promoted_to, promoted_by, promoted_at
           ) VALUES ($1, $2, $3, '2026-01-01', 1,
                     '{"x":1,"y":2,"width":3,"height":4}', null, 'fake', $4,
                     'tenancy.start_date', 'אסף', $4)`,
          [newId(), documentId, fieldId, INGESTED_AT],
        ),
      );

      // **Slice 7.4.** 0029's trigger refuses this stamp on a row nobody signed, which is its own
      // case in `tests/policy/promotion-approval.test.ts`. Here it is a precondition and not the
      // subject: the row is approved first so that what the rest of this case proves stays 0018's
      // rule — that `dona.promoting` is what separates the command from everybody else.
      await db.query("SELECT set_config('dona.approving', 'on', true)");
      await db.query(
        `UPDATE extracted_field
            SET approved_value = value, approved_by = 'אסף', approved_at = $2
          WHERE extracted_field_id = $1`,
        [extractedId, INGESTED_AT],
      );
      await db.query("SELECT set_config('dona.approving', 'off', true)");

      await db.query("SELECT set_config('dona.promoting', 'on', true)");
      await db.query(
        `UPDATE extracted_field
            SET promoted_to = 'tenancy.start_date',
                promoted_by = 'אסף',
                promoted_at = $2
          WHERE extracted_field_id = $1`,
        [extractedId, INGESTED_AT],
      );
      await db.query("SELECT set_config('dona.promoting', 'off', true)");
      await rejects(db, RESTRICT_VIOLATION, () =>
        db.query('DELETE FROM extracted_field WHERE extracted_field_id = $1', [
          extractedId,
        ]),
      );
      await db.query(
        'DELETE FROM extracted_field WHERE document_id = $1 AND promoted_at IS NULL',
        [documentId],
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Slice 7.2 — the declaration an administrator writes, and what a correction leaves behind.
//
// R18's promise is that a value extracted in January is still explicable after the schema is
// corrected in March. Until 7.2 the only writer was the seed, where the two dates are typed by hand
// in `src/evidence/fixtures/document-types.ts` and a reviewer reads them. `declareDocumentTypeField`
// computes them, so what the reviewer used to check is what this block checks.
// ---------------------------------------------------------------------------------------------
describe('E16 · a declaration written at run time (slice 7.2, flow A14)', () => {
  let pool: Pool | null = null;
  before(async () => {
    pool = await migratedPoolOrNull();
  });
  after(async () => {
    await pool?.end();
  });

  const YESTERDAY = '2026-09-19';
  const ON = '2026-09-20';
  const TOMORROW = '2026-09-21';

  async function declared(
    db: PoolClient,
    key: string,
  ): Promise<
    {
      field_key: string;
      label_he: string;
      effective_from: string;
      effective_to: string | null;
    }[]
  > {
    const { rows } = await db.query<{
      field_key: string;
      label_he: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT f.field_key, f.label_he,
              to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(f.effective_to, 'YYYY-MM-DD') AS effective_to
         FROM document_type_field f
         JOIN document_type t ON t.document_type_id = f.document_type_id
        WHERE t.type_key = $1
        ORDER BY f.effective_from`,
      [key],
    );
    return rows;
  }

  it('declares a field with no migration and no seed', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('declare');
      await upsertDocumentType(db, {
        typeKey: key,
        labelHe: 'חוזה שכירות',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      const columns = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
          WHERE table_name = 'document_type_field'`,
      );
      const result = await declareDocumentTypeField(db, {
        typeKey: key,
        fieldKey: 'city',
        labelHe: 'עיר',
        valueType: 'TEXT',
        isRequired: false,
        extractionHint: 'עיר בלבד, לא הרחוב',
        on: ON,
      });
      assert.notEqual(result.documentTypeFieldId, null);
      assert.equal(
        result.supersededId,
        null,
        'nothing was declared here before',
      );

      const governing = await documentTypeFields(db, key, ON);
      assert.equal(governing.length, 1);
      assert.equal(governing[0]?.fieldKey, 'city');
      assert.equal(governing[0]?.effectiveFrom, ON);
      // The acceptance bar 3.1 set for a *type*, now asserted for a field: the schema did not move.
      const after = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
          WHERE table_name = 'document_type_field'`,
      );
      assert.equal(after.rows[0]?.n, columns.rows[0]?.n);
      // And it governs nothing before the day it was declared.
      assert.deepEqual(await documentTypeFields(db, key, YESTERDAY), []);
    });
  });

  it('a correction leaves two rows, and the old one still says what it said', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('correct');
      await upsertDocumentType(db, {
        typeKey: key,
        labelHe: 'חוזה שכירות',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      await declareDocumentTypeField(db, {
        typeKey: key,
        fieldKey: 'city',
        labelHe: 'עיר',
        valueType: 'TEXT',
        isRequired: false,
        extractionHint: 'עיר',
        on: YESTERDAY,
      });
      const corrected = await declareDocumentTypeField(db, {
        typeKey: key,
        fieldKey: 'city',
        labelHe: 'עיר המושכר',
        valueType: 'TEXT',
        isRequired: true,
        extractionHint: 'עיר בלבד, לא הרחוב ולא המיקוד',
        on: ON,
      });

      const rows = await declared(db, key);
      assert.equal(
        rows.length,
        2,
        'a correction is a new row and never an edit',
      );
      // **The superseded row still says what it said.** This is the whole of R18: a value extracted
      // yesterday points at this row, and reading it back has to explain that value.
      assert.equal(rows[0]?.label_he, 'עיר');
      assert.equal(rows[0]?.effective_from, YESTERDAY);
      // **Closed at the day before the successor opens, not at the same day.** Both ends of
      // `documentTypeFields`'s window are inclusive, so closing at `ON` would leave two live rows.
      assert.equal(rows[0]?.effective_to, YESTERDAY);
      assert.equal(corrected.supersededTo, YESTERDAY);
      assert.equal(rows[1]?.label_he, 'עיר המושכר');
      assert.equal(rows[1]?.effective_from, ON);
      assert.equal(rows[1]?.effective_to, null);

      // One declaration governs today, and the superseded one still governs yesterday.
      const today = await documentTypeFields(db, key, ON);
      assert.equal(today.length, 1, 'exactly one declaration governs a day');
      assert.equal(today[0]?.labelHe, 'עיר המושכר');
      assert.equal(today[0]?.isRequired, true);
      const before = await documentTypeFields(db, key, YESTERDAY);
      assert.equal(before.length, 1);
      assert.equal(before[0]?.labelHe, 'עיר');
      assert.equal(before[0]?.isRequired, false);
    });
  });

  it('refuses the same field declared twice in one day, and leaves the first alone', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('twice');
      await upsertDocumentType(db, {
        typeKey: key,
        labelHe: 'חוזה שכירות',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      const spec = {
        typeKey: key,
        fieldKey: 'city',
        valueType: 'TEXT' as const,
        isRequired: false,
        extractionHint: null,
        on: ON,
      };
      await declareDocumentTypeField(db, { ...spec, labelHe: 'עיר' });
      // The natural key is `(document_type_id, field_key, effective_from)` and the version CHECK
      // refuses a row closed before it opens, so both constraints would fire — unreadably. The
      // command refuses first and names the rule.
      await assert.rejects(
        () => declareDocumentTypeField(db, { ...spec, labelHe: 'עיר אחרת' }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'conflict');
          assert.match((error as Error).message, /nothing to supersede/);
          return true;
        },
      );
      const rows = await declared(db, key);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.label_he, 'עיר');
      assert.equal(rows[0]?.effective_to, null);
    });
  });

  it('retires a field: the row is closed, nothing is inserted, nothing is deleted', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const key = typeKey('retire');
      await upsertDocumentType(db, {
        typeKey: key,
        labelHe: 'חוזה שכירות',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      await declareDocumentTypeField(db, {
        typeKey: key,
        fieldKey: 'city',
        labelHe: 'עיר',
        valueType: 'TEXT',
        isRequired: false,
        extractionHint: null,
        on: YESTERDAY,
      });
      const retired = await retireDocumentTypeField(db, {
        typeKey: key,
        fieldKey: 'city',
        on: ON,
      });
      assert.equal(
        retired.documentTypeFieldId,
        null,
        'retiring inserts nothing',
      );
      assert.equal(retired.supersededTo, YESTERDAY);

      const rows = await declared(db, key);
      assert.equal(rows.length, 1, 'deactivate, never delete');
      assert.equal(rows[0]?.effective_to, YESTERDAY);
      assert.deepEqual(await documentTypeFields(db, key, ON), []);
      // The declaration still explains what was read under it.
      assert.equal((await documentTypeFields(db, key, YESTERDAY)).length, 1);

      // Retiring what is not declared is `not_found` and not a silent no-op: an administrator who
      // retired the wrong key has to be told.
      await assert.rejects(
        () =>
          retireDocumentTypeField(db, {
            typeKey: key,
            fieldKey: 'city',
            on: TOMORROW,
          }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'not_found');
          return true;
        },
      );
    });
  });

  it('refuses a declaration on a type that does not exist', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      await assert.rejects(
        () =>
          declareDocumentTypeField(db, {
            typeKey: typeKey('absent'),
            fieldKey: 'city',
            labelHe: 'עיר',
            valueType: 'TEXT',
            isRequired: false,
            extractionHint: null,
            on: ON,
          }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'not_found');
          return true;
        },
      );
    });
  });
});

describe('evidence · document_passage', () => {
  const PASSAGE_COLUMNS = [
    'document_passage_id',
    'document_id',
    'page',
    'ordinal',
    'body',
    'embedding',
  ];

  it('has one row shape per page, at the welded embedding width, and no vector index', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'document_passage'
          ORDER BY ordinal_position`,
      );
      assert.deepEqual(
        columns.rows.map((row) => row.column_name),
        PASSAGE_COLUMNS,
      );
      const width = await db.query<{ typ: string }>(
        `SELECT format_type(a.atttypid, a.atttypmod) AS typ
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'document_passage'
            AND a.attname = 'embedding'
            AND a.attnum > 0
            AND NOT a.attisdropped`,
      );
      assert.equal(width.rows[0]?.typ, `vector(${embeddingColumnDimensions})`);
      const vectorIndexes = await db.query<{ relname: string }>(
        `SELECT ic.relname
           FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_class ic ON ic.oid = i.indexrelid
           JOIN pg_am am ON am.oid = ic.relam
          WHERE t.relname = 'document_passage'
            AND am.amname IN ('hnsw', 'ivfflat')`,
      );
      assert.deepEqual(vectorIndexes.rows, []);
    });
  });

  it('refuses a second passage on the same page of one document', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'passage-page' });
      const documentId = await seedDocument(
        db,
        documentTypeId,
        `${BLOCK}-passage-page-hash`,
      );
      const zeros = `[${Array(embeddingColumnDimensions).fill(0).join(',')}]`;
      await db.query(
        `INSERT INTO document_passage (
           document_passage_id, document_id, page, ordinal, body, embedding
         ) VALUES ($1, $2, 1, 0, 'first', $3::vector)`,
        [newId(), documentId, zeros],
      );
      await rejects(db, UNIQUE_VIOLATION, () =>
        db.query(
          `INSERT INTO document_passage (
             document_passage_id, document_id, page, ordinal, body, embedding
           ) VALUES ($1, $2, 1, 1, 'second', $3::vector)`,
          [newId(), documentId, zeros],
        ),
      );
    });
  });
});
