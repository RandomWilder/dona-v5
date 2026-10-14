// POLICY CASE — a phone read off a lease reaches a flat only through a live letting.
//
// #235 (SPEC-parties "Contacts from a lease"). פתיחת טיוטה writes each approved phone and email as
// a `party_contact` on the person it belongs to. That write grants nothing: the isolation join
// decides who is reachable, and it answers from the letting's status on the day asked. A draft
// resolves to no unit; an `ACTIVE` letting covering the day resolves to its unit; a guarantor
// resolves to no unit at any point, because a guarantor is never a service contact.
//
// **Written red first.** Before #235 the lease declared no phone field and the press wrote no
// contact, so the tenant's phone resolved to nothing even once the letting was live, and the
// second assertion failed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../../src/kernel/clock.ts';
import { resolveUnitsByPhone } from '../../src/scope/contract.ts';
import { withOpening } from '../support/lease-opening.ts';
import { policyPool, skipReason } from './support.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const START = '2026-11-01';
const END = '2027-10-31';
const ASKED = fixedClock(new Date('2026-11-15T09:00:00.000Z'));
// Their own numbers: suites run in parallel against one database, and one contact value seeded by
// two of them waits on the other inside `contact_value_resolves_to_one_party` (guarantor.test.ts).
const TENANT_PHONE = '0541350235';
const GUARANTOR_PHONE = '0541350236';

const KEYS = [
  'start_date',
  'end_date',
  'main_tenant_name',
  'main_tenant_phone',
  'guarantor_name',
  'guarantor_phone',
] as const;

describe('policy · a phone from a lease reaches a flat only through a live letting', () => {
  it('resolves the tenant to no unit while DRAFT, to the unit once ACTIVE, and the guarantor never', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await pool.end();
    const ran = await withOpening(
      {
        tag: 'policy-235',
        on: ON,
        findings: (address) => [
          { field_key: 'start_date', value: START, word_ids: [0] },
          { field_key: 'end_date', value: END, word_ids: [1] },
          { field_key: 'apartment_number', value: '7', word_ids: [2] },
          { field_key: 'address', value: address, word_ids: [3] },
          { field_key: 'main_tenant_name', value: 'נועה ברק', word_ids: [4] },
          {
            field_key: 'main_tenant_phone',
            value: TENANT_PHONE,
            word_ids: [5],
          },
          { field_key: 'guarantor_name', value: 'אבי ברק', word_ids: [6] },
          {
            field_key: 'guarantor_phone',
            value: GUARANTOR_PHONE,
            word_ids: [7],
          },
        ],
      },
      async (o) => {
        for (const key of KEYS) {
          await o.approve(key);
        }
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));

        const asked = (phone: string) =>
          resolveUnitsByPhone(o.db, phone, ASKED).then((units) =>
            units.map((unit) => unit.unit_id),
          );

        assert.deepEqual(
          await asked(TENANT_PHONE),
          [],
          'a draft letting grants no access',
        );
        assert.deepEqual(await asked(GUARANTOR_PHONE), []);

        // A5's gate is what moves a letting to ACTIVE, and it is not this case's subject: the
        // status is set directly, so the case asserts the join and nothing upstream of it.
        await o.db.query(
          `UPDATE tenancy SET status = 'ACTIVE' WHERE unit_id = $1`,
          [o.unitId],
        );
        assert.deepEqual(
          await asked(TENANT_PHONE),
          [o.unitId],
          'the tenant reaches the flat once the letting is live on the asked date',
        );
        assert.deepEqual(
          await asked(GUARANTOR_PHONE),
          [],
          'a guarantor is never a service contact',
        );
      },
    );
    if (!ran) t.skip(skipReason);
  });
});
