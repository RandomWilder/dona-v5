// #154. Ending a letting early keeps the contractual end and names the person.
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
import { endTenancyEarly, getTenancy, listTenancyEvents } from './contract.ts';

const AT = new Date('2026-09-24T09:00:00.000Z');
const TODAY = '2026-09-24';

async function seedLetting(
  db: PoolClient,
  dates: { from: string; to: string },
): Promise<{ unitId: string; tenancyId: string; documentId: string }> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  const typeId = newId();
  const documentId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'end-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `End ${buildingId}`],
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
    [profileId, `end-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
    [tenancyId, unitId, dates.from, dates.to, profileId],
  );
  await db.query(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, 'הודעה', NULL, NULL, true)`,
    [typeId, `end-${typeId}`],
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

function refusal(error: unknown): KernelError {
  assert.ok(error instanceof KernelError);
  return error;
}

describe('tenancy · endTenancyEarly', () => {
  it('keeps the contractual end, on the first day and the last, with or without paper', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const first = await seedLetting(db, {
          from: '2026-01-01',
          to: TODAY,
        });
        await endTenancyEarly(db, clock, {
          tenancyId: first.tenancyId,
          actualMoveOut: '2026-01-01',
          actor: 'ops@example.test',
        });
        const onStart = await getTenancy(db, first.tenancyId);
        assert.equal(onStart.status, 'TERMINATED_EARLY');
        assert.equal(onStart.end_date, TODAY);
        const phoneLog = await listTenancyEvents(db, first.unitId);
        assert.equal(phoneLog.length, 1);
        assert.equal(phoneLog[0]?.kind, 'ended_early');
        assert.equal(phoneLog[0]?.actor, 'ops@example.test');
        assert.equal(phoneLog[0]?.source_document_id, null);

        const second = await seedLetting(db, {
          from: '2026-01-01',
          to: TODAY,
        });
        await endTenancyEarly(db, clock, {
          tenancyId: second.tenancyId,
          actualMoveOut: TODAY,
          noticeDate: TODAY,
          actor: 'ops@example.test',
          sourceDocumentId: second.documentId,
        });
        const onEnd = await getTenancy(db, second.tenancyId);
        assert.equal(onEnd.end_date, TODAY);
        assert.equal(onEnd.status, 'TERMINATED_EARLY');
        const paperLog = await listTenancyEvents(db, second.unitId);
        assert.equal(paperLog[0]?.source_document_id, second.documentId);
        assert.equal(paperLog[0]?.actor, 'ops@example.test');
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses each illegal end with its own reason', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seeded = await seedLetting(db, {
          from: '2026-01-01',
          to: '2026-12-31',
        });
        const cases: Array<{
          actualMoveOut: string;
          noticeDate?: string;
          message: string;
        }> = [
          {
            actualMoveOut: '2025-12-31',
            message: 'the move-out is before the lease starts',
          },
          {
            actualMoveOut: '2027-01-01',
            message: 'the move-out is after the contractual end',
          },
          {
            actualMoveOut: '2026-09-25',
            message: 'a future move-out is notice, not an end',
          },
          {
            actualMoveOut: TODAY,
            noticeDate: '2026-09-25',
            message: 'the notice is after the move-out',
          },
        ];
        for (const attempt of cases) {
          await assert.rejects(
            () =>
              endTenancyEarly(db, clock, {
                tenancyId: seeded.tenancyId,
                actualMoveOut: attempt.actualMoveOut,
                noticeDate: attempt.noticeDate,
                actor: 'ops@example.test',
              }),
            (error: unknown) =>
              refusal(error).code === 'invalid' &&
              refusal(error).message === attempt.message,
          );
        }
        await db.query(
          `UPDATE tenancy SET status = 'ENDED' WHERE tenancy_id = $1`,
          [seeded.tenancyId],
        );
        await assert.rejects(
          () =>
            endTenancyEarly(db, clock, {
              tenancyId: seeded.tenancyId,
              actualMoveOut: TODAY,
              actor: 'ops@example.test',
            }),
          (error: unknown) =>
            refusal(error).code === 'invalid' &&
            refusal(error).message === 'this letting is not active',
        );
        await assert.rejects(
          () =>
            endTenancyEarly(db, clock, {
              tenancyId: newId(),
              actualMoveOut: TODAY,
              actor: 'ops@example.test',
            }),
          (error: unknown) =>
            refusal(error).code === 'not_found' &&
            refusal(error).message === 'tenancy not found',
        );
        const still = await getTenancy(db, seeded.tenancyId);
        assert.equal(still.status, 'ENDED');
        assert.equal(still.end_date, '2026-12-31');
      });
    } finally {
      await pool.end();
    }
  });
});
