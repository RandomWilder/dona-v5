// POLICY CASE — closing a contact keeps the row, and after its end date the number
// resolves to nobody. #206. Written beside the recycled-number case.
//
// The recycled-number case inserts a contact that is already closed. This one closes
// it, which is the step an operator takes, and then asks the scope contract. A close
// that deleted the row would leave nobody reachable and would also leave nothing to
// answer "who held this number in March". Both have to fail.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../../src/kernel/clock.ts';
import { closePartyContact } from '../../src/parties/contract.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const PHONE = '+972521206206';
const END = '2026-06-30';
const ON_END = fixedClock(new Date('2026-06-30T00:00:00Z'));
const DAY_AFTER = fixedClock(new Date('2026-07-01T00:00:00Z'));

describe('policy · a closed contact', () => {
  it('keeps the row, and the number resolves to nobody after its end date', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const tenant = await seedOccupancy(db, '206', {
            phone: PHONE,
            contactFrom: '2024-05-01',
            contactTo: null,
            tenancyFrom: '2024-05-01',
            tenancyTo: '2027-05-01',
          });
          const open = await resolveUnitsByPhone(db, PHONE, ON_END);
          assert.equal(open.length, 1);
          assert.equal(open[0]?.unit_id, tenant.unitId);

          const contact = await db.query<{ contact_id: string }>(
            `SELECT contact_id FROM party_contact WHERE party_id = $1 AND channel = 'PHONE'`,
            [tenant.partyId],
          );
          await closePartyContact(db, {
            partyId: tenant.partyId,
            contactId: contact.rows[0]?.contact_id ?? '',
            validTo: END,
          });

          const kept = await db.query<{ valid_to: string }>(
            `SELECT valid_to::text AS valid_to
               FROM party_contact
              WHERE party_id = $1`,
            [tenant.partyId],
          );
          assert.equal(kept.rows.length, 1);
          assert.equal(kept.rows[0]?.valid_to, END);
          assert.equal(
            (await resolveUnitsByPhone(db, PHONE, ON_END)).length,
            1,
            'the end date is still a day the number identifies them',
          );
          assert.deepEqual(
            await resolveUnitsByPhone(db, PHONE, DAY_AFTER),
            [],
            'the day after the end date the number identifies nobody',
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
