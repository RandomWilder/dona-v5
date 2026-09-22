// Slice 4.3. Promotion: mapped dates become tenancy columns; unmapped fields cannot.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { signedInChrome } from '../chrome.ts';
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
import {
  listTenancyEvents,
  upsertTenancy,
  upsertTermsProfile,
} from '../tenancy/contract.ts';
import type { ExtractedRow, IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  approveExtractedField,
  extractFiledDocument,
  fileDocument,
  listExtractedFields,
  listPromotedFieldsForUnit,
  numberWords,
  promoteExtractedField,
  renderFieldsPage,
  renderLeaseFilingPage,
  renderReadPage,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-07T09:00:00.000Z');
const NAV = signedInChrome('x'.repeat(64), 'documents', true);
const BUCKET = 'dona-v5-test-promote';
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
    [buildingId, `Promo ${buildingId.slice(24)}`],
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

/** Two readings: one with a mapping, one without. Slice 4.3's pair, still the pair. */
const READINGS: ExtractedRow[] = [
  {
    extractedFieldId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    documentTypeFieldId: 'aaaaaaaa-0000-4000-8000-000000000001',
    fieldKey: 'start_date',
    labelHe: 'תחילת תקופת השכירות',
    value: '2026-03-01',
    page: 1,
    bbox: { x: 10, y: 20, width: 40, height: 12 },
    confidence: null,
    model: 'gpt-test',
    promotionTarget: 'tenancy.start_date',
    promotedTo: null,
    promotedBy: null,
    promotedAt: null,
    approvedValue: null,
    approvedBy: null,
    approvedAt: null,
  },
  {
    extractedFieldId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    documentTypeFieldId: 'aaaaaaaa-0000-4000-8000-000000000002',
    fieldKey: 'apartment_number',
    labelHe: 'מספר הדירה',
    value: '12',
    page: 1,
    bbox: { x: 10, y: 40, width: 20, height: 12 },
    confidence: null,
    model: 'gpt-test',
    promotionTarget: null,
    promotedTo: null,
    promotedBy: null,
    promotedAt: null,
    approvedValue: null,
    approvedBy: null,
    approvedAt: null,
  },
];

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
        // start_date, end_date, new_end_date — two effective_from rows each (R18) — plus the
        // three track B copies and #141's rooms and floor (one SCHEMA_V6 row each).
        assert.equal(mappings.rows[0]?.n, '11');
        const extras = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM field_promotion p
             JOIN document_type_field f
               ON f.document_type_field_id = p.document_type_field_id
            WHERE f.field_key LIKE ANY($1::text[])`,
          [
            [
              'deposit%',
              'maintenance%',
              'promissory%',
              'signed_date',
              '%tenant_name',
              '%id_number',
              'gush',
              'helka',
              'building_number',
              'apartment_type',
              'has_storage',
              'storage_space_number',
            ],
          ],
        );
        assert.equal(extras.rows[0]?.n, '0');

        const unitId = await insertUnit(db);
        const profile = await upsertTermsProfile(
          db,
          `promo-${unitId.slice(24)}`,
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

        // **Slice 7.4: nothing reaches a typed column unsigned.** The reading is mapped, the
        // document is bound to a letting and the promoter is named — everything 4.3 asked for — and
        // it is still refused, because no person has said the reading is right. The rule's own case
        // is `tests/policy/promotion-approval.test.ts`; here it is the step this flow now has.
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
                promotedBy: 'אסף',
              },
            ),
          (error: KernelError) =>
            error.code === 'conflict' &&
            error.message.includes('has not been approved'),
        );
        await approveExtractedField(
          {
            db,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
          },
          {
            extractedFieldId: start?.extractedFieldId ?? '',
            approvedBy: 'אסף',
            mayReadIdentifiers: false,
          },
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
        const onUnitLog = await listTenancyEvents(db, unitId);
        assert.equal(onUnitLog.length, 1);
        assert.equal(onUnitLog[0]?.old_value, '2025-01-01');
        assert.equal(onUnitLog[0]?.new_value, '2026-03-01');
        assert.equal(onUnitLog[0]?.actor, 'אסף');
        assert.equal(onUnitLog[0]?.source_document_id, filed.documentId);
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

  it('sends promotion to the ledger, and leaves the pixels a reading', () => {
    // **Slice 7.3 moved the `קדם` control off this page.** It was here from 4.3, beside the values
    // it promoted; the approval ledger is now the screen where a reading is signed, corrected or
    // promoted, and two screens writing the same row is how the two drift into disagreeing about
    // which one is the flow. The overlay keeps what it was always for — where on the page did this
    // come from — and carries the link.
    const read = renderReadPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'pdfjs',
      mayReadIdentifiers: false,
      pageText: null,
      extracted: READINGS,
    });
    assert.doesNotMatch(read, /action="[^"]*\/promote"/);
    assert.doesNotMatch(read, /קדם · /);
    assert.match(
      read,
      /\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/fields/,
    );
    assert.match(read, /תחילת תקופת השכירות/);
    assert.doesNotMatch(read, /מתוך/);

    const ledger = renderFieldsPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      labelHe: 'חוזה שכירות',
      on: '2026-09-15',
      rows: READINGS,
      unread: [],
      mayReadIdentifiers: false,
      mayApprove: true,
    });
    // **Slice 7.4: unsigned, so no button.** `READINGS` carries no approval stamp, and a promotion
    // now requires one — a `קדם` whose only outcome is a refusal is not a control.
    assert.doesNotMatch(ledger, /קדם · תחילת תקופת השכירות/);
    assert.match(ledger, /קידום מחייב אישור תחילה/);

    const signed = renderFieldsPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      labelHe: 'חוזה שכירות',
      on: '2026-09-15',
      rows: READINGS.map((row) =>
        row.fieldKey === 'start_date'
          ? {
              ...row,
              approvedValue: row.value,
              approvedBy: 'אסף',
              approvedAt: AT,
            }
          : row,
      ),
      unread: [],
      mayReadIdentifiers: false,
      mayApprove: true,
    });
    assert.match(signed, /קדם · תחילת תקופת השכירות/);
    // An unmapped field is capturable, listed, signable — and still has nowhere to be promoted to.
    assert.doesNotMatch(signed, /קדם · מספר הדירה/);
    assert.doesNotMatch(signed, /name="promoted_by"/);

    const occupied = renderFieldsPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      labelHe: 'חוזה שכירות',
      on: '2026-09-22',
      rows: READINGS.map((row) =>
        row.fieldKey === 'start_date'
          ? {
              ...row,
              approvedValue: row.value,
              approvedBy: 'אסף',
              approvedAt: AT,
            }
          : row,
      ),
      unread: [],
      mayReadIdentifiers: false,
      mayApprove: true,
      overwrite: {
        extractedFieldId: READINGS[0]?.extractedFieldId ?? '',
        existingValue: '3.5',
      },
    });
    assert.match(occupied, /העמודה כבר נושאת/);
    assert.match(occupied, /3\.5/);
    assert.match(occupied, /החלף · תחילת תקופת השכירות/);
    assert.match(occupied, /name="supersede"/);
  });

  it('says when the reading did not cover the whole file', () => {
    const coverage = {
      pageCount: 21,
      pagesRead: 15,
    };
    const read = renderReadPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'ocr',
      mayReadIdentifiers: false,
      pageText: null,
      extracted: [],
      ...coverage,
    });
    assert.match(read, /15 מתוך 21/);
    const ledger = renderFieldsPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      labelHe: 'חוזה שכירות',
      on: '2026-09-15',
      rows: [],
      unread: [],
      mayReadIdentifiers: false,
      mayApprove: false,
      ...coverage,
    });
    assert.match(ledger, /15 מתוך 21/);
    const filing = renderLeaseFilingPage({
      nav: NAV,
      csrf: '',
      beat: 'read',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...coverage,
    });
    assert.match(filing, /15 מתוך 21/);
  });

  it('says the rest of the file is still being read', () => {
    const filing = renderLeaseFilingPage({
      nav: NAV,
      csrf: '',
      beat: 'read',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pageCount: 38,
      pagesRead: 15,
      readingPending: true,
    });
    assert.match(filing, /15 מתוך 38/);
    assert.match(filing, /הקריאה ממשיכה/);
    assert.match(filing, /aria-busy="true"/);
    assert.match(filing, /http-equiv="refresh"/);
    assert.doesNotMatch(
      renderLeaseFilingPage({
        nav: NAV,
        csrf: '',
        beat: 'read',
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        pageCount: 38,
        pagesRead: 15,
      }),
      /הקריאה ממשיכה/,
    );
    assert.doesNotMatch(
      renderLeaseFilingPage({
        nav: NAV,
        csrf: '',
        beat: 'read',
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        pageCount: 38,
        pagesRead: 15,
        readingPending: true,
        rows: READINGS,
      }),
      /http-equiv="refresh"/,
    );
  });

  it('links an extracted value to the page it was read from', () => {
    const fieldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const html = renderReadPage({
      nav: NAV,
      csrf: '',
      documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      buildingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      buildingName: 'בניין',
      unitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'ocr',
      mayReadIdentifiers: false,
      pageText: 'שכירות',
      extracted: [
        {
          extractedFieldId: fieldId,
          fieldKey: 'start_date',
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
          fieldKey: 'end_date',
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
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=1"/,
    );
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=2"/,
    );
    assert.match(html, /עמוד/);
    assert.doesNotMatch(html, /field-box/);
    assert.doesNotMatch(html, /#f-/);
    assert.match(html, /91%/);
  });
});
