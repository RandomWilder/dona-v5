// POLICY — a guarantor cannot be the requester of a service call.
//
// Foundation rule 7, spent on the call rather than only on the contact: linking a
// party to a call is how the office identifies a requester, and a ערב is on the
// lease precisely because they are not the person the office serves. #183.
//
// Written red first, before `requester_party_id` and the trigger that rejects the
// link. The first run stored nothing to reject: the update failed with 42703
// (undefined_column) rather than 23514. The case asserts the update is rejected,
// not that a form hides the name.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

// Postgres SQLSTATE 23514, check_violation. Same class as
// `guarantor_is_never_a_service_contact`: the row is rejected, not stored.
const CHECK_VIOLATION = '23514';

const AT = fixedClock(new Date('2026-10-06T12:00:00.000Z'));
// Own numbers, not guarantor.test.ts's. Those suites run in parallel against one
// database and a shared contact value deadlocks inside
// `contact_value_resolves_to_one_party`.
const TENANT_PHONE = '+972501830183';
const TENANT_PHONE_B = '+972501830185';
const OTHER_PHONE = '+972501830186';

describe('policy · a guarantor is never the requester of a service call', () => {
  it('is rejected by the database, not defaulted politely', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const tenancy = await seedOccupancy(db, '183', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          const guarantorId = newId();
          await db.query(
            `INSERT INTO party (party_id, party_kind, family_name)
             VALUES ($1, 'PERSON', 'ערב — the co-signing parent')`,
            [guarantorId],
          );
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'GUARANTOR', false)`,
            [tenancy.tenancyId, guarantorId],
          );

          const { account } = await addOperator(db, AT, {
            email: 'ops@call-requester.policy',
            role: 'OPERATOR',
          });
          const callId = newId();
          await db.query(
            `INSERT INTO service_call
               (service_call_id, source_channel, state, description, sender_label,
                sender_unknown, opened_at, opened_by)
             VALUES ($1, 'PHONE', 'NEW', 'נזילה', NULL, true, $2, $3)`,
            [callId, AT.now(), account.staffAccountId],
          );

          let rejected: string | undefined;
          try {
            await db.query(
              `UPDATE service_call
                  SET requester_party_id = $2, state = 'IDENTIFIED'
                WHERE service_call_id = $1`,
              [callId, guarantorId],
            );
          } catch (error) {
            rejected = (error as { code?: string }).code;
          }
          assert.equal(
            rejected,
            CHECK_VIOLATION,
            'a guarantor as the requester must be rejected, not stored',
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('allows a service contact who also guarantees another lease', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const home = await seedOccupancy(db, '1832', {
            phone: TENANT_PHONE_B,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          const other = await seedOccupancy(db, '1833', {
            phone: OTHER_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'GUARANTOR', false)`,
            [other.tenancyId, home.partyId],
          );

          const { account } = await addOperator(db, AT, {
            email: 'ops-both@call-requester.policy',
            role: 'OPERATOR',
          });
          const callId = newId();
          await db.query(
            `INSERT INTO service_call
               (service_call_id, source_channel, state, description, sender_label,
                sender_unknown, opened_at, opened_by)
             VALUES ($1, 'PHONE', 'NEW', 'נזילה', NULL, true, $2, $3)`,
            [callId, AT.now(), account.staffAccountId],
          );
          await db.query(
            `UPDATE service_call
                SET requester_party_id = $2, state = 'IDENTIFIED'
              WHERE service_call_id = $1`,
            [callId, home.partyId],
          );
          const stored = await db.query<{
            state: string;
            requester_party_id: string;
          }>(
            `SELECT state, requester_party_id FROM service_call
              WHERE service_call_id = $1`,
            [callId],
          );
          assert.equal(stored.rows[0]?.state, 'IDENTIFIED');
          assert.equal(stored.rows[0]?.requester_party_id, home.partyId);
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
