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
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  applyDocumentTypeCatalogue,
  documentTypeFields,
  ingestDocument,
  linkDocument,
  listDocumentTypes,
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

  it('has no MONEY value type, and refuses one', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const documentTypeId = await seedType(db, { name: 'money' });
      // Foundation rule 2 and READ ME rule 3, asserted rather than commented. Capture being open
      // means an amount on a page is capturable in principle; declaring a money *field* is how it
      // would quietly become business truth, so the CHECK has no member to declare it with.
      await rejects(db, CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO document_type_field (document_type_field_id, document_type_id, field_key,
                                            label_he, value_type, is_required, effective_from)
           VALUES ($1, $2, 'rent', 'דמי שכירות', 'MONEY', true, '2026-01-01')`,
          [newId(), documentTypeId],
        ),
      );
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
    assert.equal(
      seedDocumentTypes.some((entry) =>
        entry.fields.some((field) => field.valueType === ('MONEY' as never)),
      ),
      false,
      'no money field is ever seeded',
    );
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
