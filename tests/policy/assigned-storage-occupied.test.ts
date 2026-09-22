// **A promotion onto occupied assigned storage.** Issue #148.
//
// Reassignment writes `tenancy.storage_space_id` with no extracted-field stamp.
// Occupancy is the column itself, same standing as the assigned bay.
//
// **Why it is in tests/policy/**: whether a model's reading of a lease may
// replace an operator's reassignment is not a screen judgement.
//
// **Red first.** Before #148 there was no assigned-storage column to occupy.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
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
import {
  listTenancyEvents,
  occupantOfAssignedStorage,
  reassignStorageSpace,
} from '../../src/tenancy/contract.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-22T09:00:00.000Z');
const ON = '2026-09-22';
const CLOCK = fixedClock(AT);
const BLOCK = 't148';
let sequence = 0;

async function seedAssignedStorageReading(db: PoolClient): Promise<{
  unitId: string;
  tenancyId: string;
  extractedFieldId: string;
  documentId: string;
  builtStore: string;
  heldStore: string;
  paperStore: string;
}> {
  sequence += 1;
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  const builtStore = newId();
  const heldStore = newId();
  const paperStore = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'policy-148-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Policy ${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 7'),
            ($3, $2, 'STORAGE', '600'),
            ($4, $2, 'STORAGE', '610'),
            ($5, $2, 'STORAGE', '601')`,
    [unitId, buildingId, builtStore, heldStore, paperStore],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status,
                       storage_space_id)
     VALUES ($1, '7', 3.5, true, 'READY', $2)`,
    [unitId, builtStore],
  );
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `policy-148-${sequence}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, storage_space_id)
     VALUES ($1, $2, '2026-09-01', '2028-08-31', 'ACTIVE', $3, $4)`,
    [tenancyId, unitId, profileId, heldStore],
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
    fieldKey: 'storage_space_number',
    labelHe: 'מספר מחסן',
    valueType: 'TEXT',
    isRequired: false,
    extractionHint: 'מספר המחסן',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  await db.query(
    `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
     VALUES ($1, $2, 'tenancy.storage_space_id')`,
    [newId(), field.id],
  );

  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-policy-148/buildings/${newId()}/${hash}.pdf`,
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
    entityType: 'TENANCY',
    entityId: tenancyId,
    linkRole: 'EVIDENCE',
  });
  const extractedFieldId = newId(CLOCK);
  await db.query(
    `INSERT INTO extracted_field (
       extracted_field_id, document_id, document_type_field_id, value,
       page, bbox, confidence, model, extracted_at
     ) VALUES ($1, $2, $3, '601', 1, $4::jsonb, 0.97, 'policy-fixture', $5)`,
    [
      extractedFieldId,
      document.id,
      field.id,
      JSON.stringify({ x: 1, y: 1, width: 40, height: 12 }),
      AT,
    ],
  );
  return {
    unitId,
    tenancyId,
    extractedFieldId,
    documentId: document.id,
    builtStore,
    heldStore,
    paperStore,
  };
}

function deps(db: PoolClient) {
  return { db, audit: createAuditLog(db, CLOCK), clock: CLOCK };
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a promotion onto reassigned storage refuses, and supersede leaves built storage', () => {
  it('names assigned storage on refuse and writes assigned storage when superseded', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const seeded = await seedAssignedStorageReading(db);
      await approveExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        approvedBy: 'policy@example.test',
        mayReadIdentifiers: false,
      });
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '610',
      );

      await assert.rejects(
        () =>
          promoteExtractedField(deps(db), {
            extractedFieldId: seeded.extractedFieldId,
            promotedBy: 'policy@example.test',
          }),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes('610') &&
          (error.details?.existingValue as string | undefined) === '610',
      );
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '610',
      );
      const unitBefore = await db.query<{ storage_space_id: string }>(
        'SELECT storage_space_id FROM unit WHERE unit_id = $1',
        [seeded.unitId],
      );
      assert.equal(unitBefore.rows[0]?.storage_space_id, seeded.builtStore);

      await promoteExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        promotedBy: 'policy@example.test',
        supersede: true,
      });
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '601',
      );
      const unitAfter = await db.query<{ storage_space_id: string }>(
        'SELECT storage_space_id FROM unit WHERE unit_id = $1',
        [seeded.unitId],
      );
      assert.equal(unitAfter.rows[0]?.storage_space_id, seeded.builtStore);
      const log = await listTenancyEvents(db, seeded.unitId);
      assert.equal(log.length, 1);
      assert.equal(log[0]?.kind, 'amended');
      assert.equal(log[0]?.field, 'storage_space_id');
      assert.equal(log[0]?.old_value, '610');
      assert.equal(log[0]?.new_value, '601');
      assert.equal(log[0]?.source_document_id, seeded.documentId);
    });
  });

  it('refuses a later copy of the paper after an operator moved storage', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const seeded = await seedAssignedStorageReading(db);
      await db.query(
        'UPDATE tenancy SET storage_space_id = NULL WHERE tenancy_id = $1',
        [seeded.tenancyId],
      );
      await approveExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        approvedBy: 'policy@example.test',
        mayReadIdentifiers: false,
      });
      await promoteExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        promotedBy: 'policy@example.test',
      });
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '601',
      );
      await reassignStorageSpace(db, CLOCK, {
        tenancyId: seeded.tenancyId,
        storageSpaceId: seeded.heldStore,
        actor: 'office@example.test',
      });
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '610',
      );
      await assert.rejects(
        () =>
          promoteExtractedField(deps(db), {
            extractedFieldId: seeded.extractedFieldId,
            promotedBy: 'policy@example.test',
          }),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes('610') &&
          (error.details?.existingValue as string | undefined) === '610',
      );
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '610',
      );
      await promoteExtractedField(deps(db), {
        extractedFieldId: seeded.extractedFieldId,
        promotedBy: 'policy@example.test',
        supersede: true,
      });
      assert.equal(
        await occupantOfAssignedStorage(db, seeded.tenancyId),
        '601',
      );
    });
  });
});
