// #135. Exercising the option extends the same letting.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { exerciseOption, getTenancy, listTenancyEvents } from './contract.ts';

const AT = new Date('2026-09-21T09:00:00.000Z');
const INITIAL_END = '2028-08-31';
const OPTION_END = '2031-08-31';

async function seedLetting(db: PoolClient): Promise<{
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
     VALUES ($1, 'option-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Option ${buildingId}`],
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
    [profileId, `option-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, option_end_date)
     VALUES ($1, $2, '2026-09-01', $3, 'ACTIVE', $4, $5)`,
    [tenancyId, unitId, INITIAL_END, profileId, OPTION_END],
  );
  await db.query(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, 'הודעה', NULL, NULL, true)`,
    [typeId, `option-${typeId}`],
  );
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, 'gs://x/notice.pdf', $3, $4, 'unguarded')`,
    [documentId, typeId, `hash-${documentId}`, AT],
  );
  return { unitId, tenancyId, documentId };
}

describe('tenancy · exerciseOption', () => {
  it('moves end_date, keeps the option, and logs extended with or without paper', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const first = await seedLetting(db);
        await exerciseOption(db, clock, {
          tenancyId: first.tenancyId,
          actor: 'ops@example.test',
        });
        const afterCall = await getTenancy(db, first.tenancyId);
        assert.equal(afterCall.end_date, OPTION_END);
        assert.equal(afterCall.option_end_date, OPTION_END);
        assert.equal(afterCall.tenancy_id, first.tenancyId);
        const count = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1`,
          [first.unitId],
        );
        assert.equal(count.rows[0]?.n, '1');
        const phoneLog = await listTenancyEvents(db, first.unitId);
        assert.equal(phoneLog.length, 1);
        assert.equal(phoneLog[0]?.kind, 'extended');
        assert.equal(phoneLog[0]?.field, 'end_date');
        assert.equal(phoneLog[0]?.old_value, INITIAL_END);
        assert.equal(phoneLog[0]?.new_value, OPTION_END);
        assert.equal(phoneLog[0]?.source_document_id, null);
        assert.equal(phoneLog[0]?.actor, 'ops@example.test');
        assert.equal(phoneLog[0]?.at, AT.toISOString());

        const second = await seedLetting(db);
        await exerciseOption(db, clock, {
          tenancyId: second.tenancyId,
          actor: 'ops@example.test',
          sourceDocumentId: second.documentId,
        });
        const paperLog = await listTenancyEvents(db, second.unitId);
        assert.equal(paperLog[0]?.kind, 'extended');
        assert.equal(paperLog[0]?.source_document_id, second.documentId);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a letting that has no option left to take', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seeded = await seedLetting(db);
        await db.query(
          `UPDATE tenancy SET option_end_date = NULL WHERE tenancy_id = $1`,
          [seeded.tenancyId],
        );
        await assert.rejects(
          () =>
            exerciseOption(db, clock, {
              tenancyId: seeded.tenancyId,
              actor: 'ops@example.test',
            }),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'invalid',
        );
        await assert.rejects(
          () =>
            exerciseOption(db, clock, {
              tenancyId: newId(),
              actor: 'ops@example.test',
            }),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_found',
        );
      });
    } finally {
      await pool.end();
    }
  });
});
