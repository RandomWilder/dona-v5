// Slice 4.2. Comprehension into the declared schema.
//
// Fake extractor, real Postgres, rolled back. No live model call. The claims are: a new field
// on the type is extracted with no DDL, and stored geometry comes from the numbered words, not
// from the model reply.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import {
  createFakeExtractor,
  createUnconfiguredExtractor,
} from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  declareDocumentTypeField,
  EXTRACT_INSTRUCTIONS,
  extractFiledDocument,
  fileDocument,
  listExtractedFields,
  mapFieldsFromWords,
  numberWords,
  upsertDocumentTypeField,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-07T09:00:00.000Z');
// The same day, as the catalogue's date parameter reads it. Slice 7.2's case declares a field on
// the day the document it is extracted from is filed, which is the case an administrator has.
const TODAY = '2026-09-07';
const BUCKET = 'dona-v5-test-extract';
/** The marker value for each NUMBER field the `lease` type declares, plus the one this suite adds. */
const NUMERIC_MARKERS: Record<string, string> = {
  notice_days: '14',
  rent_amount: '12500',
  deposit_amount: '25000',
};
const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

function wordsOf(text: string) {
  return numberWords([
    {
      number: 1,
      width: 595,
      height: 842,
      items: text
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word, at) => ({
          text: word,
          x: at * 10,
          y: 20,
          width: word.length * 5,
          height: 12,
          rightToLeft: true,
          endsLine: false,
          confidence: 0.9,
        })),
    },
  ]);
}

const ONE_FIELD = [
  {
    documentTypeFieldId: 'field-1',
    fieldKey: 'apartment_number',
    labelHe: 'דירה',
    valueType: 'TEXT' as const,
    isRequired: false,
    extractionHint: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  },
];

describe('evidence · extract into the declared schema', () => {
  it('hands the mapping model each word as id, page, text and a 0–1000 origin', async () => {
    const extractor = createFakeExtractor(() => ({ findings: [] }));
    await mapFieldsFromWords(
      { extractor, model: 'gpt-test' },
      {
        fields: ONE_FIELD,
        words: [
          {
            id: 0,
            page: 1,
            text: 'דירה',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            confidence: 0.91,
            pageWidth: 200,
            pageHeight: 400,
          },
          {
            id: 1,
            page: 1,
            text: '14',
            x: 90,
            y: 180,
            width: 10,
            height: 20,
            confidence: 0.88,
            pageWidth: 200,
            pageHeight: 400,
          },
          {
            id: 2,
            page: 2,
            text: 'נספח',
            x: 50,
            y: 25,
            width: 50,
            height: 25,
            confidence: 0.7,
            pageWidth: 100,
            pageHeight: 50,
          },
        ],
      },
    );
    const request = extractor.calls[0];
    assert.ok(request);
    const payload = JSON.parse(request.input) as {
      words: Array<Record<string, unknown>>;
    };
    assert.deepEqual(payload.words, [
      { id: 0, page: 1, text: 'דירה', x: 0, y: 0 },
      { id: 1, page: 1, text: '14', x: 450, y: 450 },
      { id: 2, page: 2, text: 'נספח', x: 500, y: 500 },
    ]);
    for (const word of payload.words) {
      assert.equal('width' in word, false);
      assert.equal('height' in word, false);
      assert.equal('confidence' in word, false);
      assert.equal('pageWidth' in word, false);
      assert.equal('pageHeight' in word, false);
      assert.equal(Number.isInteger(word.x), true);
      assert.equal(Number.isInteger(word.y), true);
      assert.ok((word.x as number) >= 0 && (word.x as number) <= 1000);
      assert.ok((word.y as number) >= 0 && (word.y as number) <= 1000);
    }
  });

  it('falls back to the occupied page hull when a capture has no page size', async () => {
    const extractor = createFakeExtractor(() => ({ findings: [] }));
    await mapFieldsFromWords(
      { extractor, model: 'gpt-test' },
      {
        fields: ONE_FIELD,
        words: [
          {
            id: 0,
            page: 1,
            text: '14',
            x: 90,
            y: 180,
            width: 10,
            height: 20,
            confidence: 0.88,
          },
        ],
      },
    );
    const payload = JSON.parse(extractor.calls[0]?.input ?? '{}') as {
      words: Array<{ x: number; y: number }>;
    };
    assert.deepEqual(payload.words[0], {
      id: 0,
      page: 1,
      text: '14',
      x: 900,
      y: 900,
    });
  });

  it('adds a field mid-test and re-extracts it with no DDL', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const extractor = createFakeExtractor((request) => {
          const schema = request.schema as {
            properties: {
              findings: {
                items: { properties: { field_key: { enum: string[] } } };
              };
            };
          };
          const keys =
            schema.properties.findings.items.properties.field_key.enum;
          return {
            findings: keys.map((field_key) => ({
              field_key,
              // **A NUMBER declaration stores a bare number** (ticket #101), so `got:notice_days`
              // is dropped at capture and this case would go green for the wrong reason. The
              // marker for a numeric field is a number; every other `lease` field is TEXT or DATE
              // and keeps the string marker (a DATE one is dropped, which is 4.2's own rule).
              value: NUMERIC_MARKERS[field_key] ?? `got:${field_key}`,
              word_ids: [0],
            })),
          };
        });
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor,
            extractModel: 'gpt-test',
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-add-field'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        const first = await listExtractedFields(db, filed.documentId);
        assert.equal(
          first.some((row) => row.fieldKey === 'notice_days'),
          false,
        );

        const type = await db.query<{ document_type_id: string }>(
          `SELECT document_type_id FROM document_type WHERE type_key = 'lease'`,
        );
        await upsertDocumentTypeField(db, {
          documentTypeId: type.rows[0]?.document_type_id ?? '',
          fieldKey: 'notice_days',
          labelHe: 'ימי הודעה',
          valueType: 'NUMBER',
          isRequired: false,
          extractionHint: 'הודעה',
          effectiveFrom: '2026-09-07',
          effectiveTo: null,
        });

        const columns = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM information_schema.columns
            WHERE table_name = 'extracted_field'`,
        );
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            model: 'gpt-test',
          },
          {
            documentId: filed.documentId,
            words: wordsOf('חוזה שכירות המושכר תקופת השכירות השוכר'),
          },
        );
        const afterColumns = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM information_schema.columns
            WHERE table_name = 'extracted_field'`,
        );
        assert.equal(afterColumns.rows[0]?.n, columns.rows[0]?.n);
        const second = await listExtractedFields(db, filed.documentId);
        assert.equal(
          second.some((row) => row.fieldKey === 'notice_days'),
          true,
        );
        assert.equal(
          second.find((row) => row.fieldKey === 'notice_days')?.value,
          NUMERIC_MARKERS.notice_days,
        );
      });
    } finally {
      await pool.end();
    }
  });

  // **Slice 7.2.** The case above proves the mechanism through `upsertDocumentTypeField`, which is
  // the seed's path — the one that costs a commit and a deploy. This proves the same thing through
  // the path an administrator has from A14, and it is the acceptance bullet `tasks/todo.md` writes
  // as *an ADMIN adds a field, a lease is re-filed, and the new field is extracted against the new
  // declaration*. The fake extractor is what makes it runnable with no API key: what is under test
  // is the target list handed to the model, not the model.
  it('extracts a field an administrator declared at run time', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        // The declaration the screen would write, on the day the document is filed.
        const declared = await declareDocumentTypeField(db, {
          typeKey: 'lease',
          fieldKey: 'city',
          labelHe: 'עיר המושכר',
          valueType: 'TEXT',
          isRequired: false,
          extractionHint: 'עיר בלבד, לא הרחוב',
          on: TODAY,
        });
        let asked: string[] = [];
        const extractor = createFakeExtractor((request) => {
          const schema = request.schema as {
            properties: {
              findings: {
                items: { properties: { field_key: { enum: string[] } } };
              };
            };
          };
          asked = schema.properties.findings.items.properties.field_key.enum;
          return {
            findings: [{ field_key: 'city', value: 'שוהם', word_ids: [0] }],
          };
        });
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor,
            extractModel: 'gpt-test',
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-declared-at-runtime'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        // **The declaration reached the model's target list**, which is the whole claim: the
        // catalogue is read at run time and a field declared five seconds ago is one the reader
        // looks for.
        assert.ok(asked.includes('city'), `city not in [${asked.join(', ')}]`);

        const rows = await listExtractedFields(db, filed.documentId);
        const city = rows.find((row) => row.fieldKey === 'city');
        assert.equal(city?.value, 'שוהם');
        // And the value points at **the declaration that governed it** — the row the administrator
        // wrote, not the type. That pointer is what makes R18's promise mean anything.
        const pointer = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM extracted_field
            WHERE document_id = $1 AND document_type_field_id = $2`,
          [filed.documentId, declared.documentTypeFieldId],
        );
        assert.equal(pointer.rows[0]?.n, '1');
      });
    } finally {
      await pool.end();
    }
  });

  it('stores the word-union box even when the model invents coordinates', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const words = wordsOf('חוזה שכירות המושכר דירה 14');
        const first = words[0];
        assert.ok(first);
        const extractor = createFakeExtractor((request) => {
          const blob = JSON.stringify(request.schema);
          assert.equal(blob.includes('"bbox"'), false);
          assert.equal(blob.includes('"confidence"'), false);
          assert.equal(/"page"/.test(blob), false);
          return {
            findings: [
              {
                field_key: 'apartment_number',
                value: '14',
                word_ids: [first.id],
                page: 99,
                bbox: { x: 0, y: 0, width: 1, height: 1 },
                confidence: 0.11,
              },
            ],
          };
        });
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-bbox'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            model: 'gpt-test',
          },
          { documentId: filed.documentId, words },
        );
        const rows = await listExtractedFields(db, filed.documentId);
        const apartment = rows.find(
          (row) => row.fieldKey === 'apartment_number',
        );
        assert.ok(apartment);
        assert.equal(apartment.value, '14');
        assert.equal(apartment.page, first.page);
        assert.equal(apartment.confidence, first.confidence);
        assert.deepEqual(apartment.bbox, {
          x: first.x,
          y: first.y,
          width: first.width,
          height: first.height,
        });
        assert.notEqual(apartment.bbox.width, 1);
        assert.notEqual(apartment.confidence, 0.11);
      });
    } finally {
      await pool.end();
    }
  });

  it('files with an unconfigured extractor and writes no extracted rows', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
            extractModel: 'gpt-test',
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-none'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        assert.equal(filed.verification.verdict, 'verified');
        const rows = await listExtractedFields(db, filed.documentId);
        assert.equal(rows.length, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('tells the model not to swap building number and apartment number', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const afterHint = new Date('2026-09-08T09:00:00.000Z');
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const extractor = createFakeExtractor(() => ({ findings: [] }));
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(afterHint)),
            clock: fixedClock(afterHint),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-place-hints'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(afterHint)),
            clock: fixedClock(afterHint),
            model: 'gpt-test',
          },
          {
            documentId: filed.documentId,
            words: wordsOf('בניין מספר 12 דירה מספר 4'),
          },
        );
        const request = extractor.calls[0];
        assert.ok(request);
        assert.equal(request.instructions, EXTRACT_INSTRUCTIONS);
        assert.match(request.instructions, /בניין מספר/);
        assert.match(request.instructions, /דירה מספר/);
        const payload = JSON.parse(request.input) as {
          fields: Array<{ field_key: string; extraction_hint: string | null }>;
        };
        const apartment = payload.fields.find(
          (field) => field.field_key === 'apartment_number',
        );
        const address = payload.fields.find(
          (field) => field.field_key === 'address',
        );
        assert.ok(apartment);
        assert.ok(address);
        assert.match(apartment.extraction_hint ?? '', /דירה מספר/);
        assert.doesNotMatch(apartment.extraction_hint ?? '', /^המושכר$/);
        assert.match(address.extraction_hint ?? '', /בניין מספר/);
        assert.match(request.instructions, /YYYY-MM-DD/);
        const start = payload.fields.find(
          (field) => field.field_key === 'start_date',
        );
        assert.ok(start);
        assert.match(start.extraction_hint ?? '', /YYYY-MM-DD/);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps an ISO date and drops Hebrew or slash-shaped DATE values', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const words = wordsOf('15 בספטמבר 2026 2027-09-14');
        const extractor = createFakeExtractor(() => ({
          findings: [
            {
              field_key: 'start_date',
              value: '15 בספטמבר 2026',
              word_ids: [0],
            },
            {
              field_key: 'end_date',
              value: '2027-09-14',
              word_ids: [words.length - 1],
            },
            {
              field_key: 'apartment_number',
              value: '08/09/2026',
              word_ids: [0],
            },
          ],
        }));
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-iso-date'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            model: 'gpt-test',
          },
          { documentId: filed.documentId, words },
        );
        const rows = await listExtractedFields(db, filed.documentId);
        assert.equal(
          rows.find((row) => row.fieldKey === 'start_date'),
          undefined,
        );
        assert.equal(
          rows.find((row) => row.fieldKey === 'end_date')?.value,
          '2027-09-14',
        );
        assert.equal(
          rows.find((row) => row.fieldKey === 'apartment_number')?.value,
          '08/09/2026',
        );
      });
    } finally {
      await pool.end();
    }
  });

  // **Ticket #101.** The rent is a value like any other now that foundation rule 2 is retired
  // (`docs/decisions/ADR-0008-money-is-ordinary-data.md`), and the thing that makes it *usable* is
  // that capture keeps the number and drops the paper. `12,500 ₪` is a printed rent; `12500` is a
  // rent. The currency is the field beside it and is never inferred from the symbol stripped here.
  //
  // The clock is after 2026-09-15 because that is the `effective_from` the four amount declarations
  // open at, and a field is not live on a day before its declaration (R18).
  it('captures a printed amount as a bare number, and its currency beside it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const AFTER = new Date('2026-09-16T09:00:00.000Z');
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const words = wordsOf('12,500 ₪ 25.000 ש"ח USD 3,000.00');
        const extractor = createFakeExtractor(() => ({
          findings: [
            // A thousands separator and a trailing currency sign, which is how every lease in the
            // corpus prints the rent.
            { field_key: 'rent_amount', value: '12,500 ₪', word_ids: [0, 1] },
            { field_key: 'rent_currency', value: 'ILS', word_ids: [1] },
            // A European separator on the same page. `25.000` is twenty-five thousand and not
            // twenty-five, and the deposit is priced in a second currency on purpose.
            {
              field_key: 'deposit_amount',
              value: '₪ 25.000',
              word_ids: [2, 3],
            },
            { field_key: 'deposit_currency', value: 'USD', word_ids: [4] },
          ],
        }));
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AFTER)),
            clock: fixedClock(AFTER),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-amount'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(AFTER)),
            clock: fixedClock(AFTER),
            model: 'gpt-test',
          },
          { documentId: filed.documentId, words },
        );
        const rows = await listExtractedFields(db, filed.documentId);
        const captured = (fieldKey: string) =>
          rows.find((row) => row.fieldKey === fieldKey)?.value;
        assert.equal(captured('rent_amount'), '12500');
        assert.equal(captured('deposit_amount'), '25000');
        // The currency is text and is stored as it came: the symbol was stripped off the amount and
        // is not what decides this.
        assert.equal(captured('rent_currency'), 'ILS');
        assert.equal(captured('deposit_currency'), 'USD');
      });
    } finally {
      await pool.end();
    }
  });

  // A NUMBER finding with nothing numeric in it is dropped, which is what a DATE that is not a
  // calendar day already does: no row, and a missing value is a result rather than an error.
  it('drops a NUMBER finding that is not a number at all', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const AFTER = new Date('2026-09-16T09:00:00.000Z');
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const words = wordsOf('לפי סיכום בעל פה');
        const extractor = createFakeExtractor(() => ({
          findings: [
            {
              field_key: 'rent_amount',
              value: 'לפי סיכום בעל פה',
              word_ids: [0, 1, 2, 3],
            },
          ],
        }));
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText(['חוזה שכירות המושכר תקופת השכירות השוכר']),
            audit: createAuditLog(db, fixedClock(AFTER)),
            clock: fixedClock(AFTER),
            bucket: BUCKET,
            extractor: createUnconfiguredExtractor(),
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('extract-amount-unreadable'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: newId() },
            tenancyId: null,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;
        await extractFiledDocument(
          {
            db,
            extractor,
            audit: createAuditLog(db, fixedClock(AFTER)),
            clock: fixedClock(AFTER),
            model: 'gpt-test',
          },
          { documentId: filed.documentId, words },
        );
        const rows = await listExtractedFields(db, filed.documentId);
        assert.equal(
          rows.find((row) => row.fieldKey === 'rent_amount'),
          undefined,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
