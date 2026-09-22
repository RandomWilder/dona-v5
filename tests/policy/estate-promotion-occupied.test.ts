// **A promotion onto an occupied estate column.** Issue #141, consuming #145.
//
// #145 defined occupancy as the column itself. This case is the promotion path that definition
// was waiting for: a typed `unit.rooms` refuses a differing reading unless the operator said
// `supersede`, and the write always appends `estate_event`.
//
// **Why it is in tests/policy/** (docs/pipeline.md §6): whether a model's reading of a lease may
// replace an operator's typed room count is not a screen judgement. SPEC-evidence.md, *A promotion
// onto an occupied column* — one level down.
//
// **Red first.** Before #141 `promoteExtractedField` could not reach an estate column.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { listEstateEvents } from '../../src/estate/contract.ts';
import {
  approveExtractedField,
  ingestDocument,
  linkDocument,
  promoteExtractedField,
  upsertDocumentType,
  upsertDocumentTypeField,
} from '../../src/evidence/contract.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import type { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-22T09:00:00.000Z');
const ON = '2026-09-22';
const CLOCK = fixedClock(AT);
const TYPED = '3.5';
const READING = '4';
const BLOCK = 't141';
let sequence = 0;

async function seedRoomsReading(
  db: PoolClient,
  value: string,
): Promise<{
  unitId: string;
  extractedFieldId: string;
  documentId: string;
}> {
  sequence += 1;
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'policy-141-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Policy ${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 7')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '7', $2, true, 'READY')`,
    [unitId, TYPED],
  );

  const type = await upsertDocumentType(db, {
    typeKey: `${BLOCK}-lease-${sequence}`,
    labelHe: 'חוזה שכירות',
    labelEn: 'Lease',
    verificationTerms: ['תקופת השכירות'],
    isActive: true,
  });
  const field = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'rooms',
    labelHe: 'מספר חדרים',
    valueType: 'NUMBER',
    isRequired: false,
    extractionHint: 'מספר החדרים',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  await db.query(
    `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
     VALUES ($1, $2, 'unit.rooms')`,
    [newId(), field.id],
  );

  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-policy-141/buildings/${newId()}/${hash}.pdf`,
      fileHash: hash,
      driveFileId: null,
      validFrom: null,
      validTo: null,
      verificationVerdict: 'verified',
    },
    AT,
  );
  await linkDocument(db, {
    documentId: document.id,
    entityType: 'UNIT',
    entityId: unitId,
    linkRole: 'SUBJECT',
  });
  const extractedFieldId = newId(CLOCK);
  await db.query(
    `INSERT INTO extracted_field (
       extracted_field_id, document_id, document_type_field_id, value,
       page, bbox, confidence, model, extracted_at
     ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, 0.97, 'policy-fixture', $6)`,
    [
      extractedFieldId,
      document.id,
      field.id,
      value,
      JSON.stringify({ x: 1, y: 1, width: 40, height: 12 }),
      AT,
    ],
  );
  return { unitId, extractedFieldId, documentId: document.id };
}

function deps(db: PoolClient) {
  return { db, audit: createAuditLog(db, CLOCK), clock: CLOCK };
}

async function roomsOf(db: PoolClient, unitId: string): Promise<string> {
  const result = await db.query<{ rooms: string }>(
    `SELECT rooms::text AS rooms FROM unit WHERE unit_id = $1`,
    [unitId],
  );
  return result.rows[0]?.rooms ?? '';
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a promotion onto a typed unit.rooms refuses, and supersede writes a log', () => {
  it('names the typed value on refuse and appends estate_event when superseded', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const seeded = await seedRoomsReading(db, READING);
      await approveExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        approvedBy: 'policy@example.test',
        mayReadIdentifiers: false,
      });

      await assert.rejects(
        () =>
          promoteExtractedField(deps(db), {
            extractedFieldId: seeded.extractedFieldId,
            promotedBy: 'policy@example.test',
          }),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes(TYPED) &&
          (error.details?.existingValue as string | undefined) === TYPED,
      );
      assert.equal(await roomsOf(db, seeded.unitId), TYPED);
      assert.equal((await listEstateEvents(db, seeded.unitId)).length, 0);

      await promoteExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        promotedBy: 'policy@example.test',
        supersede: true,
      });
      assert.equal(await roomsOf(db, seeded.unitId), READING);
      const log = await listEstateEvents(db, seeded.unitId);
      assert.equal(log.length, 1);
      assert.equal(log[0]?.field, 'rooms');
      assert.equal(log[0]?.old_value, TYPED);
      assert.equal(log[0]?.new_value, READING);
      assert.equal(log[0]?.actor, 'policy@example.test');
      assert.equal(log[0]?.source_document_id, seeded.documentId);
    });
  });
});
