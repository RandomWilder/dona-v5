// POLICY CASE 2 — a recycled phone number resolves to nobody.
//
// docs/pipeline.md §6 calls this "the case the model exists to make representable, so it is the one
// to write first". Israeli mobile numbers get reassigned: a tenancy ends, the number goes to someone
// else, that person messages the agent. The join must return zero rows — not the previous tenant's
// unit, and not a smaller amount of it.
//
// v3 could not express this. `PartyContact` there was undated, so the previous tenant's number stayed
// attached to the previous tenant forever and a stranger reached someone else's apartment. That was a
// security defect and not a modelling preference (docs/from-v3.md Tier 3), which is why the dating is
// a foundation rule and this case is a required check rather than a unit test.
//
// Written at slice 1.7 against tables that do not exist; pending until they do, and disarming itself
// when they arrive (SPEC.md, Testing).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newId } from '../../src/kernel/ids.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const TODAY = new Date('2026-09-05T00:00:00Z');
// One number, two people, in that order.
const RECYCLED_PHONE = '+972521234567';
// The number the same tenant moved to, which is how a live tenancy keeps a live contact.
const CURRENT_PHONE = '+972523334455';

describe('policy · a recycled number', () => {
  it('resolves to nobody once the tenancy and the contact have both closed', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The previous tenant: moved out on 30 June, number handed back the same day.
          await seedOccupancy(db, '21', {
            phone: RECYCLED_PHONE,
            contactFrom: '2024-05-01',
            contactTo: '2026-06-30',
            tenancyFrom: '2024-05-01',
            tenancyTo: '2026-06-30',
            status: 'ENDED',
          });
          // The new holder of the same number. No tenancy anywhere: a member of the public who was
          // reassigned a number by their carrier and messaged the service line.
          await db.query(
            `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'New holder of a reassigned number')`,
            [newId()],
          );

          assert.deepEqual(
            await resolveUnitsByPhone(db, RECYCLED_PHONE, TODAY),
            [],
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('stops a stranger reaching a unit whose tenancy is still running', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // **The case the contact dating exists for, and the only one where it is load-bearing.**
          // The tenant changed carrier in June and their old number was reassigned; the tenancy runs
          // to 2027 and the unit is occupied. Nothing about the *tenancy* is stale, so neither
          // tenancy predicate applies — the closed `party_contact` row is the whole of the defence.
          // Mutation-checked at 1.7: delete the contact-validity predicate from the join and this
          // case is one of only two that notice.
          const tenant = await seedOccupancy(db, '24', {
            phone: RECYCLED_PHONE,
            contactFrom: '2024-05-01',
            contactTo: '2026-06-30',
            tenancyFrom: '2024-05-01',
            tenancyTo: '2027-05-01',
          });
          // The same live tenancy, reachable on the number the tenant actually uses now.
          await db.query(
            `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                        valid_from, valid_to)
             VALUES ($1, $2, 'PHONE', $3, true, '2026-07-01', NULL)`,
            [newId(), tenant.partyId, CURRENT_PHONE],
          );

          assert.deepEqual(
            await resolveUnitsByPhone(db, RECYCLED_PHONE, TODAY),
            [],
            'the stranger holding the recycled number reaches nothing',
          );
          const theirs = await resolveUnitsByPhone(db, CURRENT_PHONE, TODAY);
          assert.equal(
            theirs.length,
            1,
            'and the tenant still reaches their own unit',
          );
          assert.equal(theirs[0]?.unit_id, tenant.unitId);
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('resolves to the new holder’s own unit and never to the previous one', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The sharper version, and the one that catches a join that "works" by returning
          // everything the number ever touched: the new holder is a tenant too, of a different unit.
          const previous = await seedOccupancy(db, '22', {
            phone: RECYCLED_PHONE,
            contactFrom: '2024-05-01',
            contactTo: '2026-06-30',
            tenancyFrom: '2024-05-01',
            tenancyTo: '2026-06-30',
            status: 'ENDED',
          });
          const current = await seedOccupancy(db, '23', {
            phone: RECYCLED_PHONE,
            contactFrom: '2026-07-15',
            contactTo: null,
            tenancyFrom: '2026-07-15',
            tenancyTo: '2027-07-14',
          });

          const scope = await resolveUnitsByPhone(db, RECYCLED_PHONE, TODAY);
          assert.equal(scope.length, 1);
          assert.equal(scope[0]?.unit_id, current.unitId);
          assert.notEqual(scope[0]?.unit_id, previous.unitId);
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
