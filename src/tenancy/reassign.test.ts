// #146. Reassigning the assigned bay does not rewrite the built bay.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { fixedClock } from '../kernel/clock.ts';
import type { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  getTenancy,
  listTenancyEvents,
  reassignParkingSpace,
  reassignStorageSpace,
} from './contract.ts';

const AT = new Date('2026-09-22T09:00:00.000Z');

async function seedLetting(db: PoolClient): Promise<{
  unitId: string;
  tenancyId: string;
  builtBay: string;
  assignedBay: string;
  otherBay: string;
  lobby: string;
  builtStore: string;
  assignedStore: string;
  otherStore: string;
}> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  const builtBay = newId();
  const assignedBay = newId();
  const otherBay = newId();
  const lobby = newId();
  const builtStore = newId();
  const assignedStore = newId();
  const otherStore = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'bay-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Bay ${buildingId}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 7'),
            ($3, $2, 'PARKING', '500'),
            ($4, $2, 'PARKING', '574'),
            ($5, $2, 'PARKING', '580'),
            ($6, $2, 'COMMON', 'לובי'),
            ($7, $2, 'STORAGE', '600'),
            ($8, $2, 'STORAGE', '601'),
            ($9, $2, 'STORAGE', '610')`,
    [
      unitId,
      buildingId,
      builtBay,
      assignedBay,
      otherBay,
      lobby,
      builtStore,
      assignedStore,
      otherStore,
    ],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status,
                       parking_space_id, storage_space_id)
     VALUES ($1, '7', 3.5, true, 'READY', $2, $3)`,
    [unitId, builtBay, builtStore],
  );
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `bay-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, parking_space_id, storage_space_id)
     VALUES ($1, $2, '2026-09-01', '2028-08-31', 'ACTIVE', $3, $4, $5)`,
    [tenancyId, unitId, profileId, assignedBay, assignedStore],
  );
  return {
    unitId,
    tenancyId,
    builtBay,
    assignedBay,
    otherBay,
    lobby,
    builtStore,
    assignedStore,
    otherStore,
  };
}

describe('tenancy · reassignParkingSpace', () => {
  it('moves the assigned bay, logs reassigned with no paper, and leaves the built bay', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const seeded = await seedLetting(db);
        await reassignParkingSpace(db, fixedClock(AT), {
          tenancyId: seeded.tenancyId,
          parkingSpaceId: seeded.otherBay,
          actor: 'ops@example.test',
        });
        const letting = await getTenancy(db, seeded.tenancyId);
        assert.equal(letting.parking_space_id, seeded.otherBay);
        const unit = await db.query<{ parking_space_id: string }>(
          'SELECT parking_space_id FROM unit WHERE unit_id = $1',
          [seeded.unitId],
        );
        assert.equal(unit.rows[0]?.parking_space_id, seeded.builtBay);
        const log = await listTenancyEvents(db, seeded.unitId);
        assert.equal(log.length, 1);
        assert.equal(log[0]?.kind, 'reassigned');
        assert.equal(log[0]?.field, 'parking_space_id');
        assert.equal(log[0]?.old_value, '574');
        assert.equal(log[0]?.new_value, '580');
        assert.equal(log[0]?.source_document_id, null);
        assert.equal(log[0]?.actor, 'ops@example.test');

        await reassignParkingSpace(db, fixedClock(AT), {
          tenancyId: seeded.tenancyId,
          parkingSpaceId: seeded.otherBay,
          actor: 'ops@example.test',
        });
        assert.equal((await listTenancyEvents(db, seeded.unitId)).length, 1);

        await assert.rejects(
          () =>
            reassignParkingSpace(db, fixedClock(AT), {
              tenancyId: seeded.tenancyId,
              parkingSpaceId: seeded.lobby,
              actor: 'ops@example.test',
            }),
          (error: KernelError) =>
            error.code === 'invalid' && error.message.includes('parking space'),
        );
      });
    } finally {
      await pool.end();
    }
  });
});

describe('tenancy · reassignStorageSpace', () => {
  it('moves assigned storage, logs reassigned with no paper, and leaves built storage', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const seeded = await seedLetting(db);
        await reassignStorageSpace(db, fixedClock(AT), {
          tenancyId: seeded.tenancyId,
          storageSpaceId: seeded.otherStore,
          actor: 'ops@example.test',
        });
        const letting = await getTenancy(db, seeded.tenancyId);
        assert.equal(letting.storage_space_id, seeded.otherStore);
        const unit = await db.query<{ storage_space_id: string }>(
          'SELECT storage_space_id FROM unit WHERE unit_id = $1',
          [seeded.unitId],
        );
        assert.equal(unit.rows[0]?.storage_space_id, seeded.builtStore);
        const log = await listTenancyEvents(db, seeded.unitId);
        const storageLog = log.filter(
          (row) => row.field === 'storage_space_id',
        );
        assert.equal(storageLog.length, 1);
        assert.equal(storageLog[0]?.kind, 'reassigned');
        assert.equal(storageLog[0]?.old_value, '601');
        assert.equal(storageLog[0]?.new_value, '610');
        assert.equal(storageLog[0]?.source_document_id, null);
        assert.equal(storageLog[0]?.actor, 'ops@example.test');

        await reassignStorageSpace(db, fixedClock(AT), {
          tenancyId: seeded.tenancyId,
          storageSpaceId: seeded.otherStore,
          actor: 'ops@example.test',
        });
        assert.equal(
          (await listTenancyEvents(db, seeded.unitId)).filter(
            (row) => row.field === 'storage_space_id',
          ).length,
          1,
        );

        await assert.rejects(
          () =>
            reassignStorageSpace(db, fixedClock(AT), {
              tenancyId: seeded.tenancyId,
              storageSpaceId: seeded.lobby,
              actor: 'ops@example.test',
            }),
          (error: KernelError) =>
            error.code === 'invalid' && error.message.includes('storage space'),
        );
      });
    } finally {
      await pool.end();
    }
  });
});
