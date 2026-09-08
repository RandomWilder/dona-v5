// Slice 4.3. Promotion: mapped dates become tenancy columns; unmapped fields cannot.
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
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  extractFiledDocument,
  fileDocument,
  listExtractedFields,
  listPromotedFieldsForUnit,
  numberWords,
  promoteExtractedField,
  renderReadPage,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-07T09:00:00.000Z');
const BUCKET = 'dona-v5-test-docs';
const MARKERS = 'חוזה שכירות המושכר תקופת השכירות השוכר';

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

async function insertUnit(db: PoolClient): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'promo-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Promo ${buildingId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 12')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '12', 3.5, true, 'READY')`,
    [unitId],
  );
  return unitId;
}

describe('evidence · promote an extracted field', () => {
  it('copies a mapped date, stamps the row, and refuses an unmapped field', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const mappings = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM field_promotion`,
        );
        assert.equal(mappings.rows[0]?.n, '3');

        const unitId = await insertUnit(db);
        const profile = await upsertTermsProfile(
          db,
          `promo-${unitId.slice(0, 8)}`,
        );
        const tenancy = await upsertTenancy(db, {
          unitId,
          startDate: '2025-01-01',
          endDate: '2026-12-31',
          status: 'ACTIVE',
          termsProfileId: profile.id,
          noticeDate: null,
          actualMoveOut: null,
        });

        const extractor = createFakeExtractor(() => ({
          findings: [
            {
              field_key: 'start_date',
              value: '2026-03-01',
              word_ids: [0],
            },
            {
              field_key: 'end_date',
              value: '2027-02-28',
              word_ids: [1],
            },
            {
              field_key: 'apartment_number',
              value: '12',
              word_ids: [2],
            },
          ],
        }));
        const filed = await fileDocument(
          {
            db,
            objects: createMemoryStore(),
            pdf: createFakePdfText([MARKERS]),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            bucket: BUCKET,
            extractor,
            extractModel: 'gpt-test',
          } satisfies IntakeDeps,
          {
            bytes: pdfBytes('promote-mapped'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: unitId },
            tenancyId: tenancy.id,
          },
        );
        assert.equal(filed.filed, true);
        if (!filed.filed) return;

        const rows = await listExtractedFields(db, filed.documentId);
        const start = rows.find((row) => row.fieldKey === 'start_date');
        const apartment = rows.find(
          (row) => row.fieldKey === 'apartment_number',
        );
        assert.equal(start?.promotionTarget, 'tenancy.start_date');
        assert.equal(apartment?.promotionTarget, null);

        await assert.rejects(
          () =>
            promoteExtractedField(
              {
                db,
                audit: createAuditLog(db, fixedClock(AT)),
                clock: fixedClock(AT),
              },
              {
                extractedFieldId: apartment?.extractedFieldId ?? '',
                promotedBy: 'אסף',
              },
            ),
          (error: KernelError) =>
            error.code === 'invalid' &&
            error.message.includes('business truth'),
        );
        const unchanged = await db.query<{ start_date: string }>(
          `SELECT start_date::text FROM tenancy WHERE tenancy_id = $1`,
          [tenancy.id],
        );
        assert.equal(unchanged.rows[0]?.start_date, '2025-01-01');

        await assert.rejects(
          () =>
            promoteExtractedField(
              {
                db,
                audit: createAuditLog(db, fixedClock(AT)),
                clock: fixedClock(AT),
              },
              {
                extractedFieldId: start?.extractedFieldId ?? '',
                promotedBy: '   ',
              },
            ),
          (error: KernelError) => error.code === 'invalid',
        );

        const promoted = await promoteExtractedField(
          {
            db,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
          },
          {
            extractedFieldId: start?.extractedFieldId ?? '',
            promotedBy: 'אסף',
          },
        );
        assert.equal(promoted.target, 'tenancy.start_date');
        const after = await db.query<{ start_date: string }>(
          `SELECT start_date::text FROM tenancy WHERE tenancy_id = $1`,
          [tenancy.id],
        );
        assert.equal(after.rows[0]?.start_date, '2026-03-01');
        const events = await db.query<{
          field: string;
          old_value: string;
          new_value: string;
          actor: string;
        }>(
          `SELECT field, old_value, new_value, actor FROM tenancy_event
            WHERE tenancy_id = $1`,
          [tenancy.id],
        );
        assert.equal(events.rows.length, 1);
        assert.deepEqual(events.rows[0], {
          field: 'start_date',
          old_value: '2025-01-01',
          new_value: '2026-03-01',
          actor: 'אסף',
        });
        const stamped = await listExtractedFields(db, filed.documentId);
        assert.equal(
          stamped.find((row) => row.fieldKey === 'start_date')?.promotedTo,
          'tenancy.start_date',
        );
        const onUnit = await listPromotedFieldsForUnit(db, unitId);
        assert.equal(onUnit.length, 1);
        assert.equal(onUnit[0]?.value, '2026-03-01');
        assert.equal(onUnit[0]?.extractedFieldId, start?.extractedFieldId);
        const other = newId();
        assert.equal((await listPromotedFieldsForUnit(db, other)).length, 0);

        await extractFiledDocument(
          {
            db,
            extractor: createFakeExtractor(() => ({
              findings: [
                {
                  field_key: 'apartment_number',
                  value: '12',
                  word_ids: [0],
                },
              ],
            })),
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
            model: 'gpt-test',
          },
          {
            documentId: filed.documentId,
            words: wordsOf(MARKERS),
          },
        );
        const kept = await listExtractedFields(db, filed.documentId);
        assert.equal(
          kept.find((row) => row.fieldKey === 'start_date')?.promotedTo,
          'tenancy.start_date',
        );
        assert.equal(
          kept.some((row) => row.fieldKey === 'end_date'),
          false,
        );
        assert.equal(
          kept.find((row) => row.fieldKey === 'apartment_number')?.promotedTo ??
            null,
          null,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('shows unmapped values as capture-only and a promote control for mapped ones', () => {
    const html = renderReadPage({
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'pdfjs',
      page: null,
      image: null,
      extracted: [
        {
          extractedFieldId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          labelHe: 'תחילת תקופת השכירות',
          value: '2026-03-01',
          page: 1,
          bbox: { x: 10, y: 20, width: 40, height: 12 },
          confidence: null,
          promotionTarget: 'tenancy.start_date',
          promotedTo: null,
        },
        {
          extractedFieldId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          labelHe: 'מספר הדירה',
          value: '12',
          page: 1,
          bbox: { x: 10, y: 40, width: 20, height: 12 },
          confidence: null,
          promotionTarget: null,
          promotedTo: null,
        },
      ],
    });
    assert.match(html, /נקרא בלבד/);
    assert.match(html, /קדם · תחילת תקופת השכירות/);
    assert.match(html, /name="promoted_by"/);
    assert.doesNotMatch(html, /קדם · מספר הדירה/);
  });

  it('links an extracted value to its pixels on that page', () => {
    const fieldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const html = renderReadPage({
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'ocr',
      page: {
        number: 1,
        width: 100,
        height: 200,
        items: [
          {
            text: 'שכירות',
            x: 8,
            y: 18,
            width: 20,
            height: 10,
            rightToLeft: true,
            endsLine: false,
            confidence: 0.91,
          },
        ],
      },
      image: null,
      extracted: [
        {
          extractedFieldId: fieldId,
          labelHe: 'תחילת תקופת השכירות',
          value: '2026-03-01',
          page: 1,
          bbox: { x: 10, y: 20, width: 40, height: 12 },
          confidence: 0.91,
          promotionTarget: 'tenancy.start_date',
          promotedTo: 'tenancy.start_date',
        },
        {
          extractedFieldId: otherId,
          labelHe: 'סיום',
          value: '2027-02-28',
          page: 2,
          bbox: { x: 10, y: 80, width: 40, height: 12 },
          confidence: null,
          promotionTarget: 'tenancy.end_date',
          promotedTo: null,
        },
      ],
    });
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=1#f-dddddddd-dddd-4ddd-8ddd-dddddddddddd"/,
    );
    assert.match(html, /id="f-dddddddd-dddd-4ddd-8ddd-dddddddddddd"/);
    assert.match(html, /field-box/);
    assert.match(html, /91%/);
    assert.doesNotMatch(html, /id="f-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"/);
  });
});
