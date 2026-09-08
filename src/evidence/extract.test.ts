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
  EXTRACT_INSTRUCTIONS,
  extractFiledDocument,
  fileDocument,
  listExtractedFields,
  numberWords,
  upsertDocumentTypeField,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-07T09:00:00.000Z');
const BUCKET = 'dona-v5-test-docs';
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

describe('evidence · extract into the declared schema', () => {
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
              value: `got:${field_key}`,
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
          'got:notice_days',
        );
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
});
