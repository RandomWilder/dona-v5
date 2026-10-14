// #234. פתיחת טיוטה opens the draft from an approved reading.
//
// Seam: HTTP against A16, the operator's own path. Approving only stamps; הקריאה names what is
// missing or offers פתיחת טיוטה; that screen shows the flat, the terms profile, the people and
// every refusal before anything is written; the press writes it all or nothing. Every case runs
// the app over one rolled-back transaction, so nothing a case writes outlives it. The one case
// that needs a real transaction boundary (a forced failure part-way) is in the carry suite, which
// cleans up after a committed app.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  withOpening as fileLease,
  type Opening,
} from '../../tests/support/lease-opening.ts';
import { skipReason } from '../kernel/pg-support.ts';
import { findTermsProfileByName, upsertTenancy } from '../tenancy/contract.ts';
import { DEFAULT_TERMS_PROFILE } from './contract.ts';
import type { ExtractedRow } from './internal/extract.ts';
import { leaseReadingGaps } from './internal/lease.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const START = '2026-11-01';
const END = '2027-10-31';
const MAIN = 'יוסף כהן';
const SECOND = 'רחל כהן';
const GUARANTOR = 'משה לוי';
const MAIN_ID = '000000018';
const RENT = '5300';

const household = (address: string): Finding[] => [
  { field_key: 'start_date', value: START, word_ids: [0] },
  { field_key: 'end_date', value: END, word_ids: [1] },
  { field_key: 'apartment_number', value: '7', word_ids: [2] },
  { field_key: 'address', value: address, word_ids: [3] },
  { field_key: 'main_tenant_name', value: MAIN, word_ids: [4] },
  { field_key: 'main_tenant_id_number', value: MAIN_ID, word_ids: [5] },
  { field_key: 'second_tenant_name', value: SECOND, word_ids: [6] },
  { field_key: 'guarantor_name', value: GUARANTOR, word_ids: [7] },
  { field_key: 'rent_amount', value: RENT, word_ids: [8] },
  { field_key: 'rent_currency', value: 'ILS', word_ids: [9] },
];

/** The A16 path, filed with this suite's household unless a case reads something else. */
const withOpening = (
  spec: { tag: string; findings?: (address: string) => Finding[] },
  run: (opening: Opening) => Promise<void>,
): Promise<boolean> => fileLease({ on: ON, findings: household, ...spec }, run);

const OPENING_KEYS = [
  'start_date',
  'end_date',
  'main_tenant_name',
  'second_tenant_name',
  'guarantor_name',
] as const;

const nothingWritten = {
  tenancies: 0,
  tenancyLinks: 0,
  signatories: 0,
};

describe('evidence · #234 פתיחת טיוטה opens the draft from an approved reading', () => {
  it('approving only stamps; הקריאה names what is missing, then offers פתיחת טיוטה', async (t) => {
    const ran = await withOpening({ tag: 'open-234-ready' }, async (o) => {
      const before = await o.get(`/documents/filing/${o.documentId}`);
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /פתיחת טיוטה/);
      assert.match(before.body, /הטיוטה תיפתח כשכל אלה יאושרו/);
      for (const label of [
        'שם השוכר הראשי',
        'שם השוכר הנוסף',
        'שם הערב',
        'תחילת תקופת השכירות',
        'סיום תקופת השכירות',
      ]) {
        assert.match(before.body, new RegExp(`</span>\\s*${label}`), label);
      }
      assert.doesNotMatch(
        before.body,
        new RegExp(`href="/documents/filing/${o.documentId}/open"`),
      );

      // Every row the reading needs, one press each, and the rent: still no draft, no person, no link.
      for (const key of [...OPENING_KEYS, 'rent_amount', 'rent_currency']) {
        await o.approve(key);
      }
      assert.deepEqual(await o.counts(), nothingWritten);
      const rent = await o.db.query<{ promoted_to: string | null }>(
        `SELECT e.promoted_to FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = 'rent_amount'`,
        [o.documentId],
      );
      assert.equal(rent.rows[0]?.promoted_to, null);

      const ready = await o.get(`/documents/filing/${o.documentId}`);
      assert.equal(ready.statusCode, 200);
      assert.doesNotMatch(ready.body, /הטיוטה תיפתח כשכל אלה יאושרו/);
      assert.match(
        ready.body,
        new RegExp(
          `href="/documents/filing/${o.documentId}/open">פתיחת טיוטה</a>`,
        ),
      );
    });
    if (!ran) t.skip(skipReason);
  });

  it('shows the flat, the profile, the people and their roles, then writes it all in one press', async (t) => {
    const ran = await withOpening({ tag: 'open-234-press' }, async (o) => {
      for (const key of [...OPENING_KEYS, 'rent_amount', 'rent_currency']) {
        await o.approve(key);
      }
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200, screen.body.slice(0, 300));
      assert.match(screen.body, /aria-current="step">פתיחת טיוטה</);
      assert.match(
        screen.body,
        /הדקל \d+, עיר פתיחה open-234-press · דירה <span dir="ltr">7<\/span>/,
      );
      assert.match(
        screen.body,
        new RegExp(`<option value="${DEFAULT_TERMS_PROFILE}" selected>`),
      );
      for (const [role, name] of [
        ['שוכר ראשי', MAIN],
        ['שוכר נוסף', SECOND],
        ['ערב', GUARANTOR],
      ]) {
        assert.match(
          screen.body,
          new RegExp(
            `<span class="chip">${role}</span>\\s*<span class="excerpt">${name}</span>`,
          ),
          role,
        );
      }
      assert.doesNotMatch(screen.body, /למה אי אפשר לפתוח/);
      assert.doesNotMatch(screen.body, /type="submit" disabled/);
      assert.doesNotMatch(screen.body, new RegExp(MAIN_ID));
      assert.deepEqual(await o.counts(), nothingWritten);

      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: DEFAULT_TERMS_PROFILE,
      });
      assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));
      assert.equal(
        pressed.headers.location,
        `/documents/filing/${o.documentId}`,
      );
      assert.deepEqual(await o.counts(), {
        tenancies: 1,
        tenancyLinks: 1,
        signatories: 3,
      });

      const letting = await o.db.query<{
        tenancy_id: string;
        status: string;
        start_date: string;
        end_date: string;
        rent_amount: string | null;
        terms_profile_id: string;
      }>(
        `SELECT tenancy_id, status, start_date::text, end_date::text,
                rent_amount::text, terms_profile_id
           FROM tenancy WHERE unit_id = $1`,
        [o.unitId],
      );
      const row = letting.rows[0];
      assert.equal(row?.status, 'DRAFT');
      assert.equal(row?.start_date, START);
      assert.equal(row?.end_date, END);
      assert.equal(row?.rent_amount, RENT);
      assert.equal(
        row?.terms_profile_id,
        await findTermsProfileByName(o.db, DEFAULT_TERMS_PROFILE),
      );

      const people = await o.db.query<{
        role: string;
        is_service_contact: boolean;
        family_name: string;
        has_id: boolean;
      }>(
        `SELECT tp.role, tp.is_service_contact, p.family_name,
                p.national_id_key IS NOT NULL AS has_id
           FROM tenancy_party tp JOIN party p ON p.party_id = tp.party_id
          WHERE tp.tenancy_id = $1 ORDER BY tp.role`,
        [row?.tenancy_id],
      );
      assert.deepEqual(
        people.rows.map((person) => [
          person.role,
          person.is_service_contact,
          person.family_name,
          person.has_id,
        ]),
        [
          ['CO_TENANT', true, 'כהן', false],
          ['GUARANTOR', false, 'לוי', false],
          ['PRIMARY_TENANT', true, 'כהן', true],
        ],
      );

      const promoted = await o.db.query<{ field_key: string }>(
        `SELECT f.field_key FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND e.promoted_to IS NOT NULL
          ORDER BY f.field_key`,
        [o.documentId],
      );
      assert.deepEqual(
        promoted.rows.map((field) => field.field_key),
        ['end_date', 'rent_amount', 'rent_currency', 'start_date'],
      );

      const draft = await o.get(`/documents/filing/${o.documentId}`);
      assert.equal(draft.statusCode, 200);
      assert.match(draft.body, /aria-current="step">הטיוטה</);
      assert.match(draft.body, /די היום/);
      const again = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(again.statusCode, 302);
      assert.equal(again.headers.location, `/documents/filing/${o.documentId}`);
    });
    if (!ran) t.skip(skipReason);
  });

  it('disables the press and says why when no terms profile exists, and nothing is written', async (t) => {
    const ran = await withOpening({ tag: 'open-234-noprof' }, async (o) => {
      for (const key of OPENING_KEYS) {
        await o.approve(key);
      }
      // The register is shared by every suite, and a tenancy elsewhere holds each row, so the
      // empty register is this session's alone: a temporary table of the same name is read
      // first, and the rollback drops it.
      await o.db.query(
        'CREATE TEMP TABLE terms_profile (LIKE public.terms_profile) ON COMMIT DROP',
      );
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200, screen.body.slice(0, 300));
      assert.match(screen.body, /אין במערכת אף נספח תנאים/);
      assert.match(screen.body, /type="submit" disabled/);

      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: '',
      });
      assert.equal(pressed.statusCode, 409, pressed.body.slice(0, 300));
      assert.match(pressed.body, /הטיוטה לא נפתחה ולא נכתב דבר/);
      assert.match(pressed.body, /אין במערכת אף נספח תנאים/);
      assert.deepEqual(await o.counts(), nothingWritten);
    });
    if (!ran) t.skip(skipReason);
  });

  it('refuses a flat already let from the same start date, with a link, and writes nothing', async (t) => {
    const ran = await withOpening({ tag: 'open-234-taken' }, async (o) => {
      for (const key of OPENING_KEYS) {
        await o.approve(key);
      }
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
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200);
      assert.match(screen.body, /כבר יש חוזה לדירה הזו באותו מועד תחילה/);
      assert.match(screen.body, new RegExp(`/estate/tenancies/${existing.id}`));
      assert.match(screen.body, /type="submit" disabled/);

      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: DEFAULT_TERMS_PROFILE,
      });
      assert.equal(pressed.statusCode, 409, pressed.body.slice(0, 300));
      assert.match(pressed.body, /כבר יש חוזה לדירה הזו באותו מועד תחילה/);
      assert.match(
        pressed.body,
        new RegExp(`/estate/tenancies/${existing.id}`),
      );
      assert.deepEqual(await o.counts(), {
        tenancies: 1,
        tenancyLinks: 0,
        signatories: 0,
      });
      const held = await o.db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1',
        [existing.id],
      );
      assert.equal(held.rows[0]?.n, '0');
    });
    if (!ran) t.skip(skipReason);
  });

  it('refuses two people resolving to one ת.ז., and writes nothing', async (t) => {
    const ran = await withOpening(
      {
        tag: 'open-234-same',
        findings: (address) => [
          ...household(address),
          // Printed with spaces the second time: two strings, one person.
          {
            field_key: 'second_tenant_id_number',
            value: '000 000 018',
            word_ids: [10],
          },
        ],
      },
      async (o) => {
        for (const key of OPENING_KEYS) {
          await o.approve(key);
        }
        const screen = await o.get(`/documents/filing/${o.documentId}/open`);
        assert.equal(screen.statusCode, 200);
        assert.match(screen.body, /שני אנשים בחוזה נושאים אותה תעודת זהות/);
        assert.match(screen.body, /type="submit" disabled/);

        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
        });
        assert.equal(pressed.statusCode, 409, pressed.body.slice(0, 300));
        assert.match(pressed.body, /שני אנשים בחוזה נושאים אותה תעודת זהות/);
        assert.deepEqual(await o.counts(), nothingWritten);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('refuses a press while the reading is not ready, and writes nothing', async (t) => {
    const ran = await withOpening({ tag: 'open-234-early' }, async (o) => {
      await o.approve('start_date');
      await o.approve('end_date');
      await o.approve('main_tenant_name');
      const screen = await o.get(`/documents/filing/${o.documentId}/open`);
      assert.equal(screen.statusCode, 200);
      assert.match(screen.body, /הקריאה עדיין לא מוכנה/);
      assert.match(screen.body, /שם הערב/);
      const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
        terms_profile: DEFAULT_TERMS_PROFILE,
      });
      assert.equal(pressed.statusCode, 409);
      assert.deepEqual(await o.counts(), nothingWritten);
    });
    if (!ran) t.skip(skipReason);
  });
});

describe('evidence · #234 what הקריאה still needs', () => {
  const row = (
    fieldKey: string,
    value: string,
    approved: boolean,
    y: number,
  ): ExtractedRow => ({
    extractedFieldId: `00000000-0000-7000-8000-00000000000${y}`,
    documentTypeFieldId: '00000000-0000-7000-8000-000000000000',
    fieldKey,
    labelHe: fieldKey,
    value,
    page: 1,
    bbox: { x: 0, y, width: 1, height: 1 },
    confidence: null,
    model: 'fake',
    promotionTarget: null,
    promotedTo: null,
    promotedBy: null,
    promotedAt: null,
    approvedValue: approved ? value : null,
    approvedBy: approved ? 'ops@example.test' : null,
    approvedAt: approved ? ON : null,
  });

  it('takes one signed main tenant over an unsigned twin, and still needs every other name', () => {
    const rows = [
      row('start_date', START, true, 1),
      row('end_date', END, true, 2),
      row('main_tenant_name', MAIN, true, 3),
      row('main_tenant_name', MAIN, false, 4),
      row('second_tenant_name', SECOND, false, 5),
    ];
    assert.deepEqual(
      leaseReadingGaps(rows).map((gap) => gap.fieldKey),
      ['second_tenant_name'],
    );
  });

  it('names a required field the reader never found', () => {
    assert.deepEqual(
      leaseReadingGaps([row('guarantor_name', GUARANTOR, true, 1)]).map(
        (gap) => [gap.fieldKey, gap.value],
      ),
      [
        ['main_tenant_name', null],
        ['start_date', null],
        ['end_date', null],
      ],
    );
  });
});
