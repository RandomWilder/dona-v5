// #236. Same-name candidates, and the same lease offered again at פתיחת טיוטה.
//
// Seam: HTTP against A16, the operator's own path, through the harness #234's suite uses. A person
// nobody matches by ת.ז., phone or email is shown beside the parties who share that given and
// family name. Nothing is chosen for them: opening writes a new party. Choosing one attaches the
// person to it, and their approved contacts still go through the overlap refusal. A tenancy that
// already holds the same ת.ז. on the same start date is offered back: attach writes the document
// link and nothing else, and opening a new draft still does what it did.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  type Opening,
  withOpening,
} from '../../tests/support/lease-opening.ts';
import { upsertUnitRow } from '../estate/contract.ts';
import { skipReason } from '../kernel/pg-support.ts';
import {
  addPartyContact,
  createParty,
  setPrimaryPartyContact,
  upsertParty,
} from '../parties/contract.ts';
import {
  findTermsProfileByName,
  upsertTenancy,
  upsertTenancyParty,
} from '../tenancy/contract.ts';
import { DEFAULT_TERMS_PROFILE } from './contract.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const START = '2026-11-01';
const END = '2027-10-31';
const GIVEN = 'יוסף236';
const FAMILY = 'בדיקה236';
const MAIN = `${GIVEN} ${FAMILY}`;
const SECOND = 'רחל לוי';
const GUARANTOR = 'משה דוד';

const household = (
  extra: readonly Finding[] = [],
): ((address: string) => Finding[]) => {
  return (address) => [
    { field_key: 'start_date', value: START, word_ids: [0] },
    { field_key: 'end_date', value: END, word_ids: [1] },
    { field_key: 'apartment_number', value: '7', word_ids: [2] },
    { field_key: 'address', value: address, word_ids: [3] },
    { field_key: 'main_tenant_name', value: MAIN, word_ids: [4] },
    { field_key: 'second_tenant_name', value: SECOND, word_ids: [5] },
    { field_key: 'guarantor_name', value: GUARANTOR, word_ids: [6] },
    ...extra,
  ];
};

const NAMES_AND_DATES = [
  'start_date',
  'end_date',
  'main_tenant_name',
  'second_tenant_name',
  'guarantor_name',
] as const;

const open = (
  tag: string,
  extra: readonly Finding[],
  run: (opening: Opening) => Promise<void>,
) => withOpening({ tag, on: ON, findings: household(extra) }, run);

async function fieldId(o: Opening, fieldKey: string): Promise<string> {
  const found = await o.db.query<{ id: string }>(
    `SELECT e.extracted_field_id AS id FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
      WHERE e.document_id = $1 AND f.field_key = $2`,
    [o.documentId, fieldKey],
  );
  const id = found.rows[0]?.id;
  assert.ok(id, `no ${fieldKey} row`);
  return id;
}

async function namedParties(o: Opening): Promise<string[]> {
  const found = await o.db.query<{ party_id: string }>(
    `SELECT party_id FROM party
      WHERE given_name = $1 AND family_name = $2
      ORDER BY party_id`,
    [GIVEN, FAMILY],
  );
  return found.rows.map((row) => row.party_id);
}

async function primaryOn(o: Opening, unitId: string): Promise<string | null> {
  const found = await o.db.query<{ party_id: string }>(
    `SELECT tp.party_id FROM tenancy t
       JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
      WHERE t.unit_id = $1 AND tp.role = 'PRIMARY_TENANT'`,
    [unitId],
  );
  return found.rows[0]?.party_id ?? null;
}

async function anotherFlat(o: Opening, tag: string): Promise<string> {
  const row = await upsertUnitRow(o.db, {
    project: {
      name: `מכרז ${tag}`,
      projectCode: `TEST-${tag}`,
      tenderRef: null,
      status: 'ACTIVE',
    },
    building: {
      name: `בניין ${tag}`,
      addressLine: `האלון ${tag}`,
      city: `עיר ${tag}`,
      projectCode: `TEST-${tag}`,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
    },
    unit: {
      spaceName: 'דירה 1',
      unitNumber: '1',
      rooms: 2,
      areaSqm: 50,
      hasMamad: false,
      parkingSpaceName: null,
      storageSpaceName: null,
      warrantyEndDate: null,
      conditionStatus: 'READY',
    },
    floor: '1',
  });
  return row.unitId;
}

describe('evidence · #236 same-name candidates and the same lease', () => {
  it('shows a same-name party as a candidate, and opening without a choice creates a new party', async (t) => {
    const ran = await open('same-236-new', [], async (o) => {
      const existing = await createParty(o.db, {
        kind: 'PERSON',
        givenName: GIVEN,
        familyName: FAMILY,
        preferredLanguage: 'he',
      });
      for (const key of NAMES_AND_DATES) {
        await o.approve(key);
      }
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200, screen.body.slice(0, 300));
      const main = await fieldId(o, 'main_tenant_name');
      assert.match(screen.body, /אותו אדם\?/);
      assert.match(
        screen.body,
        new RegExp(`name="party-${main}" value="" checked`),
      );
      assert.match(screen.body, new RegExp(`/parties/${existing.id}`));
      assert.match(
        screen.body,
        new RegExp(`name="party-${main}" value="${existing.id}"`),
      );
      assert.doesNotMatch(
        screen.body,
        new RegExp(`value="${existing.id}"[^>]*checked`),
      );

      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: DEFAULT_TERMS_PROFILE,
      });
      assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));
      const parties = await namedParties(o);
      assert.equal(parties.length, 2);
      assert.ok(parties.includes(existing.id));
      const primary = await primaryOn(o, o.unitId);
      assert.notEqual(primary, existing.id);
    });
    if (!ran) t.skip(skipReason);
  });

  it('choosing the candidate attaches the person and writes their approved phone', async (t) => {
    const phone = '0522361101';
    const ran = await open(
      'same-236-link',
      [{ field_key: 'main_tenant_phone', value: phone, word_ids: [7] }],
      async (o) => {
        const existing = await createParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          preferredLanguage: 'he',
        });
        for (const key of [...NAMES_AND_DATES, 'main_tenant_phone']) {
          await o.approve(key);
        }
        const main = await fieldId(o, 'main_tenant_name');
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
          [`party-${main}`]: existing.id,
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
        assert.deepEqual(await namedParties(o), [existing.id]);
        assert.equal(await primaryOn(o, o.unitId), existing.id);
        const contacts = await o.db.query<{ value: string }>(
          `SELECT value FROM party_contact
            WHERE party_id = $1 AND channel = 'PHONE' AND valid_to IS NULL`,
          [existing.id],
        );
        assert.deepEqual(
          contacts.rows.map((row) => row.value),
          ['+972522361101'],
        );
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('refuses the link when the approved phone is already held, and writes nothing', async (t) => {
    const phone = '0522361102';
    const ran = await open(
      'same-236-held',
      [
        {
          field_key: 'main_tenant_id_number',
          value: '236000101',
          word_ids: [7],
        },
        { field_key: 'main_tenant_phone', value: phone, word_ids: [8] },
      ],
      async (o) => {
        const sameName = await createParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          preferredLanguage: 'he',
        });
        const holder = await createParty(o.db, {
          kind: 'PERSON',
          givenName: 'נועה',
          familyName: 'ברק',
          preferredLanguage: 'he',
        });
        const added = await addPartyContact(o.db, {
          partyId: holder.id,
          channel: 'PHONE',
          value: '+972522361102',
          label: null,
          validFrom: '2026-01-01',
        });
        await setPrimaryPartyContact(o.db, {
          partyId: holder.id,
          contactId: added.contactId,
        });
        for (const key of [
          ...NAMES_AND_DATES,
          'main_tenant_id_number',
          'main_tenant_phone',
        ]) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.match(screen.body, /נועה ברק/);
        assert.match(screen.body, /כבר שייך/);
        assert.doesNotMatch(screen.body, /אותו אדם\?/);
        const main = await fieldId(o, 'main_tenant_name');
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
          [`party-${main}`]: sameName.id,
        });
        assert.equal(pressed.statusCode, 409, pressed.body.slice(0, 400));
        assert.match(pressed.body, /נועה ברק/);
        assert.deepEqual(await o.counts(), {
          tenancies: 0,
          tenancyLinks: 0,
          signatories: 0,
        });
        assert.deepEqual(await namedParties(o), [sameName.id]);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('does not offer a same-name party when the lease printed a ת.ז.', async (t) => {
    const nationalId = '236000105';
    const ran = await open(
      'same-236-id',
      [
        {
          field_key: 'main_tenant_id_number',
          value: nationalId,
          word_ids: [7],
        },
      ],
      async (o) => {
        const existing = await createParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          preferredLanguage: 'he',
        });
        for (const key of [...NAMES_AND_DATES, 'main_tenant_id_number']) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(screen.statusCode, 200, screen.body.slice(0, 300));
        assert.doesNotMatch(screen.body, /אותו אדם\?/);
        const main = await fieldId(o, 'main_tenant_name');
        const forced = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
          [`party-${main}`]: existing.id,
        });
        assert.equal(forced.statusCode, 409, forced.body.slice(0, 300));
        assert.deepEqual(await o.counts(), {
          tenancies: 0,
          tenancyLinks: 0,
          signatories: 0,
        });

        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));
        const primary = await primaryOn(o, o.unitId);
        assert.notEqual(primary, existing.id);
        const keyed = await o.db.query<{ party_id: string }>(
          `SELECT party_id FROM party
            WHERE national_id_key = party_national_id_key('PERSON', $1)`,
          [nationalId],
        );
        assert.deepEqual(
          keyed.rows.map((row) => row.party_id),
          [primary],
        );
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('lists two parties with the same name, and chooses neither', async (t) => {
    const ran = await open('same-236-two', [], async (o) => {
      const first = await createParty(o.db, {
        kind: 'PERSON',
        givenName: GIVEN,
        familyName: FAMILY,
        preferredLanguage: 'he',
      });
      const second = await createParty(o.db, {
        kind: 'PERSON',
        givenName: GIVEN,
        familyName: FAMILY,
        preferredLanguage: 'he',
      });
      for (const key of NAMES_AND_DATES) {
        await o.approve(key);
      }
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200, screen.body.slice(0, 300));
      const main = await fieldId(o, 'main_tenant_name');
      assert.match(
        screen.body,
        new RegExp(`name="party-${main}" value="" checked`),
      );
      for (const id of [first.id, second.id]) {
        assert.match(screen.body, new RegExp(`/parties/${id}`));
        assert.match(
          screen.body,
          new RegExp(`name="party-${main}" value="${id}"`),
        );
        assert.doesNotMatch(
          screen.body,
          new RegExp(`value="${id}"[^>]*checked`),
        );
      }
    });
    if (!ran) t.skip(skipReason);
  });

  it('offers the tenancy a person already holds on this start date, and attach writes only the link', async (t) => {
    const nationalId = '236000102';
    const ran = await open(
      'same-236-attach',
      [
        {
          field_key: 'main_tenant_id_number',
          value: nationalId,
          word_ids: [7],
        },
      ],
      async (o) => {
        const party = await upsertParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          nationalId,
          preferredLanguage: 'he',
        });
        const unitId = await anotherFlat(o, 'same-236-attach-b');
        const profileId = await findTermsProfileByName(
          o.db,
          DEFAULT_TERMS_PROFILE,
        );
        assert.ok(profileId);
        const existing = await upsertTenancy(o.db, {
          unitId,
          startDate: START,
          endDate: END,
          status: 'DRAFT',
          termsProfileId: profileId,
          noticeDate: null,
          actualMoveOut: null,
        });
        await upsertTenancyParty(o.db, {
          tenancyId: existing.id,
          partyId: party.id,
          role: 'PRIMARY_TENANT',
          isServiceContact: true,
        });
        for (const key of [...NAMES_AND_DATES, 'main_tenant_id_number']) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(screen.statusCode, 200, screen.body.slice(0, 400));
        assert.match(
          screen.body,
          new RegExp(`/estate/tenancies/${existing.id}`),
        );
        assert.match(screen.body, /צירוף לחוזה זה/);
        assert.match(
          screen.body,
          new RegExp(`name="attach" value="${existing.id}"`),
        );
        assert.doesNotMatch(screen.body, /type="submit" disabled/);

        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          attach: existing.id,
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
        assert.deepEqual(await o.counts(), {
          tenancies: 0,
          tenancyLinks: 1,
          signatories: 0,
        });
        const links = await o.db.query<{
          entity_type: string;
          link_role: string;
          entity_id: string;
        }>(
          `SELECT entity_type, link_role, entity_id FROM document_link
            WHERE document_id = $1 AND entity_type = 'TENANCY'`,
          [o.documentId],
        );
        assert.deepEqual(links.rows, [
          {
            entity_type: 'TENANCY',
            link_role: 'EVIDENCE',
            entity_id: existing.id,
          },
        ]);
        const parties = await o.db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM party
            WHERE national_id_key = party_national_id_key('PERSON', $1)`,
          [nationalId],
        );
        assert.equal(parties.rows[0]?.n, '1');
        const members = await o.db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1`,
          [existing.id],
        );
        assert.equal(members.rows[0]?.n, '1');
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('opening a new draft anyway still writes one, beside the tenancy already held', async (t) => {
    const nationalId = '236000103';
    const ran = await open(
      'same-236-anyway',
      [
        {
          field_key: 'main_tenant_id_number',
          value: nationalId,
          word_ids: [7],
        },
      ],
      async (o) => {
        const party = await upsertParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          nationalId,
          preferredLanguage: 'he',
        });
        const unitId = await anotherFlat(o, 'same-236-anyway-b');
        const profileId = await findTermsProfileByName(
          o.db,
          DEFAULT_TERMS_PROFILE,
        );
        assert.ok(profileId);
        const existing = await upsertTenancy(o.db, {
          unitId,
          startDate: START,
          endDate: END,
          status: 'DRAFT',
          termsProfileId: profileId,
          noticeDate: null,
          actualMoveOut: null,
        });
        await upsertTenancyParty(o.db, {
          tenancyId: existing.id,
          partyId: party.id,
          role: 'PRIMARY_TENANT',
          isServiceContact: true,
        });
        for (const key of [...NAMES_AND_DATES, 'main_tenant_id_number']) {
          await o.approve(key);
        }
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
        assert.deepEqual(await o.counts(), {
          tenancies: 1,
          tenancyLinks: 1,
          signatories: 3,
        });
        assert.equal(await primaryOn(o, o.unitId), party.id);
        const still = await o.db.query(
          `SELECT 1 FROM tenancy WHERE tenancy_id = $1`,
          [existing.id],
        );
        assert.equal(still.rowCount, 1);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('keeps the same-flat refusal, and attach still writes only the link', async (t) => {
    const nationalId = '236000104';
    const ran = await open(
      'same-236-flat',
      [
        {
          field_key: 'main_tenant_id_number',
          value: nationalId,
          word_ids: [7],
        },
      ],
      async (o) => {
        const party = await upsertParty(o.db, {
          kind: 'PERSON',
          givenName: GIVEN,
          familyName: FAMILY,
          nationalId,
          preferredLanguage: 'he',
        });
        const profileId = await findTermsProfileByName(
          o.db,
          DEFAULT_TERMS_PROFILE,
        );
        assert.ok(profileId);
        const existing = await upsertTenancy(o.db, {
          unitId: o.unitId,
          startDate: START,
          endDate: END,
          status: 'DRAFT',
          termsProfileId: profileId,
          noticeDate: null,
          actualMoveOut: null,
        });
        await upsertTenancyParty(o.db, {
          tenancyId: existing.id,
          partyId: party.id,
          role: 'PRIMARY_TENANT',
          isServiceContact: true,
        });
        for (const key of [...NAMES_AND_DATES, 'main_tenant_id_number']) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.match(screen.body, /כבר יש חוזה לדירה הזו באותו מועד תחילה/);
        assert.match(screen.body, /צירוף לחוזה זה/);
        assert.match(screen.body, /type="submit" disabled/);

        const opened = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
        });
        assert.equal(opened.statusCode, 409, opened.body.slice(0, 300));
        assert.deepEqual(await o.counts(), {
          tenancies: 1,
          tenancyLinks: 0,
          signatories: 0,
        });

        const attached = await o.post(
          `/documents/filing/${o.documentId}/open`,
          { attach: existing.id },
        );
        assert.equal(attached.statusCode, 302, attached.body.slice(0, 400));
        assert.deepEqual(await o.counts(), {
          tenancies: 1,
          tenancyLinks: 1,
          signatories: 0,
        });
        const members = await o.db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1`,
          [existing.id],
        );
        assert.equal(members.rows[0]?.n, '1');
      },
    );
    if (!ran) t.skip(skipReason);
  });
});
