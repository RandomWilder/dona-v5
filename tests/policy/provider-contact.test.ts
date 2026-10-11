// POLICY CASE — a phone on a provider's party resolves to no unit. #208.
//
// The contact is an ordinary one. The provider is not on a lease, so the
// isolation join has nothing to return. Asserted through the scope contract,
// beside the recycled-number case. A join that started treating a provider as
// an occupant would hand a contractor a unit.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkProvider } from '../../src/estate/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { addPartyContact, createParty } from '../../src/parties/contract.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { addOperator } from '../../src/staff/contract.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const PHONE = '+972521208208';
const TODAY = fixedClock(new Date('2026-10-11T09:00:00Z'));

describe('policy · a provider contact', () => {
  it('resolves to no unit', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const company = await createParty(db, {
            kind: 'COMPANY',
            legalName: 'קבלן מדיניות208',
            preferredLanguage: 'he',
          });
          const { account } = await addOperator(db, TODAY, {
            email: 'ops@provider-contact.test',
            role: 'OPERATOR',
          });
          await linkProvider(db, TODAY, {
            partyId: company.id,
            kind: 'CONTRACTOR',
            actorId: account.staffAccountId,
            actorRole: 'OPERATOR',
          });
          await addPartyContact(db, {
            partyId: company.id,
            channel: 'PHONE',
            value: PHONE,
            label: null,
            validFrom: '2026-01-01',
          });
          const open = await db.query<{ valid_to: string | null }>(
            `SELECT valid_to::text AS valid_to
               FROM party_contact
              WHERE party_id = $1 AND channel = 'PHONE'`,
            [company.id],
          );
          assert.equal(open.rows.length, 1);
          assert.equal(open.rows[0]?.valid_to, null);
          assert.deepEqual(await resolveUnitsByPhone(db, PHONE, TODAY), []);
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
