// **A promotion onto an occupied column.** Issue #130.
//
// `promoteExtractedField` is idempotent for the same row re-promoted. Until this case, nothing
// examined whether the target already carried a value promoted from a *different* extracted field.
// A second document on the same letting could therefore move a typed column with nothing said.
//
// **Why it is in tests/policy/** (docs/pipeline.md §6): the columns a copy lands on are read by
// isolation and the obligation state machine. Whether a second reading may move one is not a
// screen judgement. SPEC-evidence.md, *A promotion onto an occupied column*.
//
// **Red first.** Before #130 a second approved reading of a different date was copied onto
// `tenancy.start_date`; the assertions below are what failed.
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
  upsertTenancy,
  upsertTermsProfile,
} from '../../src/tenancy/contract.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-21T09:00:00.000Z');
const ON = '2026-09-21';
const CLOCK = fixedClock(AT);
const FIRST = '2026-03-01';
const SECOND = '2026-04-01';
const BLOCK = 't130';
let sequence = 0;

interface Fixture {
  firstFieldId: string;
  secondFieldId: string;
  firstDocumentId: string;
  secondDocumentId: string;
  tenancyId: string;
}

async function seedTwoReadings(
  db: PoolClient,
  secondValue: string,
): Promise<Fixture> {
  sequence += 1;
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'policy-130-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Policy ${buildingId.slice(24)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 7')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '7', 3, true, 'READY')`,
    [unitId],
  );
  const profile = await upsertTermsProfile(
    db,
    `policy-130-${unitId.slice(24)}`,
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

  const type = await upsertDocumentType(db, {
    typeKey: `${BLOCK}-lease-${sequence}`,
    labelHe: 'חוזה שכירות',
    labelEn: 'Lease',
    verificationTerms: ['תקופת השכירות'],
    isActive: true,
  });
  const field = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'start_date',
    labelHe: 'תחילת תקופת השכירות',
    valueType: 'DATE',
    isRequired: true,
    extractionHint: 'YYYY-MM-DD',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  await db.query(
    `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
     VALUES ($1, $2, 'tenancy.start_date')`,
    [newId(), field.id],
  );

  async function fileReading(value: string): Promise<{
    documentId: string;
    extractedFieldId: string;
  }> {
    const hash = newId().replace(/-/g, '');
    const document = await ingestDocument(
      db,
      {
        documentTypeId: type.id,
        storageUri: `gs://dona-v5-policy-occupied/buildings/${newId()}/${hash}.pdf`,
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
      entityId: tenancy.id,
      linkRole: 'EVIDENCE',
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
    return { documentId: document.id, extractedFieldId };
  }

  const first = await fileReading(FIRST);
  const second = await fileReading(secondValue);
  return {
    firstFieldId: first.extractedFieldId,
    secondFieldId: second.extractedFieldId,
    firstDocumentId: first.documentId,
    secondDocumentId: second.documentId,
    tenancyId: tenancy.id,
  };
}

function deps(db: PoolClient) {
  return { db, audit: createAuditLog(db, CLOCK), clock: CLOCK };
}

async function approveAndPromote(
  db: PoolClient,
  extractedFieldId: string,
  spec: { supersede?: boolean } = {},
) {
  await approveExtractedField(deps(db), {
    extractedFieldId,
    approvedBy: 'policy@example.test',
    mayReadIdentifiers: false,
  });
  return promoteExtractedField(deps(db), {
    extractedFieldId,
    promotedBy: 'policy@example.test',
    supersede: spec.supersede,
  });
}

async function startDateOf(db: PoolClient, tenancyId: string): Promise<string> {
  const result = await db.query<{ start_date: string }>(
    `SELECT start_date::text FROM tenancy WHERE tenancy_id = $1`,
    [tenancyId],
  );
  return result.rows[0]?.start_date ?? '';
}

async function eventCount(db: PoolClient, tenancyId: string): Promise<number> {
  const result = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tenancy_event WHERE tenancy_id = $1`,
    [tenancyId],
  );
  return Number(result.rows[0]?.n ?? '0');
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a promotion onto an occupied column', () => {
  it('refuses a different reading when the value differs, and names what is already there', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedTwoReadings(db, SECOND);
      await approveAndPromote(db, fixture.firstFieldId);

      await assert.rejects(
        () => approveAndPromote(db, fixture.secondFieldId),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes(FIRST) &&
          error.message.includes(fixture.firstDocumentId) &&
          error.details?.existingValue === FIRST &&
          error.details?.sourceDocumentId === fixture.firstDocumentId,
        'a second reading moved a column already promoted from another field',
      );

      assert.equal(await startDateOf(db, fixture.tenancyId), FIRST);
      assert.equal(await eventCount(db, fixture.tenancyId), 1);
    });
  });

  it('re-promoting the same extracted field is silent', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedTwoReadings(db, SECOND);
      await approveAndPromote(db, fixture.firstFieldId);
      await promoteExtractedField(deps(db), {
        extractedFieldId: fixture.firstFieldId,
        promotedBy: 'policy@example.test',
      });
      assert.equal(await startDateOf(db, fixture.tenancyId), FIRST);
      assert.equal(await eventCount(db, fixture.tenancyId), 1);
    });
  });

  it('promotes a different reading with the same value without moving the column again', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedTwoReadings(db, FIRST);
      await approveAndPromote(db, fixture.firstFieldId);
      const promoted = await approveAndPromote(db, fixture.secondFieldId);
      assert.equal(promoted.value, FIRST);
      assert.equal(await startDateOf(db, fixture.tenancyId), FIRST);
      assert.equal(await eventCount(db, fixture.tenancyId), 1);
      const stamp = await db.query<{ promoted_to: string | null }>(
        `SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1`,
        [fixture.secondFieldId],
      );
      assert.equal(stamp.rows[0]?.promoted_to, 'tenancy.start_date');
    });
  });

  it('supersedes an occupied column when asked explicitly', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedTwoReadings(db, SECOND);
      await approveAndPromote(db, fixture.firstFieldId);
      const promoted = await approveAndPromote(db, fixture.secondFieldId, {
        supersede: true,
      });
      assert.equal(promoted.value, SECOND);
      assert.equal(await startDateOf(db, fixture.tenancyId), SECOND);
      assert.equal(await eventCount(db, fixture.tenancyId), 2);
    });
  });
});
