// **A reading nobody signed never becomes a typed column.** Slice 7.4.
//
// A promotion is the only path by which something a model produced reaches `tenancy.start_date` and
// `tenancy.end_date` — the two columns `src/scope/`'s isolation join and `src/tenancy/`'s obligation
// state machine are computed from. SPEC.md says those are never decided by a model, and until this
// slice the sentence was half true: the *mapping* was governed (4.3's CHECK, a migration to widen),
// the *value* was not. `promoted_by` recorded who signed the copy; if nobody had approved the
// reading, what that name signed was a button.
//
// **Why it is in tests/policy/ and not beside the module** (docs/pipeline.md §6): this is not a
// judgement call about a screen. It is a deterministic rule about which values may reach the two
// columns the product cannot get wrong, and it has to hold for every caller `src/evidence/` grows,
// including the two confirm flows that promote without anybody opening the ledger.
//
// **Red first.** Before 7.4 this case promoted an unapproved reading and wrote 2026-03-01 onto the
// tenancy; the assertions below are what failed.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import {
  approveExtractedField,
  ingestDocument,
  linkDocument,
  listExtractedFields,
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

const AT = new Date('2026-09-15T09:00:00.000Z');
const ON = '2026-09-15';
const CLOCK = fixedClock(AT);
const READ = '2026-03-01';
const SIGNED = '2026-03-02';

// This suite's own `type_key` block, for `read-quality.test.ts`'s reason: files run in parallel
// against one database and `type_key` is UNIQUE, so two suites seeding one key wait on each other's
// speculative insertion.
const BLOCK = 't74';
let sequence = 0;

interface Fixture {
  documentId: string;
  extractedFieldId: string;
  tenancyId: string;
}

/**
 * A letting, a lease bound to it, and one mapped `start_date` reading — the smallest arrangement in
 * which a promotion is possible at all. The mapping row is written here rather than seeded, because
 * this case is about the value and not about the catalogue.
 */
async function seedPromotableReading(db: PoolClient): Promise<Fixture> {
  sequence += 1;
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'policy-74-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
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
  const profile = await upsertTermsProfile(db, `policy-74-${unitId.slice(24)}`);
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

  const hash = newId().replace(/-/g, '');
  const document = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-policy-promotion/buildings/${newId()}/${hash}.pdf`,
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
      READ,
      JSON.stringify({ x: 1, y: 1, width: 40, height: 12 }),
      AT,
    ],
  );
  return { documentId: document.id, extractedFieldId, tenancyId: tenancy.id };
}

function deps(db: PoolClient) {
  return { db, audit: createAuditLog(db, CLOCK), clock: CLOCK };
}

async function startDateOf(db: PoolClient, tenancyId: string): Promise<string> {
  const result = await db.query<{ start_date: string }>(
    `SELECT start_date::text FROM tenancy WHERE tenancy_id = $1`,
    [tenancyId],
  );
  return result.rows[0]?.start_date ?? '';
}

let pool: Pool | null = null;

before(async () => {
  pool = await policyPool();
});

after(async () => {
  await pool?.end();
});

describe('POLICY CASE · an unsigned reading never reaches a typed tenancy column', () => {
  it('refuses to promote a reading nobody approved, and moves no row', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedPromotableReading(db);

      await assert.rejects(
        () =>
          promoteExtractedField(deps(db), {
            extractedFieldId: fixture.extractedFieldId,
            promotedBy: 'policy@example.test',
          }),
        (error: KernelError) =>
          error.code === 'conflict' &&
          error.message.includes('has not been approved'),
        'an unapproved reading was promoted',
      );

      assert.equal(
        await startDateOf(db, fixture.tenancyId),
        '2025-01-01',
        'the tenancy moved on a reading nobody signed',
      );
      const events = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM tenancy_event WHERE tenancy_id = $1`,
        [fixture.tenancyId],
      );
      assert.equal(events.rows[0]?.n, '0', 'a refused promotion wrote history');
    });
  });

  it('refuses the stamp in the database with the command bypassed', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedPromotableReading(db);
      // The command is the door; the trigger is why there is only one door. A caller holding
      // `dona.promoting` — which is everything 0018 asked for — still may not stamp an unsigned row.
      await db.query("SELECT set_config('dona.promoting', 'on', true)");
      await assert.rejects(
        () =>
          db.query(
            `UPDATE extracted_field
                SET promoted_to = 'tenancy.start_date', promoted_by = $2, promoted_at = $3
              WHERE extracted_field_id = $1`,
            [fixture.extractedFieldId, 'policy@example.test', AT],
          ),
        (error: { code?: string; message: string }) =>
          // `restrict_violation`, the class 0018, 0028 and `document_is_immutable` all raise.
          error.code === '23001' && error.message.includes('approved'),
        'the database accepted a promotion stamp on an unsigned row',
      );
    });
  });

  it('copies the value a person signed, not the one the reader produced', async (t) => {
    if (!pool) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const fixture = await seedPromotableReading(db);
      await approveExtractedField(deps(db), {
        extractedFieldId: fixture.extractedFieldId,
        approvedValue: SIGNED,
        approvedBy: 'policy@example.test',
        mayReadIdentifiers: false,
      });

      const promoted = await promoteExtractedField(deps(db), {
        extractedFieldId: fixture.extractedFieldId,
        promotedBy: 'policy@example.test',
      });

      assert.equal(promoted.value, SIGNED);
      assert.equal(await startDateOf(db, fixture.tenancyId), SIGNED);
      const rows = await listExtractedFields(db, fixture.documentId);
      assert.equal(rows[0]?.value, READ, '`value` was overwritten');
      t.diagnostic(`read ${READ} · signed ${SIGNED} · on the column ${SIGNED}`);
    });
  });
});
