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
import { createMemoryStore, type ObjectStore } from '../kernel/objects.ts';
import {
  createFakeOcrText,
  defaultOcrProcessorVersion,
  type OcrText,
  onlineOcrByteLimit,
  onlineOcrPageLimit,
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

const BUCKET = 'dona-v5-test-intake';
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

/**
 * A store that counts what was put into it. `ObjectStore` has no `list` and deliberately no
 * `delete` (slice 3.2), so "no object was written" is proved the way `routes.test.ts` proves it:
 * by the number of puts across the call.
 */
function countingStore(): ObjectStore & { puts: number } {
  const inner = createMemoryStore();
  const counted = {
    ...inner,
    puts: 0,
    async put(path: string, bytes: Buffer, contentType: string) {
      counted.puts += 1;
      return inner.put(path, bytes, contentType);
    },
  };
  return counted;
}

function deps(
  db: PoolClient,
  text: string[],
  extra: { ocr?: OcrText; objects?: ObjectStore } = {},
): IntakeDeps {
  return {
    db,
    objects: extra.objects ?? createMemoryStore(),
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
        'the same file against a second place is refused, and names the flat it is anchored to',
        async () => {
          // **Slice 6.10, and this case is the inversion of 3.3's own.** It read *the same file
          // against a second place is one document with two links*, and its fixture text has said
          // `one lease, two flats claim it` since the day it was written. Two flats claiming one
          // lease is not a binding, it is a contradiction: the week-6 demo filed a second `SUBJECT`
          // link and the confirm screen then spoke about whichever of them the unordered `LIMIT 1`
          // returned — a flat the director had never opened. R13 is untouched (a document still
          // binds to a letting and to its signatories); the **place** is the one entity a document
          // has exactly one of, and it is the place its own `storage_uri` names.
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
            assert.equal(one.filed, true);
            if (!one.filed) return;
            const rowBefore = await db.query<{ verification_verdict: string }>(
              'SELECT verification_verdict FROM document WHERE document_id = $1',
              [one.documentId],
            );

            const two = await fileDocument(shared, {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: second },
              tenancyId: null,
            });

            assert.equal(two.filed, false);
            if (two.filed) return;
            assert.equal(two.refusal, 'anchored');
            // The sentence the screen needs: *which* flat, not merely that there is one.
            assert.deepEqual(two.anchoredTo, { kind: 'UNIT', id: first });

            // Nothing was written — the same statement 3.3 makes about a caught upload, for a
            // different cause. No second link, no second object, and the document row untouched:
            // the refusal is *before* `ingestDocument`, whose `DO UPDATE` would otherwise have
            // rewritten the verdict and the type of a row this caller was refused.
            const links = await db.query<{ n: string }>(
              'SELECT count(*)::text AS n FROM document_link WHERE document_id = $1',
              [one.documentId],
            );
            assert.equal(links.rows[0]?.n, '1');
            const rowAfter = await db.query<{ verification_verdict: string }>(
              'SELECT verification_verdict FROM document WHERE document_id = $1',
              [one.documentId],
            );
            assert.equal(
              rowAfter.rows[0]?.verification_verdict,
              rowBefore.rows[0]?.verification_verdict,
            );
            await assert.rejects(
              shared.objects.read(
                `unit/${second}/lease/${one.storageUri.slice(-68)}`,
              ),
              /object not found/,
            );

            // On the record, and it counts against the day's cap: the bound is on what reached
            // intake, not on what survived it (SPEC-evidence.md).
            const lines = await auditLines(db, second);
            assert.equal(lines.length, 1);
            assert.equal(lines[0]?.outcome, 'error');
          });
        },
      );

      await t.test(
        'the same file against the same place is still one document and the link it came to add',
        async () => {
          // The other half of 6.10's ruling, and the half that keeps R13 true: a second filing
          // against the flat the document is already anchored to is the ordinary case — a lease
          // filed loose and then filed again against a letting — and it still adds its link.
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            const unitId = newId();
            const tenancyId = newId();
            const bytes = pdfBytes('one lease, one flat, filed twice');
            const shared = deps(db, [specimen('lease-standard.md')]);

            const one = await fileDocument(shared, {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            const two = await fileDocument(shared, {
              bytes,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId,
            });

            assert.equal(one.filed && two.filed, true);
            if (!one.filed || !two.filed) return;
            assert.equal(two.documentId, one.documentId);
            assert.equal(two.inserted, false);
            assert.equal(two.storageUri, one.storageUri);

            const links = await db.query<{
              entity_type: string;
              entity_id: string;
            }>(
              `SELECT entity_type, entity_id FROM document_link
                WHERE document_id = $1 ORDER BY entity_type`,
              [one.documentId],
            );
            assert.deepEqual(
              links.rows.map((link) => `${link.entity_type}:${link.entity_id}`),
              [`TENANCY:${tenancyId}`, `UNIT:${unitId}`],
            );
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
        'OCRs a photograph before filing it, and the row goes in verified',
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
            // **Changed deliberately at 6.8, and this is the assertion that says so.** The row used
            // to go in `unverified` and be promoted a moment later by a second reader, with an
            // `evidence.read_document` line recording the move. The reason for that order was that
            // a refused upload must write nothing — but a reading taken *before* the write satisfies
            // that too, and then there is one verdict rather than two and one line rather than two.
            const filed = await auditLines(db, unitId);
            assert.equal(filed[0]?.inputs.verdict, 'verified');
            assert.equal(filed[0]?.inputs.ocr, 'ok');
            const promoted = await db.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM audit_log
                WHERE action = 'evidence.read_document' AND subject_id = $1`,
              [unitId],
            );
            assert.equal(
              promoted.rows[0]?.n,
              '0',
              'nothing was promoted, because nothing was filed unread',
            );
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
        'OCRs a scan whose own text layer does not carry the type’s terms',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // **Slice 6.8, and this is the week-6 demo.** The file was a lease scanned on a phone,
            // and CamScanner had left a text layer of its own on it. OCR ran only when a PDF had
            // *no* text layer, so that layer permanently outranked Document AI: the demo's four
            // refusals took 0.43–1.31s each, against 7.07–7.40s for the one file with no layer,
            // which is the difference between a decision and a call.
            //
            // The condition is now the declared type's terms rather than emptiness, and the reading
            // happens once, before anything is written.
            const unitId = newId();
            let called = 0;
            const ocr: OcrText = {
              async pages(...args) {
                called += 1;
                return createFakeOcrText([specimen('lease-standard.md')]).pages(
                  ...args,
                );
              },
              describe: () => 'fake',
            };
            const result = await fileDocument(
              deps(db, ['הסכם שכירות סרוק בטלפון ואין בו את מילות הטופס'], {
                ocr,
              }),
              {
                bytes: pdfBytes('phone scan with a text layer'),
                typeKey: 'lease',
                place: { kind: 'UNIT', id: unitId },
                tenancyId: null,
              },
            );
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'verified');
            // Once. 6.4's bar is not relaxed by moving the call earlier.
            assert.equal(called, 1);
            const row = await db.query<{ verification_verdict: string }>(
              'SELECT verification_verdict FROM document WHERE document_id = $1',
              [result.documentId],
            );
            // Written `verified` at once, rather than written `unverified` and promoted after. The
            // reading was taken before anything was written, which is what the old order existed
            // to guarantee and did not need a second reader to achieve.
            assert.equal(row.rows[0]?.verification_verdict, 'verified');
            const lines = await auditLines(db, unitId);
            assert.equal(lines[0]?.inputs.verdict, 'verified');
            assert.equal(lines[0]?.inputs.ocr, 'ok');
          });
        },
      );

      await t.test(
        'refuses a file carrying none of the vocabulary, even after OCR, and writes nothing',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // The half that is not traded away for the match. OCR is spent, the better reading is
            // taken, and the file is still not a lease — so it is refused and nothing is written:
            // no row, no object. 3.3's proof shape, on the path 6.8 rearranged.
            const unitId = newId();
            const objects = countingStore();
            const wired = deps(db, ['חשבון ארנונה למחזיק בנכס'], {
              objects,
              ocr: createFakeOcrText([specimen('arnona-bill.md')]),
            });
            const result = await fileDocument(wired, {
              bytes: pdfBytes('an arnona bill scanned'),
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, false);
            if (result.filed) return;
            assert.equal(result.verification.verdict, 'refused');
            assert.equal(await documentCount(db, unitId), 0);
            assert.equal(objects.puts, 0, 'no object was written');
            const lines = await auditLines(db, unitId);
            assert.equal(lines[0]?.outcome, 'error');
            assert.equal(lines[0]?.inputs.ocr, 'ok');
          });
        },
      );

      await t.test(
        'reads the first pages of a document longer than the online reader takes',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // **The week-6 demo's own file, as a shape. Slice 6.8.** It is 38 pages and the online
            // processor takes 15, so until this slice it was never sent at all and the row was
            // filed as though somebody had looked at it. `individualPageSelector` is the way
            // through — measured against the live processor before it was written: that file,
            // pages 1-15, came back 200 with fifteen pages in 36.4s.
            //
            // The paper's own words are on page 1, which is why reading the front of a document
            // answers both questions being asked: what kind of document is this, and where does it
            // belong. `pagesRead` is what keeps `verified` honest about how much was read.
            const unitId = newId();
            let asked: readonly number[] | undefined;
            const reader = createFakeOcrText([
              specimen('lease-standard.md'),
              ...Array.from(
                { length: onlineOcrPageLimit + 5 },
                (_, at) => `נספח ${at + 1}`,
              ),
            ]);
            const ocr: OcrText = {
              describe: () => 'fake',
              pages: async (bytes, mime, version, pages) => {
                asked = pages;
                return reader.pages(bytes, mime, version, pages);
              },
            };
            const long = Array.from(
              { length: onlineOcrPageLimit + 6 },
              (_, at) => `עמוד ${at + 1} של סריקה ארוכה ללא שכבת טקסט שמישה`,
            );
            const result = await fileDocument(deps(db, long, { ocr }), {
              bytes: pdfBytes('a long phone scan'),
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
            });
            assert.equal(result.filed, true);
            if (!result.filed) return;
            assert.equal(result.verification.verdict, 'verified');
            assert.deepEqual(
              asked,
              Array.from({ length: onlineOcrPageLimit }, (_, at) => at + 1),
              'the first fifteen pages, by their own numbers',
            );
            const lines = await auditLines(db, unitId);
            assert.equal(lines[0]?.inputs.ocr, 'partial');
            assert.equal(lines[0]?.inputs.pages, onlineOcrPageLimit + 6);
            assert.equal(lines[0]?.inputs.pagesRead, onlineOcrPageLimit);
          });
        },
      );

      await t.test(
        'refuses a file too large for the reader to carry, with a sentence that says so',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // Size, not length. The bound is on the *request* and the whole file rides in every
            // one of them, so selecting fewer pages does not make a large file fit — there is no
            // reading to be had at any page count. Filing it would write a verdict about a document
            // nobody has seen a page of, so it is refused and nothing is written.
            const unitId = newId();
            let called = 0;
            const ocr: OcrText = {
              async pages() {
                called += 1;
                return { pages: [], images: [] };
              },
              describe: () => 'fake',
            };
            const objects = countingStore();
            const huge = Buffer.concat([
              pdfBytes('a huge scan'),
              Buffer.alloc(onlineOcrByteLimit, 0x20),
            ]);
            const result = await fileDocument(
              deps(db, ['סריקה ללא מילות הטופס'], { ocr, objects }),
              {
                bytes: huge,
                typeKey: 'lease',
                place: { kind: 'UNIT', id: unitId },
                tenancyId: null,
              },
            );
            assert.equal(result.filed, false);
            if (result.filed) return;
            assert.equal(result.refusal, 'too_large');
            assert.equal(called, 0, 'the call was declined, not attempted');
            assert.equal(await documentCount(db, unitId), 0);
            assert.equal(objects.puts, 0, 'no object was written');
            const lines = await auditLines(db, unitId);
            assert.equal(lines[0]?.inputs.ocr, 'too_large');
          });
        },
      );

      await t.test(
        'tells an OCR failure from an OCR miss, by count on the audit line',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await applyDocumentTypeCatalogue(db, seedDocumentTypes);
            // `catch { return null }` made a reader that broke look exactly like a reader that
            // found nothing, and both looked like a file with no text layer. Three different facts,
            // one row in the log. They are three values now, asserted by count rather than by
            // reading a page.
            const broken: OcrText = {
              async pages() {
                throw new KernelError('unavailable', 'the ocr call timed out', {
                  timeoutMs: 20_000,
                });
              },
              describe: () => 'fake',
            };
            const places = {
              failed: newId(),
              miss: newId(),
              unconfigured: newId(),
            };
            await fileDocument(deps(db, [], { ocr: broken }), {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: places.failed },
              tenancyId: null,
            });
            await fileDocument(deps(db, [], { ocr: createFakeOcrText([]) }), {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: places.miss },
              tenancyId: null,
            });
            await fileDocument(deps(db, []), {
              bytes: PNG,
              typeKey: 'lease',
              place: { kind: 'UNIT', id: places.unconfigured },
              tenancyId: null,
            });
            const outcome = async (placeId: string): Promise<unknown> =>
              (await auditLines(db, placeId))[0]?.inputs.ocr;
            assert.equal(await outcome(places.failed), 'failed');
            assert.equal(await outcome(places.miss), 'ok');
            assert.equal(await outcome(places.unconfigured), 'unconfigured');
            // All three are still filed and all three are still `unverified`: the difference is
            // what the log can tell an operator afterwards, not what the screen does now.
            const verdicts = await Promise.all(
              Object.values(places).map(
                async (placeId) =>
                  (await auditLines(db, placeId))[0]?.inputs.verdict,
              ),
            );
            assert.deepEqual(verdicts, [
              'unverified',
              'unverified',
              'unverified',
            ]);
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
