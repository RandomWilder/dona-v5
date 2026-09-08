// A4 — a tenancy must have at least one guarantor. Policy case over saved rows, never a NOT NULL.
//
// SPEC-flows.md A4 and docs/pipeline.md §6: written red first. The addendum in A3 could never land
// if this were a column constraint. Zero guarantors is a legal insert; the queue is a query.
//
// **Red first at slice 4.8**, against `listIncompleteTenancies` / `recordCompletenessException`
// before they existed: the suite failed to load (`does not provide an export named ...`). The
// numbers are in tasks/evidence/4.8.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newId } from '../../src/kernel/ids.ts';
import {
  listIncompleteTenancies,
  recordCompletenessException,
} from '../../src/tenancy/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

const PHONE = '+972501118801';

async function linkTenancyDocument(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
  typeKey: string,
  labelHe: string,
): Promise<string> {
  const typeId = newId();
  const documentId = newId();
  await db.query(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, $3, NULL, NULL, true)`,
    [typeId, typeKey, labelHe],
  );
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
    [
      documentId,
      typeId,
      `gs://x/${documentId}.pdf`,
      `hash-${documentId}`,
      new Date('2026-09-08T12:00:00Z'),
    ],
  );
  await db.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
    [documentId, tenancyId],
  );
  return documentId;
}

describe('policy · a tenancy without a guarantor is incomplete, not illegal', () => {
  it('inserts a tenancy with tenants and zero guarantors — never NOT NULL, never CHECK', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          let rejected: string | undefined;
          try {
            await seedOccupancy(db, '81', {
              phone: PHONE,
              contactFrom: '2026-01-01',
              contactTo: null,
              tenancyFrom: '2026-01-01',
              tenancyTo: '2027-01-01',
              status: 'DRAFT',
            });
          } catch (error) {
            rejected = (error as { code?: string }).code;
          }
          assert.equal(
            rejected,
            undefined,
            'a draft with no ערב must store, or A3 has nowhere to land',
          );
          assert.notEqual(rejected, NOT_NULL_VIOLATION);
          assert.notEqual(rejected, CHECK_VIOLATION);
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('lists a document-backed draft with zero guarantors, and not the others', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const missing = await seedOccupancy(db, '82', {
            phone: '+972501118802',
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            status: 'DRAFT',
          });
          const leaseId = await linkTenancyDocument(
            db,
            missing.tenancyId,
            `lease-48-${missing.tenancyId.slice(0, 8)}`,
            'חוזה שכירות',
          );

          const withGuarantor = await seedOccupancy(db, '83', {
            phone: '+972501118803',
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            status: 'DRAFT',
          });
          await linkTenancyDocument(
            db,
            withGuarantor.tenancyId,
            `lease-48g-${withGuarantor.tenancyId.slice(0, 8)}`,
            'חוזה שכירות',
          );
          const guarantorId = newId();
          await db.query(
            `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'ערב')`,
            [guarantorId],
          );
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'GUARANTOR', false)`,
            [withGuarantor.tenancyId, guarantorId],
          );

          const registerOnly = await seedOccupancy(db, '84', {
            phone: '+972501118804',
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            status: 'ACTIVE',
          });

          const queue = await listIncompleteTenancies(db);
          const ids = queue.map((row) => row.tenancy_id);
          assert.ok(ids.includes(missing.tenancyId));
          assert.equal(
            queue.find((row) => row.tenancy_id === missing.tenancyId)
              ?.expected_document_id,
            leaseId,
          );
          assert.equal(
            queue.find((row) => row.tenancy_id === missing.tenancyId)?.missing,
            'guarantor',
          );
          assert.ok(!ids.includes(withGuarantor.tenancyId));
          assert.ok(!ids.includes(registerOnly.tenancyId));
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('clears the queue when an exception is recorded', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const occupancy = await seedOccupancy(db, '85', {
            phone: '+972501118805',
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            status: 'DRAFT',
          });
          await linkTenancyDocument(
            db,
            occupancy.tenancyId,
            `lease-48e-${occupancy.tenancyId.slice(0, 8)}`,
            'חוזה שכירות',
          );
          const before = await listIncompleteTenancies(db);
          assert.ok(
            before.some((row) => row.tenancy_id === occupancy.tenancyId),
          );

          const first = await recordCompletenessException(db, {
            tenancyId: occupancy.tenancyId,
            rule: 'guarantor',
            actor: 'console',
            reason: 'אין ערב על חוזה דייר קיים',
            at: new Date('2026-09-08T12:00:00Z'),
          });
          assert.equal(first, 'recorded');
          const after = await listIncompleteTenancies(db);
          assert.ok(
            !after.some((row) => row.tenancy_id === occupancy.tenancyId),
          );

          const second = await recordCompletenessException(db, {
            tenancyId: occupancy.tenancyId,
            rule: 'guarantor',
            actor: 'console',
            reason: 'again',
            at: new Date('2026-09-08T12:01:00Z'),
          });
          assert.equal(second, 'alreadyRecorded');
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
