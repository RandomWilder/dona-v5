// POLICY CASE 1 — the five-hop isolation join, both temporal predicates asserted.
//
// Foundation rule 1, and the first of the three things the client called non-negotiable. It is
// deterministic by design, so no eval case may test it (docs/pipeline.md §10): an eval that fails to
// reach another tenant's data proves the model behaved, not that the join is sound.
//
// Written at slice 1.7 against tables that do not exist. Pending until they do — never skipped, never
// `todo` (SPEC.md, Testing). The pending branch disarms itself: 1.9 brings unit, 2.1 party and
// party_contact, 2.2 tenancy and tenancy_party, and on the last of those these assertions start
// biting with no edit to this file.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../../src/kernel/clock.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { seedOccupancy, seedUnit } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

// A parameter, never CURRENT_DATE. SPEC.md's clock rule exists so a temporal predicate cannot fail
// on a Tuesday.
const TODAY = fixedClock(new Date('2026-09-05T00:00:00Z'));
const TENANT_PHONE = '+972501112233';
const NEIGHBOUR_PHONE = '+972504445566';
const NEXT_TENANT_PHONE = '+972507778899';

describe('policy · the five-hop isolation join', () => {
  it('resolves a current tenant to their own unit, and to no other', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const mine = await seedOccupancy(db, '12', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          // The neighbour exists precisely so "resolves to one unit" is a claim about isolation
          // rather than a claim about an empty table.
          await seedOccupancy(db, '13', {
            phone: NEIGHBOUR_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });

          const scope = await resolveUnitsByPhone(db, TENANT_PHONE, TODAY);
          assert.equal(scope.length, 1);
          assert.equal(scope[0]?.unit_id, mine.unitId);
          assert.equal(scope[0]?.unit_number, '12');
          assert.equal(scope[0]?.party_id, mine.partyId);
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('drops a contact whose validity has closed — temporal predicate one', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The tenancy is live and the party is on it. Only the *contact* has been dated closed —
          // which is the state of every number that has been handed back.
          await seedOccupancy(db, '14', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: '2026-06-30',
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
          });
          assert.deepEqual(
            await resolveUnitsByPhone(db, TENANT_PHONE, TODAY),
            [],
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('drops a tenancy that is not active today — temporal predicate two', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // The mirror of the case above: the contact is still current — the person kept their
          // number — and the tenancy is the half that ended.
          //
          // **The status stays ACTIVE on purpose.** A lease that ended in June and a status nobody
          // updated is the ordinary state of an operations database, and it is the only version of
          // this case that tests the date predicate: with `status = 'ENDED'` the row is excluded by
          // the status filter and the two temporal comparisons could be deleted with the case still
          // green. Mutation-checked at 1.7 — deleting the tenancy-date predicate from the join must turn
          // this red, and it does.
          await seedOccupancy(db, '15', {
            phone: TENANT_PHONE,
            contactFrom: '2025-01-01',
            contactTo: null,
            tenancyFrom: '2025-01-01',
            tenancyTo: '2026-06-30',
          });
          assert.deepEqual(
            await resolveUnitsByPhone(db, TENANT_PHONE, TODAY),
            [],
          );

          // And the lower bound, which is the half nobody remembers: a lease signed for next month
          // is not a lease today, and the incoming tenant is not yet inside the unit's scope.
          await seedOccupancy(db, '17', {
            phone: NEXT_TENANT_PHONE,
            contactFrom: '2026-08-01',
            contactTo: null,
            tenancyFrom: '2026-10-01',
            tenancyTo: '2027-10-01',
          });
          assert.deepEqual(
            await resolveUnitsByPhone(db, NEXT_TENANT_PHONE, TODAY),
            [],
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('never resolves a guarantor to the unit they guarantee', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // Foundation rule 7 at the front door. `is_service_contact` is forced false for
          // role = GUARANTOR by a database constraint (slice 2.2); this asserts the join *spends*
          // that constraint, because a flag nothing reads protects nobody. The constraint itself is
          // policy case 3 and is not this case's job.
          const unitId = await seedUnit(db, '16');
          await seedOccupancy(db, '16', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            role: 'GUARANTOR',
            isServiceContact: false,
            unitId,
          });
          assert.deepEqual(
            await resolveUnitsByPhone(db, TENANT_PHONE, TODAY),
            [],
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });
});

// POLICY CASE 1b — the join asks about the office's day, not the UTC day. Slice 7.2b.
//
// 7.2's verify click ran at 00:02 IDT and stamped a declaration with the previous date, because
// every date in this system was derived from the instant in UTC. As a stamp that is cosmetic. This
// is the same defect where it is not cosmetic: `TENANCY_ACTIVE_TODAY` bound to the UTC day, which
// between midnight and 03:00 local is yesterday.
//
// A handover is the shape that makes it visible, and it is an ordinary one — the outgoing lease ends
// on the 14th, the incoming one starts on the 15th, and **both ends of the tenancy-active predicate
// are inclusive**, so the day the join is handed decides which of the two people lives here. At
// 00:30 on the 15th the office would say the new tenant does. Asked in UTC, the join says the old
// one still does and the new one does not yet: both halves wrong at once, and the wrong one is a
// real person in someone else's scope.
//
// (The predicate is not quoted here on purpose. Guard two matches it in a comment as readily as in
// SQL, and guard five does the same to the UTC-day expression — which is the guards working, not an
// inconvenience.)
//
// The instant is `2026-09-14T21:30:00Z`, which is 00:30 on the 15th in Jerusalem. It is written as a
// UTC instant on purpose: an instant is what a clock has, and the whole claim of this case is that
// it does not know what day it is until someone names a zone.
const HANDOVER = fixedClock(new Date('2026-09-14T21:30:00Z'));
const OUTGOING_PHONE = '+972502223344';
const INCOMING_PHONE = '+972503334455';

describe('policy · the join asks about the office day', () => {
  it('at 00:30 IDT resolves the tenancy that starts today, not the one that ended yesterday', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const unitId = await seedUnit(db, '17');
          // Ends on the 14th. The last day of a lease counts, so this tenancy is live right up to
          // the end of the 14th and not one minute into the 15th.
          const outgoing = await seedOccupancy(db, '17', {
            phone: OUTGOING_PHONE,
            contactFrom: '2025-09-01',
            contactTo: null,
            tenancyFrom: '2025-09-01',
            tenancyTo: '2026-09-14',
            unitId,
          });
          // Starts on the 15th, in the same unit, which is what a handover is.
          const incoming = await seedOccupancy(db, '17', {
            phone: INCOMING_PHONE,
            contactFrom: '2026-09-15',
            contactTo: null,
            tenancyFrom: '2026-09-15',
            tenancyTo: '2027-09-14',
            unitId,
          });

          const departed = await resolveUnitsByPhone(
            db,
            OUTGOING_PHONE,
            HANDOVER,
          );
          assert.deepEqual(
            departed.map((row) => row.party_id),
            [],
            `the tenant whose lease ended yesterday resolves to nothing; scope leaked ${outgoing.partyId}`,
          );

          const arriving = await resolveUnitsByPhone(
            db,
            INCOMING_PHONE,
            HANDOVER,
          );
          assert.deepEqual(
            arriving.map((row) => row.party_id),
            [incoming.partyId],
            'the tenant whose lease starts today resolves to their own unit at 00:30 local',
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
