// POLICY CASE 3 — a guarantor never receives service information.
//
// Foundation rule 7, D4 in the workbook, and the third of the things the client called
// non-negotiable. docs/pipeline.md §6 states the bar in one line: *"The case asserts the insert is
// rejected, not that a form defaults politely."* A default is a thing someone trying to be helpful
// flips at 16:00 on a Thursday; a CHECK is not.
//
// Why it leaks if it is wrong: treating everyone on a lease as "the tenant" hands a household's
// business to the parent who co-signed — and the parent (ערב) is on the lease precisely because they
// are not in the apartment.
//
// **Written red first at slice 2.2**, against the real `guarantor_is_never_a_service_contact`
// constraint dropped from the local database: the insert below was accepted, and the case failed.
// The SQLSTATEs and the whole probe run are in tasks/evidence/2.2.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newId } from '../../src/kernel/ids.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { seedOccupancy, seedUnit } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

// Postgres SQLSTATE 23514, check_violation. Asserting the class rather than "it threw" is what stops
// a typo in a fixture reading as a constraint doing its job.
const CHECK_VIOLATION = '23514';

const TODAY = new Date('2026-09-05T00:00:00Z');
// **Its own numbers, not isolation.test.ts's.** These two files run in parallel against one database
// and both seed a tenant, so a shared contact value means each transaction waits on the other's
// speculative insertion inside `contact_value_resolves_to_one_party` — `40P01`, in the required
// gate, on a schedule nobody controls. Found at 2.6 when a third suite made the window wide enough
// to hit; the rule is 2.4's, applied to suites rather than only to register fixtures.
const TENANT_PHONE = '+972501113344';
const GUARANTOR_PHONE = '+972509998877';

describe('policy · a guarantor is never a service contact', () => {
  it('is rejected by the database, not defaulted politely', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // A real occupied unit, so the guarantor below is guaranteeing something.
          const tenancy = await seedOccupancy(db, '31', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          const guarantorId = newId();
          await db.query(
            `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'ערב — the co-signing parent')`,
            [guarantorId],
          );

          // The whole case. There is no toggle, no import path and no agent override: the row does
          // not exist to be corrected later.
          let rejected: string | undefined;
          try {
            await db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, 'GUARANTOR', true)`,
              [tenancy.tenancyId, guarantorId],
            );
          } catch (error) {
            rejected = (error as { code?: string }).code;
          }
          assert.equal(
            rejected,
            CHECK_VIOLATION,
            'a guarantor as a service contact must be rejected, not stored',
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('is on the lease all the same — the row exists, the reachability does not', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The constraint must not make a guarantor unrepresentable. A lease with an ערב on it is
          // the ordinary case, and the rule is about reachability and nothing else.
          const tenancy = await seedOccupancy(db, '32', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          const guarantorId = newId();
          await db.query(
            `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'ערב — the co-signing parent')`,
            [guarantorId],
          );
          await db.query(
            `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                        valid_from, valid_to)
             VALUES ($1, $2, 'PHONE', $3, true, '2026-01-01', NULL)`,
            [newId(), guarantorId, GUARANTOR_PHONE],
          );
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'GUARANTOR', false)`,
            [tenancy.tenancyId, guarantorId],
          );

          const onTheLease = await db.query<{ role: string }>(
            'SELECT role FROM tenancy_party WHERE party_id = $1',
            [guarantorId],
          );
          assert.equal(onTheLease.rows[0]?.role, 'GUARANTOR');

          // And the constraint is *spent*: the isolation join carries `AND tp.is_service_contact`,
          // so the guarantor's own number reaches no unit while the tenant's reaches theirs. A flag
          // nothing reads protects nobody, which is why both halves are asserted here.
          assert.deepEqual(
            await resolveUnitsByPhone(db, GUARANTOR_PHONE, TODAY),
            [],
            'the guarantor reaches nothing',
          );
          const theirs = await resolveUnitsByPhone(db, TENANT_PHONE, TODAY);
          assert.equal(theirs.length, 1);
          assert.equal(theirs[0]?.unit_id, tenancy.unitId);
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('holds for every role on one tenancy, not merely the first', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The other three roles may be service contacts, and a rule that quietly refused an
          // occupant would be a different bug wearing this one's clothes.
          const unitId = await seedUnit(db, '33');
          const tenancy = await seedOccupancy(db, '33', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            unitId,
          });
          for (const role of ['CO_TENANT', 'OCCUPANT']) {
            const partyId = newId();
            await db.query(
              `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
              [partyId, `${role} of 33`],
            );
            await db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, $3, true)`,
              [tenancy.tenancyId, partyId, role],
            );
          }
          const reachable = await db.query<{ count: string }>(
            `SELECT count(*) FROM tenancy_party
             WHERE tenancy_id = $1 AND is_service_contact`,
            [tenancy.tenancyId],
          );
          assert.equal(reachable.rows[0]?.count, '3');
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
