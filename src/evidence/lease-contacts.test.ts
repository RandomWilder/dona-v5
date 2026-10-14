// #235. Contacts from the lease.
//
// Seam: HTTP against A16, the operator's own path, through the harness #234's suite uses. A phone
// row is approvable only as an Israeli mobile number, and a nine-digit read starting with 5 is
// offered back with its 0. פתיחת טיוטה writes each approved phone and email as an open
// `party_contact` on the person it belongs to, by role. A value another party holds today refuses
// the whole draft and names that party. A person with no ת.ז. whose approved phone is held by
// exactly one party is that party. Where the contact grants access is the policy gate's case
// (tests/policy/lease-contact.test.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  type Opening,
  withOpening,
} from '../../tests/support/lease-opening.ts';
import { skipReason } from '../kernel/pg-support.ts';
import {
  addPartyContact,
  createParty,
  setPrimaryPartyContact,
} from '../parties/contract.ts';
import {
  applyDocumentTypeCatalogue,
  declareDocumentTypeField,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const TODAY = '2026-10-14';
const START = '2026-11-01';
const END = '2027-10-31';
const MAIN = 'דנה אלון';
const SECOND = 'עומר אלון';
const GUARANTOR = 'רות אלון';
// The 14 Oct read: a mobile number with its leading 0 dropped.
const MISREAD = '549797236';
// Each case's own numbers. Suites run in parallel against one database, and one contact value
// seeded by two of them waits on the other inside the exclusion constraint.
const MAIN_PHONE = '052-235-0001';
const GUARANTOR_PHONE = '0522350003';
const MAIN_EMAIL = 'Dana.Alon@Lease-235.test';
const SECOND_EMAIL = 'omer@lease-235.test';

const household = (
  contacts: readonly Finding[],
): ((address: string) => Finding[]) => {
  return (address) => [
    { field_key: 'start_date', value: START, word_ids: [0] },
    { field_key: 'end_date', value: END, word_ids: [1] },
    { field_key: 'apartment_number', value: '7', word_ids: [2] },
    { field_key: 'address', value: address, word_ids: [3] },
    { field_key: 'main_tenant_name', value: MAIN, word_ids: [4] },
    { field_key: 'second_tenant_name', value: SECOND, word_ids: [5] },
    { field_key: 'guarantor_name', value: GUARANTOR, word_ids: [6] },
    ...contacts,
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
  contacts: readonly Finding[],
  run: (opening: Opening) => Promise<void>,
) => withOpening({ tag, on: ON, findings: household(contacts) }, run);

async function rowId(o: Opening, fieldKey: string): Promise<string> {
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

async function stamped(o: Opening, fieldKey: string): Promise<boolean> {
  const found = await o.db.query<{ approved: boolean }>(
    `SELECT e.approved_at IS NOT NULL AS approved FROM extracted_field e
      WHERE e.extracted_field_id = $1`,
    [await rowId(o, fieldKey)],
  );
  return found.rows[0]?.approved === true;
}

/** Every open contact on a party holding a role on this flat's letting, by role. */
async function contactsByRole(
  o: Opening,
): Promise<
  Array<{ role: string; channel: string; value: string; primary: boolean }>
> {
  const found = await o.db.query<{
    role: string;
    channel: string;
    value: string;
    primary: boolean;
    valid_from: string;
  }>(
    `SELECT tp.role, c.channel, c.value, c.is_primary AS primary,
            c.valid_from::text AS valid_from
       FROM tenancy t
       JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
       JOIN party_contact c ON c.party_id = tp.party_id
      WHERE t.unit_id = $1 AND c.valid_to IS NULL
      ORDER BY tp.role, c.channel, c.value`,
    [o.unitId],
  );
  for (const row of found.rows) {
    assert.equal(row.valid_from, TODAY, 'a lease contact opens today');
  }
  return found.rows.map(({ role, channel, value, primary }) => ({
    role,
    channel,
    value,
    primary,
  }));
}

async function seedHolder(
  o: Opening,
  familyName: string,
  channel: 'PHONE' | 'EMAIL',
  value: string,
): Promise<string> {
  const party = await createParty(o.db, {
    kind: 'PERSON',
    givenName: 'קיים',
    familyName,
    preferredLanguage: 'he',
  });
  const added = await addPartyContact(o.db, {
    partyId: party.id,
    channel,
    value,
    label: null,
    validFrom: '2026-01-01',
  });
  await setPrimaryPartyContact(o.db, {
    partyId: party.id,
    contactId: added.contactId,
  });
  return party.id;
}

describe('evidence · #235 contacts from the lease', () => {
  it('offers a misread mobile number with its 0, and refuses one that is not a mobile number', async (t) => {
    const ran = await open(
      'contact-235-phone',
      [
        { field_key: 'main_tenant_phone', value: MISREAD, word_ids: [7] },
        { field_key: 'guarantor_phone', value: '02-6234567', word_ids: [8] },
      ],
      async (o) => {
        const screen = await o.get(`/documents/filing/${o.documentId}`);
        assert.equal(screen.statusCode, 200);
        assert.match(
          screen.body,
          new RegExp(`name="approved_value" value="0${MISREAD}"`),
          'the misread number is offered back with its leading 0',
        );

        // Approved as read, the misread number is refused on its row and nothing is stamped.
        const asRead = await o.post(
          `/documents/filing/${o.documentId}/approve`,
          {
            extracted_field_id: await rowId(o, 'main_tenant_phone'),
            approved_value: MISREAD,
          },
        );
        assert.equal(asRead.statusCode, 409, asRead.body.slice(0, 300));
        assert.match(asRead.body, /אינו מספר נייד ישראלי/);
        assert.equal(await stamped(o, 'main_tenant_phone'), false);

        // A landline is not a mobile number, whatever it is corrected to.
        const landline = await o.post(
          `/documents/filing/${o.documentId}/approve`,
          {
            extracted_field_id: await rowId(o, 'guarantor_phone'),
            approved_value: '02-6234567',
          },
        );
        assert.equal(landline.statusCode, 409);
        assert.match(landline.body, /אינו מספר נייד ישראלי/);
        assert.equal(await stamped(o, 'guarantor_phone'), false);

        // The offered correction approves.
        await o.approve('main_tenant_phone', {
          approved_value: `0${MISREAD}`,
        });
        assert.equal(await stamped(o, 'main_tenant_phone'), true);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('writes one open contact per approved phone and email, on the right person, by role', async (t) => {
    const ran = await open(
      'contact-235-write',
      [
        { field_key: 'main_tenant_phone', value: MAIN_PHONE, word_ids: [7] },
        { field_key: 'main_tenant_email', value: MAIN_EMAIL, word_ids: [8] },
        {
          field_key: 'second_tenant_email',
          value: SECOND_EMAIL,
          word_ids: [9],
        },
        {
          field_key: 'guarantor_phone',
          value: GUARANTOR_PHONE,
          word_ids: [10],
        },
      ],
      async (o) => {
        for (const key of [
          ...NAMES_AND_DATES,
          'main_tenant_phone',
          'main_tenant_email',
          'second_tenant_email',
          'guarantor_phone',
        ]) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(screen.statusCode, 200);
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));

        assert.deepEqual(await contactsByRole(o), [
          {
            role: 'CO_TENANT',
            channel: 'EMAIL',
            value: SECOND_EMAIL,
            primary: true,
          },
          {
            role: 'GUARANTOR',
            channel: 'PHONE',
            value: '+972522350003',
            primary: true,
          },
          {
            role: 'PRIMARY_TENANT',
            channel: 'EMAIL',
            value: MAIN_EMAIL.toLowerCase(),
            primary: true,
          },
          {
            role: 'PRIMARY_TENANT',
            channel: 'PHONE',
            value: '+972522350001',
            primary: true,
          },
        ]);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('writes no contact from a row nobody approved', async (t) => {
    const ran = await open(
      'contact-235-unsigned',
      [{ field_key: 'main_tenant_phone', value: '0522350011', word_ids: [7] }],
      async (o) => {
        for (const key of NAMES_AND_DATES) {
          await o.approve(key);
        }
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
        assert.deepEqual(await contactsByRole(o), []);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('refuses the draft when another party holds an approved phone today, naming that party', async (t) => {
    const held = '0522350021';
    const ran = await open(
      'contact-235-held',
      [
        {
          field_key: 'main_tenant_id_number',
          value: '000000026',
          word_ids: [7],
        },
        { field_key: 'main_tenant_phone', value: held, word_ids: [8] },
      ],
      async (o) => {
        await seedHolder(o, 'מחזיקה235', 'PHONE', '+972522350021');
        for (const key of [
          ...NAMES_AND_DATES,
          'main_tenant_id_number',
          'main_tenant_phone',
        ]) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(screen.statusCode, 200);
        assert.match(screen.body, /מחזיקה235/);
        assert.match(screen.body, /כבר שייך/);

        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 409, pressed.body.slice(0, 400));
        assert.match(pressed.body, /מחזיקה235/);
        assert.deepEqual(await o.counts(), {
          tenancies: 0,
          tenancyLinks: 0,
          signatories: 0,
        });
        const parties = await o.db.query(
          `SELECT 1 FROM party WHERE family_name = 'אלון'`,
        );
        assert.equal(parties.rowCount, 0, 'no party is written');
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('attaches a person with no ת.ז. to the one party holding their approved phone', async (t) => {
    const ran = await open(
      'contact-235-match',
      [
        {
          field_key: 'second_tenant_phone',
          value: '0522350031',
          word_ids: [7],
        },
      ],
      async (o) => {
        const existing = await seedHolder(o, 'אלון', 'PHONE', '+972522350031');
        for (const key of [...NAMES_AND_DATES, 'second_tenant_phone']) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.match(screen.body, /איש קשר קיים, לפי טלפון או דוא"ל/);
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));

        const roles = await o.db.query<{ party_id: string }>(
          `SELECT tp.party_id FROM tenancy t
             JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
            WHERE t.unit_id = $1 AND tp.role = 'CO_TENANT'`,
          [o.unitId],
        );
        assert.deepEqual(
          roles.rows.map((row) => row.party_id),
          [existing],
          'the second tenant is the party already holding the phone',
        );
        const contacts = await o.db.query(
          `SELECT 1 FROM party_contact WHERE value = '+972522350031'`,
        );
        assert.equal(contacts.rowCount, 1, 'the phone is not written twice');
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('says an approved phone that pairs with no person is not written, and writes none', async (t) => {
    const ran = await withOpening(
      {
        tag: 'contact-235-unpaired',
        on: ON,
        findings: (address) => [
          ...household([])(address),
          { field_key: 'guarantor_name', value: 'גיל אלון', word_ids: [7] },
          { field_key: 'guarantor_phone', value: '0522350041', word_ids: [8] },
        ],
      },
      async (o) => {
        for (const key of [...NAMES_AND_DATES, 'guarantor_phone']) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.match(screen.body, /1 טלפונים או כתובות דוא"ל שאושרו לא שויכו/);
        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: '',
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
        assert.deepEqual(await contactsByRole(o), []);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  /** A reading approved before the six keys existed: the row points at the closed declaration. */
  async function stampClosedContact(
    o: Opening,
    tag: string,
    spec: { fieldKey: string; labelHe: string; value: string },
  ): Promise<void> {
    await declareDocumentTypeField(o.db, {
      typeKey: 'lease',
      fieldKey: spec.fieldKey,
      labelHe: spec.labelHe,
      valueType: 'TEXT',
      isRequired: false,
      extractionHint: null,
      on: '2026-10-02',
    });
    await applyDocumentTypeCatalogue(o.db, seedDocumentTypes);
    const field = await o.db.query<{ id: string }>(
      `SELECT f.document_type_field_id AS id
         FROM document_type_field f
         JOIN document_type t ON t.document_type_id = f.document_type_id
        WHERE t.type_key = 'lease' AND f.field_key = $1
        ORDER BY f.effective_from
        LIMIT 1`,
      [spec.fieldKey],
    );
    const fieldId = field.rows[0]?.id;
    assert.ok(fieldId, 'the closed declaration is still there');
    const inserted = await o.db.query<{ id: string }>(
      `INSERT INTO extracted_field (
         extracted_field_id, document_id, document_type_field_id, value,
         page, bbox, confidence, model, extracted_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3,
         1, '{"x":1,"y":2,"width":3,"height":4}'::jsonb, 0.99, 'fake', $4
       )
       RETURNING extracted_field_id AS id`,
      [o.documentId, fieldId, spec.value, ON],
    );
    const id = inserted.rows[0]?.id;
    assert.ok(id);
    // The stamp the 14 Oct approval left, before a phone row could be refused. The trigger allows
    // it only while approving, which is the same switch the approve command sets.
    await o.db.query("SELECT set_config('dona.approving', 'on', true)");
    await o.db.query(
      `UPDATE extracted_field
          SET approved_value = $2, approved_by = $3, approved_at = $4
        WHERE extracted_field_id = $1`,
      [id, spec.value, `admin@${tag}.test`, ON],
    );
  }

  it('writes a phone approved under the old field name onto the main tenant', async (t) => {
    const tag = 'contact-235-legacy';
    const ran = await open(tag, [], async (o) => {
      await stampClosedContact(o, tag, {
        fieldKey: 'tenant_mobile',
        labelHe: 'נייד השוכר',
        value: '549797291',
      });
      for (const key of NAMES_AND_DATES) {
        await o.approve(key);
      }
      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: '',
      });
      assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
      assert.deepEqual(await contactsByRole(o), [
        {
          role: 'PRIMARY_TENANT',
          channel: 'PHONE',
          value: '+972549797291',
          primary: true,
        },
      ]);
    });
    if (!ran) t.skip(skipReason);
  });

  it('opens the draft when the old phone field is not a mobile number, and writes none', async (t) => {
    const tag = 'contact-235-legacy-landline';
    const ran = await open(tag, [], async (o) => {
      await stampClosedContact(o, tag, {
        fieldKey: 'tenant_mobile',
        labelHe: 'נייד השוכר',
        value: '03-5550191',
      });
      for (const key of NAMES_AND_DATES) {
        await o.approve(key);
      }
      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: '',
      });
      assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 400));
      assert.deepEqual(await contactsByRole(o), []);
    });
    if (!ran) t.skip(skipReason);
  });
});
