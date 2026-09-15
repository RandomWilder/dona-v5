// A5 — a tenancy becomes active only when a person says so, and only when the gate is satisfied.
//
// SPEC-flows.md A5, SPEC-tenancy.md #106, docs/pipeline.md §6: written red first. Activation is a
// new deterministic constraint nobody may decide by judgement. The case builds its own rows in a
// rolled-back transaction and asserts each refusal reason independently, plus the passing case.
//
// It imports `REQUIRED_FOR_ACTIVATION` and never a second copy of the list.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listTenancyDocumentFacts } from '../../src/evidence/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import type { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import {
  activateTenancy,
  activationGate,
  expireDueTenancies,
  REQUIRED_FOR_ACTIVATION,
} from '../../src/tenancy/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-15T09:00:00.000Z');
const CLOCK = fixedClock(AT);
const ACTOR = 'אסף';

async function linkApproved(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
  typeKey: string,
  validTo: string | null = null,
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
       ingested_at, verification_verdict, valid_to
     ) VALUES ($1, $2, $3, $4, $5, 'unguarded', $6)`,
    [
      documentId,
      documentTypeId,
      `gs://x/${documentId}.pdf`,
      `hash-${documentId}`,
      AT,
      validTo,
    ],
  );
  await db.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
    [documentId, tenancyId],
  );
  return documentId;
}

async function seedDraft(
  db: Parameters<typeof seedOccupancy>[0],
  unitNumber: string,
  dates: { from: string; to: string },
) {
  return seedOccupancy(db, unitNumber, {
    phone: `+97250${unitNumber.padStart(7, '0')}`,
    contactFrom: dates.from,
    contactTo: null,
    tenancyFrom: dates.from,
    tenancyTo: dates.to,
    status: 'DRAFT',
  });
}

async function refuse(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
): Promise<KernelError> {
  try {
    await activateTenancy(
      db,
      CLOCK,
      { tenancyId, actor: ACTOR },
      listTenancyDocumentFacts,
    );
    throw new Error('expected activation to refuse');
  } catch (error) {
    return error as KernelError;
  }
}

describe('policy · activation is a person command with a named gate', () => {
  it('imports the required set from the command, never a second copy', () => {
    assert.deepEqual(
      [...REQUIRED_FOR_ACTIVATION],
      ['lease', 'handover_protocol'],
    );
  });

  it('refuses without an approved lease, and names that reason', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1061', {
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await linkApproved(db, occupancy.tenancyId, 'handover_protocol');
        const error = await refuse(db, occupancy.tenancyId);
        assert.equal(error.code, 'invalid');
        assert.ok(error.details);
        const checks = error.details.checks as Array<{
          rule: string;
          passed: boolean;
        }>;
        const lease = checks.find((row) => row.rule === 'lease');
        assert.equal(lease?.passed, false);
        const protocol = checks.find((row) => row.rule === 'handover_protocol');
        assert.equal(protocol?.passed, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses without an approved handover protocol, and names that reason', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1062', {
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await linkApproved(db, occupancy.tenancyId, 'lease');
        const error = await refuse(db, occupancy.tenancyId);
        assert.equal(error.code, 'invalid');
        const checks =
          (error.details?.checks as Array<{ rule: string; passed: boolean }>) ??
          [];
        assert.equal(
          checks.find((row) => row.rule === 'handover_protocol')?.passed,
          false,
        );
        assert.equal(checks.find((row) => row.rule === 'lease')?.passed, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses before the lease start date, with its own reason', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1063', {
          from: '2026-10-01',
          to: '2027-01-01',
        });
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          await linkApproved(db, occupancy.tenancyId, typeKey);
        }
        const error = await refuse(db, occupancy.tenancyId);
        assert.equal(error.code, 'invalid');
        const checks =
          (error.details?.checks as Array<{ rule: string; passed: boolean }>) ??
          [];
        assert.equal(
          checks.find((row) => row.rule === 'start_reached')?.passed,
          false,
        );
        assert.equal(error.details?.activatableOn, '2026-10-01');
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          assert.equal(
            checks.find((row) => row.rule === typeKey)?.passed,
            true,
          );
        }
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses after the lease end date, with its own reason', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1064', {
          from: '2026-01-01',
          to: '2026-09-14',
        });
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          await linkApproved(db, occupancy.tenancyId, typeKey);
        }
        const error = await refuse(db, occupancy.tenancyId);
        assert.equal(error.code, 'invalid');
        const checks =
          (error.details?.checks as Array<{ rule: string; passed: boolean }>) ??
          [];
        assert.equal(
          checks.find((row) => row.rule === 'within_term')?.passed,
          false,
        );
        assert.equal(
          checks.find((row) => row.rule === 'start_reached')?.passed,
          true,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('activates when every check passed, and records who and when', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1065', {
          from: '2026-01-01',
          to: '2027-01-01',
        });
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          await linkApproved(db, occupancy.tenancyId, typeKey);
        }
        const gate = await activationGate(
          db,
          CLOCK,
          occupancy.tenancyId,
          listTenancyDocumentFacts,
        );
        assert.equal(gate.checks.length, REQUIRED_FOR_ACTIVATION.length + 2);
        assert.ok(gate.checks.every((check) => check.passed));
        assert.equal(gate.canActivate, true);
        await activateTenancy(
          db,
          CLOCK,
          { tenancyId: occupancy.tenancyId, actor: ACTOR },
          listTenancyDocumentFacts,
        );
        const row = await db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(row.rows[0]?.status, 'ACTIVE');
        const event = await db.query<{
          kind: string;
          actor: string;
          field: string;
          old_value: string | null;
          new_value: string;
          source_document_id: string | null;
          at: Date;
        }>(
          `SELECT kind, actor, field, old_value, new_value, source_document_id, at
             FROM tenancy_event WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(event.rows.length, 1);
        assert.equal(event.rows[0]?.kind, 'activated');
        assert.equal(event.rows[0]?.actor, ACTOR);
        assert.equal(event.rows[0]?.field, 'status');
        assert.equal(event.rows[0]?.old_value, 'DRAFT');
        assert.equal(event.rows[0]?.new_value, 'ACTIVE');
        assert.equal(event.rows[0]?.source_document_id, null);
        assert.equal(event.rows[0]?.at.toISOString(), AT.toISOString());
      });
    } finally {
      await pool.end();
    }
  });

  it('does not activate a draft when the clock passes the start date', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedDraft(db, '1066', {
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await expireDueTenancies(db, CLOCK);
        const row = await db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(row.rows[0]?.status, 'DRAFT');
      });
    } finally {
      await pool.end();
    }
  });

  it('an expired tenancy is ended and cannot be activated again', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1067', {
          phone: '+972501061067',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2026-09-01',
          status: 'ACTIVE',
        });
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          await linkApproved(db, occupancy.tenancyId, typeKey);
        }
        await expireDueTenancies(db, CLOCK);
        const ended = await db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(ended.rows[0]?.status, 'ENDED');
        const error = await refuse(db, occupancy.tenancyId);
        assert.equal(error.code, 'invalid');
        const still = await db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(still.rows[0]?.status, 'ENDED');
      });
    } finally {
      await pool.end();
    }
  });

  it('a document lapsing after activation raises a flag and leaves status alone', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const occupancy = await seedOccupancy(db, '1068', {
          phone: '+972501061068',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
          status: 'ACTIVE',
        });
        for (const typeKey of REQUIRED_FOR_ACTIVATION) {
          await linkApproved(db, occupancy.tenancyId, typeKey, '2026-09-01');
        }
        await expireDueTenancies(db, CLOCK);
        const gate = await activationGate(
          db,
          CLOCK,
          occupancy.tenancyId,
          listTenancyDocumentFacts,
        );
        assert.ok(gate.flags.length > 0);
        assert.ok(gate.flags.every((flag) => flag.rule === 'lapsed_document'));
        const status = await db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [occupancy.tenancyId],
        );
        assert.equal(status.rows[0]?.status, 'ACTIVE');
      });
    } finally {
      await pool.end();
    }
  });
});
