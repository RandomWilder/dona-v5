// **A half-priced pair is not promotable.** Issue #132.
//
// An amount may be approved without its currency — capture is open, and what the page says is
// always attestable. It may not be promoted without it. The columns a copy lands on are read by
// machinery no model decides, and half a price on one of them is worse than no price at all.
//
// **Why it is in tests/policy/** (docs/pipeline.md §6): whether a rent may reach `tenancy` is not
// a screen judgement. SPEC-evidence.md, *A half-priced pair is not promotable*.
//
// **Red first.** Before #132 an approved `rent_amount` with no approved currency was copyable onto
// the letting; the assertions below are what failed.
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

const AT = new Date('2026-09-21T21:00:00.000Z');
const ON = '2026-09-21';
const CLOCK = fixedClock(AT);
const AMOUNT = '12500';
const CURRENCY = 'ILS';
const OTHER_AMOUNT = '13000';
const OPTION_END = '2030-01-17';
const BLOCK = 't132';
let sequence = 0;

interface Fixture {
  amountFieldId: string;
  currencyFieldId: string | null;
  optionFieldId: string;
  amountDocumentId: string;
  tenancyId: string;
  documentTypeId: string;
  amountDeclId: string;
  currencyDeclId: string;
}

async function insertReading(
  db: PoolClient,
  documentId: string,
  documentTypeFieldId: string,
  value: string,
): Promise<string> {
  const extractedFieldId = newId(CLOCK);
  await db.query(
    `INSERT INTO extracted_field (
       extracted_field_id, document_id, document_type_field_id, value,
       page, bbox, confidence, model, extracted_at
     ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, 0.97, 'policy-fixture', $6)`,
    [
      extractedFieldId,
      documentId,
      documentTypeFieldId,
      value,
      JSON.stringify({ x: 1, y: 1, width: 40, height: 12 }),
      AT,
    ],
  );
  return extractedFieldId;
}

async function seedLease(
  db: PoolClient,
  spec: { currencyValue: string | null },
): Promise<Fixture> {
  sequence += 1;
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'policy-132-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
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
    `policy-132-${unitId.slice(24)}`,
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
  const amountField = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'rent_amount',
    labelHe: 'דמי שכירות',
    valueType: 'NUMBER',
    isRequired: true,
    extractionHint: 'מספר',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  const currencyField = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'rent_currency',
    labelHe: 'מטבע דמי השכירות',
    valueType: 'TEXT',
    isRequired: true,
    extractionHint: 'ILS',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  const optionField = await upsertDocumentTypeField(db, {
    documentTypeId: type.id,
    fieldKey: 'option_end_date',
    labelHe: 'סיום תקופת האופציה',
    valueType: 'DATE',
    isRequired: false,
    extractionHint: 'YYYY-MM-DD',
    effectiveFrom: ON,
    effectiveTo: null,
  });
  await db.query(
    `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
     VALUES ($1, $2, 'tenancy.rent_amount'), ($3, $4, 'tenancy.rent_currency'),
            ($5, $6, 'tenancy.option_end_date')`,
    [
      newId(),
      amountField.id,
      newId(),
      currencyField.id,
      newId(),
      optionField.id,
    ],
  );

  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-policy-half-pair/buildings/${newId()}/${hash}.pdf`,
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

  const amountFieldId = await insertReading(
    db,
    document.id,
    amountField.id,
    AMOUNT,
  );
  const currencyFieldId =
    spec.currencyValue === null
      ? null
      : await insertReading(
          db,
          document.id,
          currencyField.id,
          spec.currencyValue,
        );
  const optionFieldId = await insertReading(
    db,
    document.id,
    optionField.id,
    OPTION_END,
  );
  return {
    amountFieldId,
    currencyFieldId,
    optionFieldId,
    amountDocumentId: document.id,
    tenancyId: tenancy.id,
    documentTypeId: type.id,
    amountDeclId: amountField.id,
    currencyDeclId: currencyField.id,
  };
}

async function seedSecondLease(
  db: PoolClient,
  first: Fixture,
  amount: string,
): Promise<{ amountFieldId: string; currencyFieldId: string }> {
  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: first.documentTypeId,
      storageUri: `gs://dona-v5-policy-half-pair/buildings/${newId()}/${hash}.pdf`,
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
    entityId: first.tenancyId,
    linkRole: 'EVIDENCE',
  });
  return {
    amountFieldId: await insertReading(
      db,
      document.id,
      first.amountDeclId,
      amount,
    ),
    currencyFieldId: await insertReading(
      db,
      document.id,
      first.currencyDeclId,
      CURRENCY,
    ),
  };
}

function deps(db: PoolClient) {
  return { db, audit: createAuditLog(db, CLOCK), clock: CLOCK };
}

async function approve(
  db: PoolClient,
  extractedFieldId: string,
): Promise<void> {
  await approveExtractedField(deps(db), {
    extractedFieldId,
    approvedBy: 'policy@example.test',
    mayReadIdentifiers: false,
  });
}

async function promote(db: PoolClient, extractedFieldId: string) {
  return promoteExtractedField(deps(db), {
    extractedFieldId,
    promotedBy: 'policy@example.test',
  });
}

async function rentOf(
  db: PoolClient,
  tenancyId: string,
): Promise<{ amount: string | null; currency: string | null }> {
  const result = await db.query<{
    rent_amount: string | null;
    rent_currency: string | null;
  }>(
    `SELECT rent_amount::text, rent_currency FROM tenancy WHERE tenancy_id = $1`,
    [tenancyId],
  );
  return {
    amount: result.rows[0]?.rent_amount ?? null,
    currency: result.rows[0]?.rent_currency ?? null,
  };
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · a half-priced pair is not promotable', () => {
  it('approves an amount with no currency, and refuses to promote it', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedLease(db, { currencyValue: null });
      await approve(db, fixture.amountFieldId);

      await assert.rejects(
        () => promote(db, fixture.amountFieldId),
        (error: KernelError) => error.code === 'conflict',
        'an approved amount with no approved currency became a typed rent',
      );

      assert.deepEqual(await rentOf(db, fixture.tenancyId), {
        amount: null,
        currency: null,
      });
    });
  });

  it('promotes the pair together, and neither half lands alone', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedLease(db, { currencyValue: CURRENCY });
      assert.ok(fixture.currencyFieldId);
      await approve(db, fixture.amountFieldId);
      await approve(db, fixture.currencyFieldId);
      const promoted = await promote(db, fixture.amountFieldId);
      assert.equal(promoted.value, AMOUNT);
      assert.deepEqual(await rentOf(db, fixture.tenancyId), {
        amount: AMOUNT,
        currency: CURRENCY,
      });
      const stamps = await db.query<{
        field_key: string;
        promoted_to: string | null;
      }>(
        `SELECT f.field_key, e.promoted_to
           FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.extracted_field_id = ANY($1::uuid[])
          ORDER BY f.field_key`,
        [[fixture.amountFieldId, fixture.currencyFieldId]],
      );
      assert.deepEqual(
        stamps.rows.map((row) => [row.field_key, row.promoted_to]),
        [
          ['rent_amount', 'tenancy.rent_amount'],
          ['rent_currency', 'tenancy.rent_currency'],
        ],
      );
    });
  });

  it('refuses a different rent on a letting that already carries one', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const first = await seedLease(db, { currencyValue: CURRENCY });
      assert.ok(first.currencyFieldId);
      await approve(db, first.amountFieldId);
      await approve(db, first.currencyFieldId);
      await promote(db, first.amountFieldId);

      const second = await seedSecondLease(db, first, OTHER_AMOUNT);
      await approve(db, second.amountFieldId);
      await approve(db, second.currencyFieldId);

      await assert.rejects(
        () => promote(db, second.amountFieldId),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes(AMOUNT) &&
          error.message.includes(first.amountDocumentId) &&
          error.details?.existingValue === AMOUNT &&
          error.details?.sourceDocumentId === first.amountDocumentId,
        'a second rent moved a price already promoted from another field',
      );

      assert.deepEqual(await rentOf(db, first.tenancyId), {
        amount: AMOUNT,
        currency: CURRENCY,
      });
    });
  });

  it('promotes the pair when asked from the currency half', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedLease(db, { currencyValue: CURRENCY });
      assert.ok(fixture.currencyFieldId);
      await approve(db, fixture.amountFieldId);
      await approve(db, fixture.currencyFieldId);
      await promote(db, fixture.currencyFieldId);
      assert.deepEqual(await rentOf(db, fixture.tenancyId), {
        amount: AMOUNT,
        currency: CURRENCY,
      });
    });
  });

  it('copies an approved option end onto the letting', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedLease(db, { currencyValue: CURRENCY });
      await approve(db, fixture.optionFieldId);
      const promoted = await promote(db, fixture.optionFieldId);
      assert.equal(promoted.value, OPTION_END);
      const row = await db.query<{ option_end_date: string | null }>(
        `SELECT option_end_date::text FROM tenancy WHERE tenancy_id = $1`,
        [fixture.tenancyId],
      );
      assert.equal(row.rows[0]?.option_end_date, OPTION_END);
    });
  });
});
