// Slice 5.5. The unit change log: old → new, actor, document, in order.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { listTenancyEvents } from './contract.ts';

async function seedUnit(db: PoolClient): Promise<{
  unitId: string;
  tenancyId: string;
  documentId: string;
}> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  const typeId = newId();
  const documentId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'log-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Log ${buildingId}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 1')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '1', 3.5, true, 'READY')`,
    [unitId],
  );
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `log-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, '2026-01-17', '2028-01-17', 'ACTIVE', $3)`,
    [tenancyId, unitId, profileId],
  );
  await db.query(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, 'נספח', NULL, NULL, true)`,
    [typeId, `log-${typeId}`],
  );
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, 'gs://x/a.pdf', $3, $4, 'unguarded')`,
    [
      documentId,
      typeId,
      `hash-${documentId}`,
      new Date('2026-09-11T00:00:00.000Z'),
    ],
  );
  return { unitId, tenancyId, documentId };
}

describe('tenancy · listTenancyEvents', () => {
  it('reads two amendments on one unit in order, and nothing on another', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const first = await seedUnit(db);
        const other = await seedUnit(db);
        const earlier = new Date('2026-09-10T08:00:00.000Z');
        const later = new Date('2026-09-10T09:00:00.000Z');
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES
             ($1, $2, $3, 'ops@example.test', 'amended', 'end_date',
              '2028-01-17', '2029-01-17', $4, NULL),
             ($5, $2, $6, 'ops@example.test', 'amended', 'start_date',
              '2026-01-17', '2026-02-01', $4, NULL)`,
          [newId(), first.tenancyId, later, first.documentId, newId(), earlier],
        );
        const log = await listTenancyEvents(db, first.unitId);
        assert.equal(log.length, 2);
        assert.equal(log[0]?.field, 'start_date');
        assert.equal(log[0]?.old_value, '2026-01-17');
        assert.equal(log[0]?.new_value, '2026-02-01');
        assert.equal(log[0]?.actor, 'ops@example.test');
        assert.equal(log[0]?.source_document_id, first.documentId);
        assert.equal(log[1]?.field, 'end_date');
        assert.equal(log[1]?.old_value, '2028-01-17');
        assert.equal(log[1]?.new_value, '2029-01-17');
        assert.equal((await listTenancyEvents(db, other.unitId)).length, 0);
      });
    } finally {
      await pool.end();
    }
  });
});
