// Filing a document, end to end through the real schema. Slice 3.3, flow A1.
//
// These run against Postgres inside a rolled-back transaction, because every claim here is a claim
// about rows: that a refusal leaves none, that the same bytes filed twice are one document with two
// links, and that the object is written before the row and only when no document already holds the
// hash. An in-memory double would prove this file and the DDL agree, which is not the constraint.
//
// The bytes are a PDF header and nothing else, and the *text* comes from `createFakePdfText`. That
// is deliberate: `src/kernel/pdf.ts` is tested where it lives, the tier-1 corpus is Hebrew and a
// fixture PDF carrying Hebrew would need an embedded font and a CMap, and what is under test here is
// what the intake does with a document's text rather than how the text was obtained. The wrong-file
// case against the specimens themselves is `tests/policy/document-verification.test.ts`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import {
  createFakeOcrText,
  defaultOcrProcessorVersion,
  type OcrText,
} from '../kernel/ocr.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  sweepUnverified,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const BUCKET = 'dona-v5-test-docs';
const AT = new Date('2026-09-07T09:00:00.000Z');

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

// A PDF as far as the sniffer is concerned, which is all these cases need it to be: the reader is
// injected, so the bytes and the text are two independent inputs and a case can vary either.
const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('a photograph of a page'),
]);

function deps(
  db: PoolClient,
  text: string[],
  extra: { ocr?: OcrText } = {},
): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText(text),
    ocr: extra.ocr,
    ocrVersion: extra.ocr ? defaultOcrProcessorVersion : undefined,
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
  };
}

interface AuditRow {
  action: string;
  outcome: string;
  subject_id: string | null;
  inputs: Record<string, unknown>;
}

// Both counts are **scoped to the place this case invented**, and that is not a detail. The
// transaction is rolled back, so nothing here is left behind — but it can still *see* what a
// developer filed through `npm run dev` an hour ago against the same database. A count over the
// whole table is a case that passes on a clean laptop and fails on a used one, which is 1.11's
// lesson written a second time.
const auditLines = async (
  db: PoolClient,
  subjectId: string,
): Promise<AuditRow[]> => {
  const result = await db.query<AuditRow>(
    `SELECT action, outcome, subject_id, inputs FROM audit_log
      WHERE action = 'evidence.file_document' AND subject_id = $1 ORDER BY at`,
    [subjectId],
  );
  return result.rows;
};

const documentCount = async (
  db: PoolClient,
  placeId: string,
): Promise<number> => {
  const result = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM document
      WHERE storage_uri LIKE '%/' || $1 || '/%'`,
    [placeId],
  );
  return Number(result.rows[0]?.n ?? '0');
};

describe('evidence · filing a declared document', () => {
  it('files, refuses and binds', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test('files a lease against a unit and a tenancy', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await applyDocumentTypeCatalogue(db, seedDocumentTypes);
          const unitId = newId();
          const tenancyId = newId();
          const bytes = pdfBytes('lease');

          const result = await fileDocument(
            deps(db, [specimen('lease-standard.md')]),
            {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId,
            },
          );

          assert.equal(result.filed, true);
          if (!result.filed) return;
          assert.equal(result.verification.verdict, 'verified');
          assert.equal(result.inserted, true);
          // The path convention, from the outside: the place, the type and the digest, and nothing
          // that could name a person (slice 3.2).
          assert.match(
            result.storageUri,
            new RegExp(
              `^gs://${BUCKET}/unit/${unitId}/lease/[0-9a-f]{64}\\.pdf$`,
            ),
          );

          const row = await db.query<{
            file_hash: string;
            storage_uri: string;
            ingested_at: Date;
          }>(
            'SELECT file_hash, storage_uri, ingested_at FROM document WHERE document_id = $1',
            [result.documentId],
          );
          assert.equal(row.rows[0]?.storage_uri, result.storageUri);
          // The clock is injected all the way down: no DEFAULT now(), no Date.now() (SPEC.md).
          assert.equal(
            row.rows[0]?.ingested_at.toISOString(),
            AT.toISOString(),
          );

          const links = await db.query<{
            entity_type: string;
            entity_id: string;
          }>(
            'SELECT entity_type, entity_id FROM document_link WHERE document_id = $1 ORDER BY entity_type',
            [result.documentId],
          );
          assert.deepEqual(
            links.rows.map((link) => `${link.entity_type}:${link.entity_id}`),
            [`TENANCY:${tenancyId}`, `UNIT:${unitId}`],
          );

          const lines = await auditLines(db, unitId);
          assert.equal(lines.length, 1);
          assert.equal(lines[0]?.outcome, 'ok');
          assert.equal(lines[0]?.subject_id, unitId);
          assert.equal(lines[0]?.inputs.verdict, 'verified');
        });
      });

      await t.test(
        'refuses an ארנונה bill in the lease slot and writes nothing',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            const before = await documentCount(db, unitId);
            const store = createMemoryStore();
            const result = await fileDocument(
              {
                ...deps(db, [specimen('arnona-bill.md')]),
                objects: store,
              },
              {
                bytes: pdfBytes('arnona'),
                typeKey: 'lease',
                place: { kind: 'UNIT', id: unitId },
                tenancyId: null,
              },
            );

            assert.equal(result.filed, false);
            assert.equal(result.verification.verdict, 'refused');
            assert.ok(result.verification.missingTerms.length > 0);
            // No row, and no object: *caught before it is filed* is a statement about writes.
            assert.equal(await documentCount(db, unitId), before);
            await assert.rejects(store.read('anything'), /object not found/);

            // What someone tried to file and when, without a `state` column (SPEC-evidence.md).
            const lines = await auditLines(db, unitId);
            assert.equal(lines.length, 1);
            assert.equal(lines[0]?.outcome, 'error');
            assert.equal(lines[0]?.inputs.verdict, 'refused');
            assert.deepEqual(
              lines[0]?.inputs.missingTerms,
              result.verification.missingTerms,
            );
            // The line carries a digest and a type. It does not carry a filename, and there is
            // nowhere for one to come from: the intake is never told it.
            assert.equal(
              JSON.stringify(lines[0]?.inputs).includes('.pdf'),
              false,
            );
          });
        },
      );

      await t.test(
        'the same file against a second place is one document with two links',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const first = newId();
            const second = newId();
            const bytes = pdfBytes('one lease, two flats claim it');
            const shared = deps(db, [specimen('lease-standard.md')]);

            const one = await fileDocument(shared, {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: first },
              tenancyId: null,
            });
            const two = await fileDocument(shared, {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: second },
              tenancyId: null,
            });

            assert.equal(one.filed && two.filed, true);
            if (!one.filed || !two.filed) return;
            assert.equal(two.documentId, one.documentId);
            assert.equal(two.inserted, false);
            // **The lookup before the put is what this asserts.** The second filing computed a path
            // under the second unit and did not write it: `ingestDocument` keeps the first
            // `storage_uri`, so a second object would be unreferenced the moment it was created.
            assert.equal(two.storageUri, one.storageUri);
            assert.match(two.storageUri, new RegExp(`/unit/${first}/`));
            await assert.rejects(
              shared.objects.read(
                `unit/${second}/lease/${two.storageUri.slice(-68)}`,
              ),
              /object not found/,
            );

            const links = await db.query<{ n: string }>(
              'SELECT count(*)::text AS n FROM document_link WHERE document_id = $1',
              [one.documentId],
            );
            assert.equal(links.rows[0]?.n, '2');
          });
        },
      );

      await t.test(
        'files a photograph as unverified rather than refusing it',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // A scan has no text layer, and OCR is slice 4.1's. Refusing it would refuse most real
            // leases; filing it silently would make `verified` mean nothing.
            const unitId = newId();
            const result = await fileDocument(deps(db, []), {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'unverified');
            assert.match(result.storageUri, /\.png$/);
            const lines = await auditLines(db, unitId);
            assert.equal(lines[0]?.inputs.verdict, 'unverified');
          });
        },
      );

      await t.test(
        'OCRs a photograph after filing and promotes it to verified',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            const wired = deps(db, [], {
              ocr: createFakeOcrText([specimen('lease-standard.md')]),
            });
            const result = await fileDocument(wired, {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'verified');
            const row = await db.query<{ verification_verdict: string }>(
              'SELECT verification_verdict FROM document WHERE document_id = $1',
              [result.documentId],
            );
            assert.equal(row.rows[0]?.verification_verdict, 'verified');
            const filed = await auditLines(db, unitId);
            assert.equal(filed[0]?.inputs.verdict, 'unverified');
            const read = await db.query<{
              action: string;
              inputs: Record<string, unknown>;
            }>(
              `SELECT action, inputs FROM audit_log
                WHERE action = 'evidence.read_document' AND subject_id = $1`,
              [unitId],
            );
            assert.equal(read.rows[0]?.inputs.verdict, 'verified');
          });
        },
      );

      await t.test(
        'an OCR miss leaves the row unverified and does not throw',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            const ocr: OcrText = {
              async pages() {
                throw new KernelError('unavailable', 'the ocr call timed out', {
                  timeoutMs: 20_000,
                });
              },
              describe: () => 'fake',
            };
            const result = await fileDocument(deps(db, [], { ocr }), {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'unverified');
          });
        },
      );

      await t.test(
        'does not call OCR when the native text layer already verified the file',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            let called = 0;
            const ocr: OcrText = {
              async pages() {
                called += 1;
                return { pages: [], images: [] };
              },
              describe: () => 'fake',
            };
            const result = await fileDocument(
              deps(db, [specimen('lease-standard.md')], { ocr }),
              {
                bytes: pdfBytes('native lease'),
                typeKey: 'lease',
                place: { kind: 'UNIT', id: unitId },
                tenancyId: null,
              },
            );
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'verified');
            assert.equal(called, 0);
          });
        },
      );

      await t.test(
        'sweeps an already-filed unverified photograph into verified',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            const wired = deps(db, []);
            const result = await fileDocument(wired, {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'unverified');
            const report = await sweepUnverified(
              {
                db,
                objects: wired.objects,
                pdf: wired.pdf,
                ocr: createFakeOcrText([specimen('lease-standard.md')]),
                ocrVersion: defaultOcrProcessorVersion,
                audit: wired.audit,
                clock: wired.clock,
                bucket: wired.bucket,
              },
              { documentIds: [result.documentId] },
            );
            assert.equal(report.examined, 1);
            assert.equal(report.verified, 1);
            assert.equal(report.unchanged, 0);
            assert.equal(report.failed, 0);
            const row = await db.query<{ verification_verdict: string }>(
              'SELECT verification_verdict FROM document WHERE document_id = $1',
              [result.documentId],
            );
            assert.equal(row.rows[0]?.verification_verdict, 'verified');
          });
        },
      );

      await t.test(
        'refuses a file that is none of the four kinds',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            await assert.rejects(
              fileDocument(deps(db, ['whatever']), {
                bytes: Buffer.from('PK\u0003\u0004 a zip of the whole folder'),
                typeKey: 'lease',
                place: { kind: 'UNIT', id: unitId },
                tenancyId: null,
              }),
              (error: KernelError) => {
                assert.equal(error.code, 'invalid');
                assert.match(error.message, /kinds we store/);
                return true;
              },
            );
            assert.equal(await documentCount(db, unitId), 0);
          });
        },
      );

      await t.test(
        'refuses a type that is retired, and one that is not a type',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            await db.query(
              "UPDATE document_type SET is_active = false WHERE type_key = 'lease'",
            );
            const request = {
              bytes: pdfBytes('lease'),
              place: { kind: 'UNIT' as const, id: newId() },
              tenancyId: null,
            };
            await assert.rejects(
              fileDocument(deps(db, [specimen('lease-standard.md')]), {
                ...request,
                typeKey: 'lease',
              }),
              /retired/,
            );
            await assert.rejects(
              fileDocument(deps(db, [specimen('lease-standard.md')]), {
                ...request,
                typeKey: 'not_a_type',
              }),
              /not a document type/,
            );
          });
        },
      );
    } finally {
      await pool.end();
    }
  });
});
