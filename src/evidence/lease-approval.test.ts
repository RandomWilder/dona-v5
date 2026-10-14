// #239. One approval screen for leases.
//
// Seam: HTTP against A16's הקריאה and A15's ledger, the operator's own path. A lease is approved on
// הקריאה only; `אישור כל מה שלא סומן` there leaves the identity-and-access set for one press each;
// a second press is a sentence; once the draft is open the reading is closed on both screens. Every
// case runs over one rolled-back transaction.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  withOpening as fileLease,
  type Opening,
} from '../../tests/support/lease-opening.ts';
import { skipReason } from '../kernel/pg-support.ts';
import { DEFAULT_TERMS_PROFILE } from './contract.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');

/** One press each: names, identifiers, phones, emails, the two dates, the read address. */
const IDENTITY_AND_ACCESS: Finding[] = [
  { field_key: 'start_date', value: '2026-11-01', word_ids: [0] },
  { field_key: 'end_date', value: '2027-10-31', word_ids: [1] },
  { field_key: 'apartment_number', value: '7', word_ids: [2] },
  { field_key: 'building_number', value: '2', word_ids: [3] },
  { field_key: 'main_tenant_name', value: 'יוסף כהן', word_ids: [5] },
  { field_key: 'main_tenant_id_number', value: '000000018', word_ids: [6] },
  { field_key: 'main_tenant_phone', value: '0521234567', word_ids: [7] },
  {
    field_key: 'main_tenant_email',
    value: 'yosef@example.test',
    word_ids: [8],
  },
  { field_key: 'second_tenant_name', value: 'רחל כהן', word_ids: [9] },
  { field_key: 'second_tenant_id_number', value: '000000026', word_ids: [10] },
  { field_key: 'second_tenant_phone', value: '0527654321', word_ids: [11] },
  { field_key: 'guarantor_name', value: 'משה לוי', word_ids: [12] },
  { field_key: 'guarantor_id_number', value: '000000034', word_ids: [13] },
  { field_key: 'guarantor_phone', value: '0541112222', word_ids: [14] },
];

/** Read well, and none of them says who or where. */
const THE_REST: Finding[] = [
  { field_key: 'rent_currency', value: 'ILS', word_ids: [16] },
  { field_key: 'deposit_amount', value: '10600', word_ids: [17] },
  { field_key: 'deposit_currency', value: 'ILS', word_ids: [18] },
  { field_key: 'deposit_months', value: '2', word_ids: [19] },
  { field_key: 'maintenance_amount', value: '300', word_ids: [20] },
  { field_key: 'maintenance_currency', value: 'ILS', word_ids: [21] },
  { field_key: 'promissory_note_amount', value: '31800', word_ids: [22] },
  { field_key: 'promissory_note_currency', value: 'ILS', word_ids: [23] },
  { field_key: 'option_end_date', value: '2031-10-31', word_ids: [24] },
  { field_key: 'rooms', value: '4', word_ids: [25] },
  { field_key: 'floor', value: '3', word_ids: [26] },
  { field_key: 'apartment_type', value: 'B1', word_ids: [27] },
  { field_key: 'gush', value: '4321', word_ids: [28] },
  { field_key: 'helka', value: '12, 13', word_ids: [29] },
  { field_key: 'has_storage', value: 'true', word_ids: [30] },
];

/** Outside the set by key, inside it by read quality: one read badly, one never measured. */
const POORLY_READ = ['rent_amount', 'signed_date'];

const lease = (address: string): Finding[] => [
  ...IDENTITY_AND_ACCESS,
  { field_key: 'address', value: address, word_ids: [4] },
  { field_key: 'rent_amount', value: '5300', word_ids: [15] },
  { field_key: 'signed_date', value: '2026-10-01', word_ids: [31] },
  ...THE_REST,
];

const OPENING_KEYS = [
  'start_date',
  'end_date',
  'main_tenant_name',
  'second_tenant_name',
  'guarantor_name',
];

const withLease = (
  tag: string,
  run: (opening: Opening) => Promise<void>,
): Promise<boolean> =>
  fileLease({ on: ON, tag, findings: lease }, async (o) => {
    // The fake pdf measures nothing. Every row read well, then the two that were not.
    await o.db.query(
      `UPDATE extracted_field e
          SET confidence = CASE f.field_key
                WHEN 'rent_amount' THEN 0.5
                WHEN 'signed_date' THEN NULL
                ELSE 0.95 END
         FROM document_type_field f
        WHERE f.document_type_field_id = e.document_type_field_id
          AND e.document_id = $1`,
      [o.documentId],
    );
    await run(o);
  });

const rowsOf = async (
  o: Opening,
): Promise<Array<{ id: string; key: string; approved: boolean }>> =>
  (
    await o.db.query<{ id: string; key: string; approved: boolean }>(
      `SELECT e.extracted_field_id AS id, f.field_key AS key,
              e.approved_at IS NOT NULL AS approved
         FROM extracted_field e
         JOIN document_type_field f
           ON f.document_type_field_id = e.document_type_field_id
        WHERE e.document_id = $1`,
      [o.documentId],
    )
  ).rows;

const idOf = async (o: Opening, key: string): Promise<string> => {
  const found = (await rowsOf(o)).find((row) => row.key === key)?.id;
  assert.ok(found, key);
  return found;
};

const tenancyOf = async (o: Opening): Promise<string> => {
  const found = await o.db.query<{ entity_id: string }>(
    `SELECT entity_id FROM document_link
      WHERE document_id = $1 AND entity_type = 'TENANCY'`,
    [o.documentId],
  );
  const id = found.rows[0]?.entity_id;
  assert.ok(id);
  return id;
};

const opened = async (o: Opening): Promise<string> => {
  for (const key of OPENING_KEYS) {
    await o.approve(key);
  }
  const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
    terms_profile: DEFAULT_TERMS_PROFILE,
  });
  assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));
  return tenancyOf(o);
};

describe('evidence · #239 a lease is approved on הקריאה', () => {
  it('A15 on an unopened lease redirects to הקריאה, and a press there lands on הקריאה', async (t) => {
    // The ledger's own form still answers, for a tab opened before the redirect existed.
    const ran = await withLease('appr-239-a15', async (o) => {
      const ledger = await o.get(`/documents/${o.documentId}/fields`);
      assert.equal(ledger.statusCode, 302);
      assert.equal(
        ledger.headers.location,
        `/documents/filing/${o.documentId}`,
      );

      const stamped = await o.post(
        `/documents/${o.documentId}/fields/approve`,
        {
          extracted_field_id: await idOf(o, 'start_date'),
        },
      );
      assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
      assert.equal(
        stamped.headers.location,
        `/documents/filing/${o.documentId}`,
      );
      const start = (await rowsOf(o)).find((row) => row.key === 'start_date');
      assert.equal(start?.approved, true);

      // A stale ledger tab pressed twice gets הקריאה's sentence, not an error page.
      const again = await o.post(`/documents/${o.documentId}/fields/approve`, {
        extracted_field_id: await idOf(o, 'start_date'),
      });
      assert.equal(again.statusCode, 409);
      assert.match(again.body, /השורה הזו כבר אושרה/);
    });
    if (!ran) t.skip(skipReason);
  });

  it('approve-the-rest leaves exactly the identity-and-access set, sorted to the top', async (t) => {
    const ran = await withLease('appr-239-rest', async (o) => {
      const all = await rowsOf(o);
      assert.ok(all.length >= 30, String(all.length));
      const alone = new Set([
        ...IDENTITY_AND_ACCESS.map((finding) => finding.field_key),
        'address',
        ...POORLY_READ,
      ]);

      const before = await o.get(`/documents/filing/${o.documentId}`);
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /אישור כל מה שלא סומן/);
      const at = (id: string) =>
        before.body.indexOf(`name="extracted_field_id" value="${id}"`);
      const lastAlone = Math.max(
        ...all.filter((row) => alone.has(row.key)).map((row) => at(row.id)),
      );
      const firstRest = Math.min(
        ...all.filter((row) => !alone.has(row.key)).map((row) => at(row.id)),
      );
      assert.ok(lastAlone > -1 && firstRest > -1);
      assert.ok(lastAlone < firstRest, 'the set is sorted to the top');

      const bulk = await o.post(`/documents/filing/${o.documentId}/approve`, {
        action: 'unflagged',
      });
      assert.equal(bulk.statusCode, 302, bulk.body.slice(0, 300));
      assert.equal(bulk.headers.location, `/documents/filing/${o.documentId}`);

      const after = await rowsOf(o);
      assert.deepEqual(
        after
          .filter((row) => !row.approved)
          .map((row) => row.key)
          .sort(),
        [...alone].sort(),
      );
      assert.ok(
        after.filter((row) => !alone.has(row.key)).every((row) => row.approved),
      );

      const screen = await o.get(`/documents/filing/${o.documentId}`);
      assert.doesNotMatch(screen.body, /אישור כל מה שלא סומן/);
    });
    if (!ran) t.skip(skipReason);
  });

  it('a second press on one row is a sentence on הקריאה, not an error page', async (t) => {
    const ran = await withLease('appr-239-twice', async (o) => {
      const id = await idOf(o, 'start_date');
      const first = await o.post(`/documents/filing/${o.documentId}/approve`, {
        extracted_field_id: id,
      });
      assert.equal(first.statusCode, 302);
      const second = await o.post(`/documents/filing/${o.documentId}/approve`, {
        extracted_field_id: id,
      });
      assert.equal(second.statusCode, 409);
      assert.match(second.body, /השורה הזו כבר אושרה/);
      assert.match(second.body, /aria-current="step">הקריאה</);
    });
    if (!ran) t.skip(skipReason);
  });

  it('once the draft is open, approving or correcting a row is refused with a link to the tenancy', async (t) => {
    const ran = await withLease('appr-239-closed', async (o) => {
      const tenancyId = await opened(o);
      const link = new RegExp(`href="/estate/tenancies/${tenancyId}"`);
      const rent = await idOf(o, 'rent_amount');

      const presses: Array<Record<string, string>> = [
        { extracted_field_id: rent },
        { extracted_field_id: rent, approved_value: '5400' },
        { action: 'unflagged' },
      ];
      for (const fields of presses) {
        const refused = await o.post(
          `/documents/filing/${o.documentId}/approve`,
          fields,
        );
        assert.equal(refused.statusCode, 409, JSON.stringify(fields));
        assert.match(refused.body, /הקריאה של החוזה הזה סגורה/);
        assert.match(refused.body, link);
      }

      const ledger = await o.post(`/documents/${o.documentId}/fields/approve`, {
        extracted_field_id: rent,
      });
      assert.equal(ledger.statusCode, 409);
      assert.match(ledger.body, /הקריאה של החוזה הזה סגורה/);
      assert.match(ledger.body, link);

      assert.ok(
        (await rowsOf(o))
          .filter((row) => !OPENING_KEYS.includes(row.key))
          .every((row) => !row.approved),
        'nothing was stamped after opening',
      );

      // The closed ledger still shows the reading, with no approval on it.
      const closed = await o.get(`/documents/${o.documentId}/fields`);
      assert.equal(closed.statusCode, 200);
      assert.match(closed.body, /הקריאה של החוזה הזה סגורה/);
      assert.match(closed.body, link);
      assert.doesNotMatch(closed.body, /אישור כל מה שלא סומן/);
      assert.doesNotMatch(closed.body, /fields\/approve/);
    });
    if (!ran) t.skip(skipReason);
  });
});
