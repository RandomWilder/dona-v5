// Slice 5.7. Obligation snapshot, catalogue deactivate, no delete on the contract.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import * as tenancyContract from './contract.ts';
import {
  applyObligationTypeCatalogue,
  createObligation,
  getObligation,
  listObligationsForTenancy,
  listObligationTypes,
  upsertObligationType,
} from './contract.ts';
import { seedObligationTypes } from './fixtures/obligation-types.ts';

async function seedTenancy(db: PoolClient): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'ob-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `ob-${buildingId}`],
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
    [profileId, `ob-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
    [tenancyId, unitId, profileId],
  );
  return tenancyId;
}

describe('tenancy · obligation commands', () => {
  it('the contract has no delete', () => {
    assert.equal('deleteObligationType' in tenancyContract, false);
    assert.equal('deleteObligation' in tenancyContract, false);
  });

  it('copies responsible_party at create; a later type edit leaves the obligation unchanged', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const tenancyId = await seedTenancy(db);
        const code = `INS-${newId().slice(24)}`;
        const type = await upsertObligationType(db, {
          code,
          labelHe: 'ביטוח',
          labelEn: 'Insurance',
          defaultResponsibleParty: 'TENANT',
          requiresEvidence: true,
          isActive: true,
        });
        const created = await createObligation(db, {
          tenancyId,
          obligationTypeId: type.id,
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          evidenceDocumentId: null,
        });
        await upsertObligationType(db, {
          code,
          labelHe: 'ביטוח מעודכן',
          labelEn: 'Insurance updated',
          defaultResponsibleParty: 'OPERATOR',
          requiresEvidence: true,
          isActive: false,
        });
        const at = new Date('2026-09-12T12:00:00.000Z');
        const row = await getObligation(db, created.id, at);
        assert.ok(row);
        assert.equal(row.responsibleParty, 'TENANT');
        assert.equal(row.status, 'MISSING');
        const listed = await listObligationsForTenancy(db, tenancyId, at);
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.responsibleParty, 'TENANT');
      });
    } finally {
      await pool.end();
    }
  });

  it('a second catalogue apply is a no-op on created count', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const catalogue = seedObligationTypes.map((row) => ({
          ...row,
          code: `${row.code}-${newId().slice(24)}`,
        }));
        const first = await applyObligationTypeCatalogue(db, catalogue);
        assert.equal(first.types.created, 5);
        assert.equal(first.types.updated, 0);
        const second = await applyObligationTypeCatalogue(db, catalogue);
        assert.equal(second.types.created, 0);
        assert.equal(second.types.updated, 5);
      });
    } finally {
      await pool.end();
    }
  });

  it('lists every catalogue row, inactive included', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const suffix = newId().slice(24);
        const active = await upsertObligationType(db, {
          code: `Z-ON-${suffix}`,
          labelHe: 'פעיל',
          labelEn: null,
          defaultResponsibleParty: 'TENANT',
          requiresEvidence: false,
          isActive: true,
        });
        const off = await upsertObligationType(db, {
          code: `A-OFF-${suffix}`,
          labelHe: 'כבוי',
          labelEn: null,
          defaultResponsibleParty: 'OPERATOR',
          requiresEvidence: true,
          isActive: false,
        });
        const listed = await listObligationTypes(db);
        const offRow = listed.find((row) => row.code === `A-OFF-${suffix}`);
        const onRow = listed.find((row) => row.code === `Z-ON-${suffix}`);
        assert.ok(offRow);
        assert.ok(onRow);
        assert.equal(offRow.obligationTypeId, off.id);
        assert.equal(onRow.obligationTypeId, active.id);
        assert.equal(offRow.isActive, false);
        assert.equal(onRow.isActive, true);
        const ours = listed.filter(
          (row) =>
            row.code === `A-OFF-${suffix}` || row.code === `Z-ON-${suffix}`,
        );
        assert.deepEqual(
          ours.map((row) => row.code),
          [`A-OFF-${suffix}`, `Z-ON-${suffix}`],
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('create without a type is not_found', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const tenancyId = await seedTenancy(db);
        await assert.rejects(
          () =>
            createObligation(db, {
              tenancyId,
              obligationTypeId: newId(),
              validFrom: null,
              validTo: null,
              evidenceDocumentId: null,
            }),
          (error: unknown) => {
            assert.ok(error instanceof KernelError);
            assert.equal(error.code, 'not_found');
            return true;
          },
        );
      });
    } finally {
      await pool.end();
    }
  });
});
