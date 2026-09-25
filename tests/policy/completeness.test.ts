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
import {
  listTenancyDocumentFacts,
  PROTOCOL_CONFIRM_ACTION,
} from '../../src/evidence/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import {
  listActivationQueue,
  listIncompleteTenancies,
  REQUIRED_FOR_ACTIVATION,
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
const AT = new Date('2026-09-15T09:00:00.000Z');
const CLOCK = fixedClock(AT);

async function queueOf(db: Parameters<typeof seedOccupancy>[0]) {
  return listIncompleteTenancies(db, CLOCK, listTenancyDocumentFacts);
}

async function linkApproved(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
  typeKey: string,
): Promise<string> {
  const typeId = newId();
  const documentId = newId();
  const type = await db.query<{ document_type_id: string }>(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, $3, NULL, NULL, true)
     ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
     RETURNING document_type_id`,
    [typeId, typeKey, typeKey === 'lease' ? 'חוזה שכירות' : 'פרוטוקול מסירה'],
  );
  const documentTypeId = type.rows[0]?.document_type_id ?? typeId;
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
    [
      documentId,
      documentTypeId,
      `gs://x/${documentId}.pdf`,
      `hash-${documentId}`,
      AT,
    ],
  );
  await db.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
    [documentId, tenancyId],
  );
  if (typeKey === 'handover_protocol') {
    await db.query(
      `INSERT INTO audit_log (
         id, at, actor_kind, actor_id, action, subject_id, inputs, outcome
       ) VALUES ($1, $2, 'staff', $3, $4, $5, '{}'::jsonb, 'ok')`,
      [newId(), AT, 'policy@example.test', PROTOCOL_CONFIRM_ACTION, documentId],
    );
  }
  return documentId;
}

async function addGuarantor(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
): Promise<void> {
  const guarantorId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name)
     VALUES ($1, 'PERSON', 'ערב')`,
    [guarantorId],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'GUARANTOR', false)`,
    [tenancyId, guarantorId],
  );
}

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
            `lease-48-${missing.tenancyId.slice(24)}`,
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
          await linkApproved(db, withGuarantor.tenancyId, 'lease');
          await linkApproved(db, withGuarantor.tenancyId, 'handover_protocol');
          await addGuarantor(db, withGuarantor.tenancyId);

          const registerOnly = await seedOccupancy(db, '84', {
            phone: '+972501118804',
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            status: 'ACTIVE',
          });

          const queue = await queueOf(db);
          const ids = queue.map((row) => row.tenancy_id);
          assert.ok(ids.includes(missing.tenancyId));
          const guarantorRow = queue.find(
            (row) =>
              row.tenancy_id === missing.tenancyId &&
              row.missing === 'guarantor',
          );
          assert.equal(guarantorRow?.expected_document_id, leaseId);
          assert.equal(guarantorRow?.missing, 'guarantor');
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
            `lease-48e-${occupancy.tenancyId.slice(24)}`,
            'חוזה שכירות',
          );
          await linkApproved(db, occupancy.tenancyId, 'lease');
          await linkApproved(db, occupancy.tenancyId, 'handover_protocol');
          const before = await queueOf(db);
          assert.ok(
            before.some(
              (row) =>
                row.tenancy_id === occupancy.tenancyId &&
                row.missing === 'guarantor',
            ),
          );

          const first = await recordCompletenessException(db, {
            tenancyId: occupancy.tenancyId,
            rule: 'guarantor',
            actor: 'console',
            reason: 'אין ערב על חוזה דייר קיים',
            at: new Date('2026-09-08T12:00:00Z'),
          });
          assert.equal(first, 'recorded');
          const after = await queueOf(db);
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

describe('policy · gate misses join the incomplete-tenancy queue as named rules', () => {
  it('lists a draft missing an approved lease under the gate’s lease rule', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1081', {
          phone: '+972501110081',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
          status: 'DRAFT',
        });
        await linkApproved(db, occupancy.tenancyId, 'handover_protocol');
        await addGuarantor(db, occupancy.tenancyId);
        const queue = await queueOf(db);
        const mine = queue.filter(
          (row) => row.tenancy_id === occupancy.tenancyId,
        );
        assert.ok(
          mine.some((row) => row.missing === REQUIRED_FOR_ACTIVATION[0]),
        );
        assert.ok(!mine.some((row) => row.missing === 'guarantor'));
      });
    } finally {
      await pool.end();
    }
  });

  it('lists a draft missing an approved handover protocol under that rule', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1082', {
          phone: '+972501110082',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
          status: 'DRAFT',
        });
        await linkApproved(db, occupancy.tenancyId, 'lease');
        await addGuarantor(db, occupancy.tenancyId);
        const queue = await queueOf(db);
        const mine = queue.filter(
          (row) => row.tenancy_id === occupancy.tenancyId,
        );
        assert.ok(mine.some((row) => row.missing === 'handover_protocol'));
        assert.deepEqual(mine.map((row) => row.missing).sort(), [
          'handover_protocol',
        ]);
      });
    } finally {
      await pool.end();
    }
  });

  it('lists a tenancy blocked only by its start date under start_reached', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1083', {
          phone: '+972501110083',
          contactFrom: '2026-10-01',
          contactTo: null,
          tenancyFrom: '2026-10-01',
          tenancyTo: '2027-09-30',
          status: 'DRAFT',
        });
        await linkApproved(db, occupancy.tenancyId, 'lease');
        await linkApproved(db, occupancy.tenancyId, 'handover_protocol');
        await addGuarantor(db, occupancy.tenancyId);
        const queue = await queueOf(db);
        const mine = queue.filter(
          (row) => row.tenancy_id === occupancy.tenancyId,
        );
        assert.deepEqual(
          mine.map((row) => row.missing),
          ['start_reached'],
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('does not list a tenancy whose gate passes', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1084', {
          phone: '+972501110084',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
          status: 'DRAFT',
        });
        await linkApproved(db, occupancy.tenancyId, 'lease');
        await linkApproved(db, occupancy.tenancyId, 'handover_protocol');
        await addGuarantor(db, occupancy.tenancyId);
        const queue = await queueOf(db);
        assert.ok(!queue.some((row) => row.tenancy_id === occupancy.tenancyId));
      });
    } finally {
      await pool.end();
    }
  });

  it('stops listing a waived protocol, and a remaining miss carries who waived it', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const onlyProtocol = await seedOccupancy(db, '1562', {
          phone: '+972501110156',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
          status: 'DRAFT',
        });
        await linkApproved(db, onlyProtocol.tenancyId, 'lease');
        await addGuarantor(db, onlyProtocol.tenancyId);
        const reason = 'פרוטוקול קודם למערכת';
        await recordCompletenessException(db, {
          tenancyId: onlyProtocol.tenancyId,
          rule: 'handover_protocol',
          actor: 'אסף',
          reason,
          at: AT,
        });

        const waiting = await seedOccupancy(db, '1563', {
          phone: '+972501110157',
          contactFrom: '2026-10-01',
          contactTo: null,
          tenancyFrom: '2026-10-01',
          tenancyTo: '2027-09-30',
          status: 'DRAFT',
        });
        await linkApproved(db, waiting.tenancyId, 'lease');
        await addGuarantor(db, waiting.tenancyId);
        await recordCompletenessException(db, {
          tenancyId: waiting.tenancyId,
          rule: 'handover_protocol',
          actor: 'אסף',
          reason,
          at: AT,
        });

        const queue = await queueOf(db);
        assert.ok(
          !queue.some((row) => row.tenancy_id === onlyProtocol.tenancyId),
        );
        const mine = queue.filter(
          (row) => row.tenancy_id === waiting.tenancyId,
        );
        assert.deepEqual(
          mine.map((row) => row.missing),
          ['start_reached'],
        );
        assert.equal(mine[0]?.protocolWaiver?.actor, 'אסף');
        assert.equal(mine[0]?.protocolWaiver?.reason, reason);
        assert.equal(mine[0]?.protocolWaiver?.at, '2026-09-15');
      });
    } finally {
      await pool.end();
    }
  });
});

describe('policy · the ready-to-activate queue reads the gate', () => {
  it('moves a seeded draft from armed-soon to ready, and a missed day stays visible', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const near = await seedOccupancy(db, '1581', {
          phone: '+972501110158',
          contactFrom: '2026-09-29',
          contactTo: null,
          tenancyFrom: '2026-09-29',
          tenancyTo: '2027-09-28',
          status: 'DRAFT',
        });
        const far = await seedOccupancy(db, '1582', {
          phone: '+972501110159',
          contactFrom: '2026-09-30',
          contactTo: null,
          tenancyFrom: '2026-09-30',
          tenancyTo: '2027-09-29',
          status: 'DRAFT',
        });
        await linkApproved(db, near.tenancyId, 'lease');
        await linkApproved(db, near.tenancyId, 'handover_protocol');
        await linkApproved(db, far.tenancyId, 'lease');
        await linkApproved(db, far.tenancyId, 'handover_protocol');

        const on = (day: string) =>
          listActivationQueue(
            db,
            fixedClock(new Date(`${day}T09:00:00.000Z`)),
            listTenancyDocumentFacts,
          );

        const mine = <T extends { tenancy_id: string }>(rows: readonly T[]) =>
          rows.filter(
            (row) =>
              row.tenancy_id === near.tenancyId ||
              row.tenancy_id === far.tenancyId,
          );

        const armed = await on('2026-09-15');
        assert.equal(armed.withinDays, 14);
        assert.deepEqual(
          mine(armed.soon).map((row) => [row.tenancy_id, row.activatable_on]),
          [[near.tenancyId, '2026-09-29']],
        );
        assert.deepEqual(mine(armed.ready), []);

        const today = await on('2026-09-29');
        assert.deepEqual(
          mine(today.ready).map((row) => [
            row.tenancy_id,
            row.missed,
            row.ready_since,
          ]),
          [[near.tenancyId, false, '2026-09-29']],
        );
        assert.deepEqual(
          mine(today.soon).map((row) => [row.tenancy_id, row.activatable_on]),
          [[far.tenancyId, '2026-09-30']],
        );

        const missed = await on('2026-09-30');
        assert.deepEqual(
          mine(missed.ready).map((row) => [
            row.tenancy_id,
            row.missed,
            row.ready_since,
          ]),
          [
            [near.tenancyId, true, '2026-09-29'],
            [far.tenancyId, false, '2026-09-30'],
          ],
        );
        assert.deepEqual(mine(missed.soon), []);

        const printed = JSON.stringify(missed);
        assert.equal(printed.includes('Tenant of 1581'), false);
        assert.equal(printed.includes('Tenant of 1582'), false);
      });
    } finally {
      await pool.end();
    }
  });
});
