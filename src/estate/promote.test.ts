// #141. Estate applyPromotedField writes the column and appends estate_event.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import type { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { applyPromotedField, listEstateEvents } from './contract.ts';

const AT = new Date('2026-09-22T09:00:00.000Z');

async function seedUnit(db: PoolClient): Promise<{
  unitId: string;
  documentId: string;
  extractedFieldId: string;
}> {
  const buildingId = newId();
  const unitId = newId();
  const typeId = newId();
  const documentId = newId();
  const fieldId = newId();
  const extractedFieldId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'promo-estate', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Estate ${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 7')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '7', 3.5, true, 'READY')`,
    [unitId],
  );
  await db.query(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, 'חוזה', NULL, NULL, true)`,
    [typeId, `estate-promo-${typeId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, 'gs://x/a.pdf', $3, $4, 'unguarded')`,
    [documentId, typeId, `hash-${documentId}`, AT],
  );
  await db.query(
    `INSERT INTO document_type_field (
       document_type_field_id, document_type_id, field_key, label_he,
       value_type, is_required, effective_from
     ) VALUES ($1, $2, 'rooms', 'חדרים', 'NUMBER', false, '2026-09-22')`,
    [fieldId, typeId],
  );
  await db.query(
    `INSERT INTO extracted_field (
       extracted_field_id, document_id, document_type_field_id, value,
       page, bbox, confidence, model, extracted_at
     ) VALUES ($1, $2, $3, '4', 1, $4::jsonb, 0.9, 'test', $5)`,
    [
      extractedFieldId,
      documentId,
      fieldId,
      JSON.stringify({ x: 1, y: 1, width: 10, height: 10 }),
      AT,
    ],
  );
  return { unitId, documentId, extractedFieldId };
}

describe('estate · applyPromotedField', () => {
  it('writes rooms and floor and lists old → new on the unit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const seeded = await seedUnit(db);
        await applyPromotedField(db, {
          entityType: 'UNIT',
          unitId: seeded.unitId,
          field: 'rooms',
          value: '4',
          actor: 'אסף',
          at: AT,
          sourceDocumentId: seeded.documentId,
          extractedFieldId: seeded.extractedFieldId,
        });
        const rooms = await db.query<{ rooms: string }>(
          `SELECT rooms::text AS rooms FROM unit WHERE unit_id = $1`,
          [seeded.unitId],
        );
        assert.equal(rooms.rows[0]?.rooms, '4');

        await applyPromotedField(db, {
          entityType: 'UNIT',
          unitId: seeded.unitId,
          field: 'floor',
          value: '2',
          actor: 'אסף',
          at: AT,
          sourceDocumentId: seeded.documentId,
          extractedFieldId: seeded.extractedFieldId,
        });
        const floor = await db.query<{ floor: string | null }>(
          `SELECT floor FROM space WHERE space_id = $1`,
          [seeded.unitId],
        );
        assert.equal(floor.rows[0]?.floor, '2');

        const log = await listEstateEvents(db, seeded.unitId);
        assert.equal(log.length, 2);
        assert.equal(log[0]?.field, 'rooms');
        assert.equal(log[0]?.old_value, '3.5');
        assert.equal(log[0]?.new_value, '4');
        assert.equal(log[1]?.field, 'floor');
        assert.equal(log[1]?.old_value, null);
        assert.equal(log[1]?.new_value, '2');

        await assert.rejects(
          () =>
            applyPromotedField(db, {
              entityType: 'UNIT',
              unitId: seeded.unitId,
              field: 'rooms',
              value: 'lots',
              actor: 'אסף',
              at: AT,
              sourceDocumentId: seeded.documentId,
              extractedFieldId: seeded.extractedFieldId,
            }),
          (error: KernelError) => error.code === 'invalid',
        );
      });
    } finally {
      await pool.end();
    }
  });
});
