// #174. Approving a mapped lease field carries it onto the letting.
//
// Seam: the two approval routes. Read back on the letting page and the typed
// columns. The promotion command's own rules stay proved in the promotion suite.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import {
  asOperator,
  type SignedIn,
  signIn,
  signOutAll,
} from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import type { EstatePlan } from '../estate/contract.ts';
import { importEstate } from '../estate/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { inTransaction } from '../kernel/db.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { fakeItems } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { upsertTermsProfile } from '../tenancy/contract.ts';
import {
  applyDocumentTypeCatalogue,
  DEFAULT_TERMS_PROFILE,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const ON = new Date('2026-09-30T09:00:00.000Z');
const BOUNDARY = '----donaa174';
const START = '2026-10-01';
const END = '2027-09-30';
const RENT = '5200';
const CURRENCY = 'ILS';
const OPTION = '2031-09-11';
const BAY = '552';
const STORE = '505';
const FLOOR = '3';
const ROOMS = '4';
const TENANT = 'יוסף כהן';
const OTHER_MARK = 'SECONDLEASE';

type Finding = { field_key: string; value: string; word_ids: number[] };

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const opening = (address: string): Finding[] => [
  { field_key: 'start_date', value: START, word_ids: [0] },
  { field_key: 'end_date', value: END, word_ids: [1] },
  { field_key: 'apartment_number', value: '13', word_ids: [2] },
  { field_key: 'address', value: address, word_ids: [3] },
  { field_key: 'main_tenant_name', value: TENANT, word_ids: [4] },
];

interface Carry {
  pool: Pool;
  actor: SignedIn;
  unitId: string;
  documentId: string;
  post: (
    url: string,
    fields: Record<string, string>,
  ) => Promise<{
    statusCode: number;
    body: string;
    headers: { location?: string };
  }>;
  get: (url: string) => Promise<{ statusCode: number; body: string }>;
  getAs: (
    who: SignedIn,
    url: string,
  ) => Promise<{ statusCode: number; body: string }>;
  rowId: (documentId: string, fieldKey: string) => Promise<string>;
  tenancyId: () => Promise<string>;
  fileBoundLease: (marker: string) => Promise<string>;
}

async function withCarry(
  spec: {
    tag: string;
    city: string;
    address: string;
    findings: Finding[];
    otherFindings?: Finding[];
    rooms?: number;
    unitFloor?: string | null;
    on?: Date;
    parking?: readonly string[];
  },
  run: (carry: Carry) => Promise<void>,
): Promise<boolean> {
  const pool = await migratedPoolOrNull();
  if (!pool) return false;
  const { city, address } = spec;
  const project = `TEST-${spec.tag}`;
  const bucket = `dona-v5-test-${spec.tag}`;
  const domain = `${spec.tag}.test`;
  const leasing = `כתובת המושכר: ${address}, ${city}, דירה 13\n${specimen('lease-standard.md')}`;
  const otherText = `${OTHER_MARK}\n${leasing}`;
  const clock = fixedClock(spec.on ?? ON);
  const app = buildApp({
    pool,
    version: '9.9.9-test',
    clock,
    objects: createMemoryStore(),
    pdf: {
      async pages(bytes: Buffer) {
        const text = bytes.toString('latin1').includes('SECOND-LEASE')
          ? otherText
          : leasing;
        return [
          {
            number: 1,
            width: 595,
            height: 842,
            items: fakeItems(text, null),
          },
        ];
      },
      describe: () => 'fake',
    },
    extractor: createFakeExtractor((request) => ({
      findings: request.input.includes(OTHER_MARK)
        ? (spec.otherFindings ?? spec.findings)
        : spec.findings,
    })),
    bucket,
  });
  const actor = { current: null as SignedIn | null };
  const post = (url: string, fields: Record<string, string>) => {
    const who = actor.current;
    if (!who) throw new Error('not signed in');
    return asOperator(app as never, who).inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ csrf: who.csrf, ...fields }).toString(),
    });
  };
  const send = (
    url: string,
    fields: Record<string, string>,
    marker: string,
  ) => {
    const who = actor.current;
    if (!who) throw new Error('not signed in');
    const parts: Buffer[] = [
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n${who.csrf}\r\n`,
      ),
    ];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    }
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="שכירות.pdf"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1'),
      Buffer.from('\r\n'),
      Buffer.from(`--${BOUNDARY}--\r\n`),
    );
    return asOperator(app as never, who).inject({
      method: 'POST',
      url,
      payload: Buffer.concat(parts),
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
    });
  };
  const rowId = async (documentId: string, fieldKey: string) => {
    const rows = await pool.query<{ id: string }>(
      `SELECT e.extracted_field_id AS id FROM extracted_field e
         JOIN document_type_field f
           ON f.document_type_field_id = e.document_type_field_id
        WHERE e.document_id = $1 AND f.field_key = $2`,
      [documentId, fieldKey],
    );
    return rows.rows[0]?.id ?? '';
  };
  const plan: EstatePlan = {
    projects: [
      {
        name: `מכרז ${spec.tag}`,
        projectCode: project,
        tenderRef: null,
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: `בניין ${spec.tag}`,
        addressLine: address,
        city,
        projectCode: project,
        handoverDate: '2025-03-01',
        warrantyEndDate: '2027-03-01',
        status: 'ACTIVE',
        spaces: [
          {
            kind: 'UNIT',
            name: 'דירה 13',
            floor: spec.unitFloor ?? null,
            accessNote: null,
          },
          { kind: 'PARKING', name: BAY, floor: null, accessNote: null },
          ...(spec.parking ?? []).map((name) => ({
            kind: 'PARKING' as const,
            name,
            floor: null,
            accessNote: null,
          })),
          { kind: 'STORAGE', name: STORE, floor: null, accessNote: null },
        ],
        units: [
          {
            spaceName: 'דירה 13',
            unitNumber: '13',
            rooms: spec.rooms ?? Number(ROOMS),
            areaSqm: 70,
            hasMamad: false,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'READY',
          },
        ],
      },
    ],
  };

  try {
    await signOutAll(pool, domain);
    actor.current = await signIn(pool, clock, {
      email: `admin@${domain}`,
      role: 'ADMIN',
    });
    await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
    await importEstate(pool, plan);
    await upsertTermsProfile(pool, DEFAULT_TERMS_PROFILE);
    const found = await pool.query<{ unit_id: string }>(
      `SELECT u.unit_id FROM unit u
         JOIN space s ON s.space_id = u.unit_id
         JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1 AND b.address_line = $2`,
      [city, address],
    );
    const unitId = found.rows[0]?.unit_id ?? '';
    assert.ok(unitId);
    const seen = await send('/documents/filing', {}, `${spec.tag}-seen`);
    assert.equal(
      seen.statusCode,
      200,
      `${String(seen.headers.location ?? '')} ${seen.body.slice(0, 180)}`,
    );
    const filed = await send(
      '/documents/filing',
      { unit: unitId },
      `${spec.tag}-filed`,
    );
    assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
    const documentId =
      String(filed.headers.location ?? '').match(
        /\/documents\/filing\/([0-9a-f-]{36})$/,
      )?.[1] ?? '';
    assert.ok(documentId);
    const who = actor.current;
    await run({
      pool,
      actor: who,
      unitId,
      documentId,
      post,
      get: (url) =>
        asOperator(app as never, who).inject({ method: 'GET', url }),
      getAs: (reader, url) =>
        asOperator(app as never, reader).inject({ method: 'GET', url }),
      rowId,
      tenancyId: async () => {
        const letting = await pool.query<{ tenancy_id: string }>(
          'SELECT tenancy_id FROM tenancy WHERE unit_id = $1',
          [unitId],
        );
        return letting.rows[0]?.tenancy_id ?? '';
      },
      fileBoundLease: async (marker) => {
        const tenancyId = await pool.query<{ tenancy_id: string }>(
          'SELECT tenancy_id FROM tenancy WHERE unit_id = $1',
          [unitId],
        );
        const bound = tenancyId.rows[0]?.tenancy_id ?? '';
        assert.ok(bound);
        const second = await send(
          '/documents',
          { unit: unitId, type: 'lease', tenancy: bound },
          marker,
        );
        assert.equal(second.statusCode, 200, second.body.slice(0, 400));
        const rows = await pool.query<{ id: string }>(
          `SELECT d.document_id AS id FROM document d
             JOIN document_link l ON l.document_id = d.document_id
            WHERE l.entity_type = 'TENANCY' AND l.entity_id = $1
              AND d.document_id <> $2`,
          [bound, documentId],
        );
        const id = rows.rows[0]?.id ?? '';
        assert.ok(id);
        return id;
      },
    });
  } finally {
    await inTransaction(pool, async (db) => {
      await db.query("SELECT set_config('dona.approving', 'on', true)");
      await db.query("SELECT set_config('dona.promoting', 'on', true)");
      await db.query(
        `UPDATE extracted_field
            SET approved_value = NULL, approved_by = NULL, approved_at = NULL,
                promoted_to = NULL, promoted_by = NULL, promoted_at = NULL
          WHERE document_id IN (SELECT document_id FROM document
                                 WHERE storage_uri LIKE $1)`,
        [`gs://${bucket}/%`],
      );
    });
    await pool.query(
      'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
    );
    await pool.query(
      'ALTER TABLE estate_event DISABLE TRIGGER estate_event_is_append_only',
    );
    try {
      await pool.query(
        `DELETE FROM tenancy_event WHERE tenancy_id IN (
           SELECT t.tenancy_id FROM tenancy t
           JOIN space s ON s.space_id = t.unit_id
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [city, address],
      );
      await pool.query(
        `DELETE FROM estate_event WHERE unit_id IN (
           SELECT s.space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [city, address],
      );
      await pool.query(
        `DELETE FROM tenancy_party WHERE tenancy_id IN (
           SELECT t.tenancy_id FROM tenancy t
           JOIN space s ON s.space_id = t.unit_id
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [city, address],
      );
      await pool.query(
        `DELETE FROM tenancy WHERE unit_id IN (
           SELECT s.space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [city, address],
      );
    } finally {
      await pool.query(
        'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
      );
      await pool.query(
        'ALTER TABLE estate_event ENABLE TRIGGER estate_event_is_append_only',
      );
    }
    await pool.query(
      `DELETE FROM extracted_field WHERE document_id IN
         (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
      [`gs://${bucket}/%`],
    );
    await pool.query(
      `DELETE FROM document_passage WHERE document_id IN
         (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
      [`gs://${bucket}/%`],
    );
    await pool.query(
      `DELETE FROM document_link WHERE document_id IN
         (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
      [`gs://${bucket}/%`],
    );
    await pool.query('DELETE FROM document WHERE storage_uri LIKE $1', [
      `gs://${bucket}/%`,
    ]);
    await pool.query(
      `DELETE FROM unit WHERE unit_id IN (
         SELECT s.space_id FROM space s
         JOIN building b ON b.building_id = s.building_id
         WHERE b.city = $1 AND b.address_line = $2)`,
      [city, address],
    );
    await pool.query(
      `DELETE FROM space WHERE building_id IN (
         SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
      [city, address],
    );
    await pool.query(
      'DELETE FROM building WHERE city = $1 AND address_line = $2',
      [city, address],
    );
    await pool.query('DELETE FROM project WHERE project_code = $1', [project]);
    await signOutAll(pool, domain);
    await app.close();
    await pool.end();
  }
  return true;
}

async function approveOpening(carry: Carry): Promise<void> {
  for (const key of ['start_date', 'end_date', 'main_tenant_name']) {
    const stamped = await carry.post(
      `/documents/filing/${carry.documentId}/approve`,
      { extracted_field_id: await carry.rowId(carry.documentId, key) },
    );
    assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
    assert.equal(
      stamped.headers.location,
      `/documents/filing/${carry.documentId}`,
    );
  }
}

async function column(carry: Carry): Promise<{
  rent_amount: string | null;
  rent_currency: string | null;
  option_end_date: string | null;
  parking_name: string | null;
  second_parking_name: string | null;
  storage_name: string | null;
}> {
  const letting = await carry.pool.query<{
    rent_amount: string | null;
    rent_currency: string | null;
    option_end_date: string | null;
    parking_name: string | null;
    second_parking_name: string | null;
    storage_name: string | null;
  }>(
    `SELECT t.rent_amount::text AS rent_amount,
            t.rent_currency,
            t.option_end_date::text AS option_end_date,
            p.name AS parking_name,
            q.name AS second_parking_name,
            s.name AS storage_name
       FROM tenancy t
       LEFT JOIN space p ON p.space_id = t.parking_space_id
       LEFT JOIN space q ON q.space_id = t.second_parking_space_id
       LEFT JOIN space s ON s.space_id = t.storage_space_id
      WHERE t.unit_id = $1`,
    [carry.unitId],
  );
  const row = letting.rows[0];
  assert.ok(row);
  return row;
}

describe('evidence · approving a mapped lease field carries it', {
  concurrency: false,
}, () => {
  it('carries rent, option end, bay and storage when the draft is established', async (t) => {
    const address = 'נשיאה 174';
    const ran = await withCarry(
      {
        tag: 'a174draft',
        city: 'עיר נשיאה א',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'option_end_date', value: OPTION, word_ids: [7] },
          { field_key: 'parking_space_number', value: BAY, word_ids: [8] },
          { field_key: 'storage_space_number', value: STORE, word_ids: [9] },
          { field_key: 'floor', value: FLOOR, word_ids: [10] },
          { field_key: 'rooms', value: '9', word_ids: [11] },
        ],
      },
      async (carry) => {
        for (const key of [
          'rent_amount',
          'rent_currency',
          'option_end_date',
          'parking_space_number',
          'storage_space_number',
          'floor',
        ]) {
          const stamped = await carry.post(
            `/documents/filing/${carry.documentId}/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
          assert.equal(
            stamped.headers.location,
            `/documents/filing/${carry.documentId}`,
          );
        }
        const before = await carry.pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(before.rows[0]?.n, '0');
        await approveOpening(carry);

        const row = await column(carry);
        assert.equal(row.rent_amount, RENT);
        assert.equal(row.rent_currency, CURRENCY);
        assert.equal(row.option_end_date, OPTION);
        assert.equal(row.parking_name, BAY);
        assert.equal(row.storage_name, STORE);

        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.equal(page.statusCode, 200);
        assert.match(page.body, new RegExp(RENT));
        assert.match(page.body, new RegExp(CURRENCY));
        assert.match(page.body, new RegExp(OPTION));
        assert.match(page.body, new RegExp(BAY));
        assert.match(page.body, new RegExp(STORE));

        const floor = await carry.pool.query<{ floor: string | null }>(
          'SELECT floor FROM space WHERE space_id = $1',
          [carry.unitId],
        );
        assert.equal(floor.rows[0]?.floor, FLOOR);

        const roomsId = await carry.rowId(carry.documentId, 'rooms');
        const unapproved = await carry.pool.query<{
          promoted_to: string | null;
        }>(
          'SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1',
          [roomsId],
        );
        assert.equal(unapproved.rows[0]?.promoted_to, null);
        const rooms = await carry.pool.query<{ rooms: string }>(
          'SELECT rooms::text AS rooms FROM unit WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(rooms.rows[0]?.rooms, ROOMS);

        const audit = await carry.pool.query<{ actor_id: string }>(
          `SELECT actor_id FROM audit_log
            WHERE action = 'evidence.promote_field' AND subject_id = $1`,
          [await carry.rowId(carry.documentId, 'rent_amount')],
        );
        assert.equal(audit.rows.length, 1);
        assert.equal(audit.rows[0]?.actor_id, carry.actor.email);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('carries each mapped field when the letting is already bound', async (t) => {
    const address = 'נשיאה 175';
    const ran = await withCarry(
      {
        tag: 'a174late',
        city: 'עיר נשיאה ב',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'option_end_date', value: OPTION, word_ids: [7] },
          { field_key: 'parking_space_number', value: BAY, word_ids: [8] },
          { field_key: 'storage_space_number', value: STORE, word_ids: [9] },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        const bare = await column(carry);
        assert.equal(bare.rent_amount, null);
        assert.equal(bare.option_end_date, null);
        assert.equal(bare.parking_name, null);
        assert.equal(bare.storage_name, null);

        const amount = await carry.post(
          `/documents/${carry.documentId}/fields/approve`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'rent_amount',
            ),
          },
        );
        assert.equal(amount.statusCode, 302, amount.body.slice(0, 300));
        assert.equal(
          amount.headers.location,
          `/documents/${carry.documentId}/fields?saved=1`,
        );
        assert.equal((await column(carry)).rent_amount, null);
        const half = await carry.pool.query<{ promoted_to: string | null }>(
          'SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1',
          [await carry.rowId(carry.documentId, 'rent_amount')],
        );
        assert.equal(half.rows[0]?.promoted_to, null);

        const currency = await carry.post(
          `/documents/${carry.documentId}/fields/approve`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'rent_currency',
            ),
          },
        );
        assert.equal(currency.statusCode, 302, currency.body.slice(0, 300));
        const priced = await column(carry);
        assert.equal(priced.rent_amount, RENT);
        assert.equal(priced.rent_currency, CURRENCY);
        const pair = await carry.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.promote_field'
              AND subject_id = ANY($1::text[])`,
          [
            [
              await carry.rowId(carry.documentId, 'rent_amount'),
              await carry.rowId(carry.documentId, 'rent_currency'),
            ],
          ],
        );
        assert.equal(pair.rows[0]?.n, '1');

        for (const [key, read] of [
          ['option_end_date', 'option_end_date'],
          ['parking_space_number', 'parking_name'],
          ['storage_space_number', 'storage_name'],
        ] as const) {
          const stamped = await carry.post(
            `/documents/${carry.documentId}/fields/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
          assert.equal(
            stamped.headers.location,
            `/documents/${carry.documentId}/fields?saved=1`,
          );
          const expected =
            key === 'option_end_date'
              ? OPTION
              : key === 'parking_space_number'
                ? BAY
                : STORE;
          assert.equal((await column(carry))[read], expected);
        }
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('approves a bay and a store that are not in the building and carries nothing for them', async (t) => {
    const address = 'נשיאה 176';
    const ran = await withCarry(
      {
        tag: 'a174miss',
        city: 'עיר נשיאה ג',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'parking_space_number', value: '999', word_ids: [8] },
          { field_key: 'storage_space_number', value: '707', word_ids: [9] },
        ],
      },
      async (carry) => {
        for (const key of [
          'rent_amount',
          'rent_currency',
          'parking_space_number',
          'storage_space_number',
        ]) {
          const stamped = await carry.post(
            `/documents/filing/${carry.documentId}/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
          assert.equal(
            stamped.headers.location,
            `/documents/filing/${carry.documentId}`,
          );
        }
        await approveOpening(carry);
        const row = await column(carry);
        assert.equal(row.rent_amount, RENT);
        assert.equal(row.parking_name, null);
        assert.equal(row.storage_name, null);
        for (const key of ['parking_space_number', 'storage_space_number']) {
          const id = await carry.rowId(carry.documentId, key);
          const stamp = await carry.pool.query<{ promoted_to: string | null }>(
            'SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1',
            [id],
          );
          assert.equal(stamp.rows[0]?.promoted_to, null);
          const audit = await carry.pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_log
              WHERE action = 'evidence.promote_field' AND subject_id = $1`,
            [id],
          );
          assert.equal(audit.rows[0]?.n, '0');
        }
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('a missing bay links to later-add, and קדם stays on the ledger until the bay exists', async (t) => {
    const address = 'נשיאה 176';
    const bay = '999';
    const store = '707';
    const ran = await withCarry(
      {
        tag: 'a176miss',
        city: 'עיר נשיאה ו',
        address,
        findings: [
          ...opening(address),
          { field_key: 'parking_space_number', value: bay, word_ids: [8] },
          { field_key: 'storage_space_number', value: store, word_ids: [9] },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        for (const key of ['parking_space_number', 'storage_space_number']) {
          const stamped = await carry.post(
            `/documents/${carry.documentId}/fields/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        }
        const place = await carry.pool.query<{ id: string }>(
          `SELECT building_id AS id FROM space WHERE space_id = $1`,
          [carry.unitId],
        );
        const buildingId = place.rows[0]?.id ?? '';
        assert.ok(buildingId);
        const bayHref = `/estate/inventory/${buildingId}?parking_count=1&parking_first=${bay}#more-spaces`;
        const storeHref = `/estate/inventory/${buildingId}?storage_count=1&storage_first=${store}#more-spaces`;
        const tenancyId = await carry.tenancyId();
        const letting = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.equal(letting.statusCode, 200);
        assert.match(letting.body, /אינה חניה ב/);
        assert.match(letting.body, /אינו מחסן ב/);
        assert.match(letting.body, new RegExp(bayHref.replace(/[?]/g, '\\?')));
        assert.match(
          letting.body,
          new RegExp(storeHref.replace(/[?]/g, '\\?')),
        );
        const ledger = await carry.get(`/documents/${carry.documentId}/fields`);
        assert.equal(ledger.statusCode, 200);
        assert.match(ledger.body, new RegExp(bayHref.replace(/[?]/g, '\\?')));
        assert.match(ledger.body, new RegExp(storeHref.replace(/[?]/g, '\\?')));

        const viewer = await signIn(carry.pool, fixedClock(ON), {
          email: 'viewer@a176miss.test',
          role: 'VIEWER',
        });
        const hiddenLetting = await carry.getAs(
          viewer,
          `/estate/tenancies/${tenancyId}`,
        );
        const hiddenLedger = await carry.getAs(
          viewer,
          `/documents/${carry.documentId}/fields`,
        );
        assert.match(hiddenLetting.body, /אינה חניה ב/);
        assert.match(hiddenLedger.body, /אינו מחסן ב/);
        assert.doesNotMatch(hiddenLetting.body, /parking_count=1/);
        assert.doesNotMatch(hiddenLedger.body, /storage_count=1/);

        const named = async (kind: string, name: string) => {
          const rows = await carry.pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM space
              WHERE building_id = $1 AND space_kind = $2 AND name = $3`,
            [buildingId, kind, name],
          );
          return rows.rows[0]?.n ?? '0';
        };
        assert.equal(await named('PARKING', bay), '0');
        assert.equal(await named('STORAGE', store), '0');

        const stuck = await carry.post(
          `/documents/${carry.documentId}/promote`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'parking_space_number',
            ),
          },
        );
        assert.equal(stuck.statusCode, 200, stuck.body.slice(0, 300));
        assert.match(stuck.body, /אינה חניה ב/);
        assert.match(stuck.body, /קדם/);
        assert.doesNotMatch(stuck.body, /"code"/);
        assert.equal((await column(carry)).parking_name, null);
        assert.equal(await named('PARKING', bay), '0');
        const refused = await carry.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.promote_field' AND subject_id = $1`,
          [await carry.rowId(carry.documentId, 'parking_space_number')],
        );
        assert.equal(refused.rows[0]?.n, '0');

        const form = await carry.get(
          `/estate/inventory/${buildingId}?parking_count=1&parking_first=${bay}`,
        );
        assert.equal(form.statusCode, 200);
        assert.match(form.body, /<details class="manage glass" open>/);
        assert.match(form.body, /id="parking_count"[^>]*value="1"/);
        assert.match(form.body, /id="parking_first"[^>]*value="999"/);
        assert.match(form.body, /id="storage_count"[^>]*value="0"/);

        const addedBay = await carry.post(
          `/estate/inventory/${buildingId}/spaces`,
          {
            unit_count: '0',
            parking_count: '1',
            parking_first: bay,
            storage_count: '0',
            elevator_count: '0',
          },
        );
        assert.equal(addedBay.statusCode, 303, addedBay.body.slice(0, 300));
        assert.equal(await named('PARKING', bay), '1');

        const carriedBay = await carry.post(
          `/documents/${carry.documentId}/promote`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'parking_space_number',
            ),
          },
        );
        assert.equal(carriedBay.statusCode, 302, carriedBay.body.slice(0, 300));
        assert.equal((await column(carry)).parking_name, bay);

        const storeForm = await carry.get(
          `/estate/inventory/${buildingId}?storage_count=1&storage_first=${store}`,
        );
        assert.match(storeForm.body, /id="storage_count"[^>]*value="1"/);
        assert.match(storeForm.body, /id="storage_first"[^>]*value="707"/);
        const addedStore = await carry.post(
          `/estate/inventory/${buildingId}/spaces`,
          {
            unit_count: '0',
            parking_count: '0',
            storage_count: '1',
            storage_first: store,
            elevator_count: '0',
          },
        );
        assert.equal(addedStore.statusCode, 303, addedStore.body.slice(0, 300));
        const carriedStore = await carry.post(
          `/documents/${carry.documentId}/promote`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'storage_space_number',
            ),
          },
        );
        assert.equal(
          carriedStore.statusCode,
          302,
          carriedStore.body.slice(0, 300),
        );
        assert.equal((await column(carry)).storage_name, store);
        assert.equal(await named('STORAGE', store), '1');

        const landed = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.match(landed.body, /חניה משויכת[\s\S]{0,200}999/);
        assert.match(landed.body, /מחסן משויך[\s\S]{0,200}707/);
        assert.doesNotMatch(landed.body, /parking_count=1/);
        assert.doesNotMatch(landed.body, /מאושר, לא הועבר להשכרה/);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('lands rooms and floor on the unit when the unit holds nothing different', async (t) => {
    const address = 'נשיאה 177';
    const ran = await withCarry(
      {
        tag: 'a174rooms',
        city: 'עיר נשיאה ד',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rooms', value: ROOMS, word_ids: [5] },
          { field_key: 'floor', value: FLOOR, word_ids: [6] },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        for (const key of ['rooms', 'floor']) {
          const stamped = await carry.post(
            `/documents/${carry.documentId}/fields/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        }
        const rooms = await carry.pool.query<{ rooms: string }>(
          'SELECT rooms::text AS rooms FROM unit WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(rooms.rows[0]?.rooms, ROOMS);
        const floor = await carry.pool.query<{ floor: string | null }>(
          'SELECT floor FROM space WHERE space_id = $1',
          [carry.unitId],
        );
        assert.equal(floor.rows[0]?.floor, FLOOR);
        for (const [key, target] of [
          ['rooms', 'unit.rooms'],
          ['floor', 'space.floor'],
        ] as const) {
          const stamp = await carry.pool.query<{ promoted_to: string | null }>(
            'SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1',
            [await carry.rowId(carry.documentId, key)],
          );
          assert.equal(stamp.rows[0]?.promoted_to, target);
        }
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('does not overwrite a different rent, and קדם still can', async (t) => {
    const address = 'נשיאה 178';
    const ran = await withCarry(
      {
        tag: 'a174keep',
        city: 'עיר נשיאה ה',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
        ],
        otherFindings: [
          ...opening(address),
          { field_key: 'rent_amount', value: '6000', word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
        ],
      },
      async (carry) => {
        for (const key of ['rent_amount', 'rent_currency']) {
          await carry.post(`/documents/filing/${carry.documentId}/approve`, {
            extracted_field_id: await carry.rowId(carry.documentId, key),
          });
        }
        await approveOpening(carry);
        assert.equal((await column(carry)).rent_amount, RENT);

        const second = await carry.fileBoundLease('SECOND-LEASE');
        for (const key of ['rent_amount', 'rent_currency']) {
          const stamped = await carry.post(
            `/documents/${second}/fields/approve`,
            { extracted_field_id: await carry.rowId(second, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
          assert.equal(
            stamped.headers.location,
            `/documents/${second}/fields?saved=1`,
          );
        }
        assert.equal((await column(carry)).rent_amount, RENT);
        const held = await carry.pool.query<{ promoted_to: string | null }>(
          'SELECT promoted_to FROM extracted_field WHERE extracted_field_id = $1',
          [await carry.rowId(second, 'rent_amount')],
        );
        assert.equal(held.rows[0]?.promoted_to, null);
        const refusedAudit = await carry.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.promote_field' AND subject_id = $1`,
          [await carry.rowId(second, 'rent_amount')],
        );
        assert.equal(refusedAudit.rows[0]?.n, '0');

        const refused = await carry.post(`/documents/${second}/promote`, {
          extracted_field_id: await carry.rowId(second, 'rent_amount'),
        });
        assert.equal(refused.statusCode, 409);
        assert.match(refused.body, /העמודה כבר נושאת/);
        assert.match(refused.body, /5200/);
        assert.match(refused.body, /החלף/);
        assert.equal((await column(carry)).rent_amount, RENT);

        const replaced = await carry.post(`/documents/${second}/promote`, {
          extracted_field_id: await carry.rowId(second, 'rent_amount'),
          supersede: '1',
        });
        assert.equal(replaced.statusCode, 302, replaced.body.slice(0, 300));
        assert.equal((await column(carry)).rent_amount, '6000');
      },
    );
    if (!ran) t.skip(skipReason);
  });
});

const MARK = 'מאושר, לא הועבר להשכרה';
const HALF = 'החצי השני של דמי השכירות טרם אושר';

describe('evidence · an approved value that is not on the letting says so', {
  concurrency: false,
}, () => {
  it('shows the approved rent and why the other half is missing, then drops the mark once both land', async (t) => {
    const address = 'נשיאה 175א';
    const ran = await withCarry(
      {
        tag: 'a175half',
        city: 'עיר נשיאה ו',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
        ],
      },
      async (carry) => {
        const amount = await carry.rowId(carry.documentId, 'rent_amount');
        const stamped = await carry.post(
          `/documents/filing/${carry.documentId}/approve`,
          { extracted_field_id: amount },
        );
        assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        const reading = await carry.get(
          `/documents/filing/${carry.documentId}`,
        );
        assert.equal(reading.statusCode, 200);
        assert.match(reading.body, new RegExp(HALF));
        assert.match(reading.body, new RegExp(RENT));
        assert.doesNotMatch(reading.body, />קדם/);

        await approveOpening(carry);
        const tenancyId = await carry.tenancyId();
        const page = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.equal(page.statusCode, 200);
        assert.match(page.body, new RegExp(RENT));
        assert.match(page.body, new RegExp(MARK));
        assert.match(page.body, new RegExp(HALF));
        assert.match(
          page.body,
          new RegExp(`/documents/${carry.documentId}/read\\?page=`),
        );
        assert.equal((await column(carry)).rent_amount, null);

        const ledger = await carry.get(`/documents/${carry.documentId}/fields`);
        assert.match(ledger.body, new RegExp(HALF));
        assert.match(ledger.body, />קדם/);

        const currency = await carry.post(
          `/documents/${carry.documentId}/fields/approve`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'rent_currency',
            ),
          },
        );
        assert.equal(currency.statusCode, 302, currency.body.slice(0, 300));
        const carried = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.match(carried.body, new RegExp(RENT));
        assert.match(carried.body, new RegExp(CURRENCY));
        assert.doesNotMatch(carried.body, new RegExp(MARK));
        assert.doesNotMatch(carried.body, new RegExp(HALF));
        assert.equal((await column(carry)).rent_amount, RENT);
        assert.equal((await column(carry)).rent_currency, CURRENCY);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('names a bay and a storage room that are not in the building', async (t) => {
    const address = 'נשיאה 175ב';
    const tag = 'a175bay';
    const ran = await withCarry(
      {
        tag,
        city: 'עיר נשיאה ז',
        address,
        findings: [
          ...opening(address),
          { field_key: 'parking_space_number', value: '999', word_ids: [5] },
          { field_key: 'storage_space_number', value: '404', word_ids: [6] },
        ],
      },
      async (carry) => {
        for (const key of ['parking_space_number', 'storage_space_number']) {
          const stamped = await carry.post(
            `/documents/filing/${carry.documentId}/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        }
        const reading = await carry.get(
          `/documents/filing/${carry.documentId}`,
        );
        assert.match(reading.body, /999/);
        assert.match(reading.body, /אינה חניה ב/);
        assert.match(reading.body, new RegExp(`בניין ${tag}`));
        assert.match(reading.body, /404/);
        assert.match(reading.body, /אינו מחסן ב/);
        assert.doesNotMatch(reading.body, />קדם/);

        await approveOpening(carry);
        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, new RegExp(MARK));
        assert.match(page.body, /999/);
        assert.match(page.body, /אינה חניה ב/);
        assert.match(page.body, new RegExp(`בניין ${tag}`));
        assert.match(page.body, /404/);
        assert.match(page.body, /אינו מחסן ב/);
        assert.equal((await column(carry)).parking_name, null);
        assert.equal((await column(carry)).storage_name, null);

        const ledger = await carry.get(`/documents/${carry.documentId}/fields`);
        assert.match(ledger.body, /אינה חניה ב/);
        assert.match(ledger.body, /אינו מחסן ב/);
        assert.match(ledger.body, />קדם/);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('names the value already held, and the mark is gone once קדם carries it', async (t) => {
    const address = 'נשיאה 175ג';
    const ran = await withCarry(
      {
        tag: 'a175held',
        city: 'עיר נשיאה ח',
        address,
        unitFloor: '1',
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'option_end_date', value: OPTION, word_ids: [7] },
          { field_key: 'rooms', value: '9', word_ids: [8] },
          { field_key: 'floor', value: '3', word_ids: [9] },
          {
            field_key: 'deposit_amount',
            value: 'UNAPPROVED-SECRET',
            word_ids: [10],
          },
        ],
        otherFindings: [
          ...opening(address),
          { field_key: 'rent_amount', value: '6000', word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'option_end_date', value: '2032-01-01', word_ids: [7] },
        ],
      },
      async (carry) => {
        for (const key of ['rent_amount', 'rent_currency', 'option_end_date']) {
          await carry.post(`/documents/filing/${carry.documentId}/approve`, {
            extracted_field_id: await carry.rowId(carry.documentId, key),
          });
        }
        await approveOpening(carry);
        for (const key of ['rooms', 'floor']) {
          const stamped = await carry.post(
            `/documents/${carry.documentId}/fields/approve`,
            { extracted_field_id: await carry.rowId(carry.documentId, key) },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        }
        const second = await carry.fileBoundLease('SECOND-LEASE');
        for (const key of ['rent_amount', 'rent_currency', 'option_end_date']) {
          const stamped = await carry.post(
            `/documents/${second}/fields/approve`,
            {
              extracted_field_id: await carry.rowId(second, key),
            },
          );
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
        }

        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, /6000/);
        assert.match(page.body, /2032-01-01/);
        assert.match(page.body, new RegExp(MARK));
        assert.match(page.body, /העמודה כבר נושאת/);
        assert.match(page.body, new RegExp(RENT));
        assert.match(page.body, new RegExp(OPTION));
        assert.match(page.body, /מספר חדרים/);
        assert.match(page.body, />9</);
        assert.match(page.body, /קומה/);
        assert.doesNotMatch(page.body, /UNAPPROVED-SECRET/);
        assert.equal((await column(carry)).rent_amount, RENT);
        assert.equal((await column(carry)).option_end_date, OPTION);

        const ledger = await carry.get(`/documents/${second}/fields`);
        assert.match(ledger.body, /העמודה כבר נושאת/);
        assert.match(ledger.body, />קדם/);

        const replaced = await carry.post(`/documents/${second}/promote`, {
          extracted_field_id: await carry.rowId(second, 'rent_amount'),
          supersede: '1',
        });
        assert.equal(replaced.statusCode, 302, replaced.body.slice(0, 300));
        const after = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.equal((await column(carry)).rent_amount, '6000');
        assert.match(after.body, /6000/);
        assert.doesNotMatch(
          after.body,
          new RegExp(`העמודה כבר נושאת[\\s\\S]{0,80}${RENT}`),
        );
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('says an approved rent and option end that never landed, on the letting and beside קדם', async (t) => {
    const address = 'נשיאה 173';
    const ran = await withCarry(
      {
        tag: 'a173stuck',
        city: 'עיר נשיאה ט',
        address,
        findings: [
          ...opening(address),
          { field_key: 'rent_amount', value: RENT, word_ids: [5] },
          { field_key: 'rent_currency', value: CURRENCY, word_ids: [6] },
          { field_key: 'option_end_date', value: OPTION, word_ids: [7] },
        ],
      },
      async (carry) => {
        for (const key of ['rent_amount', 'rent_currency', 'option_end_date']) {
          await carry.post(`/documents/filing/${carry.documentId}/approve`, {
            extracted_field_id: await carry.rowId(carry.documentId, key),
          });
        }
        const reading = await carry.get(
          `/documents/filing/${carry.documentId}`,
        );
        assert.match(reading.body, new RegExp(MARK));
        assert.match(reading.body, new RegExp(RENT));
        assert.match(reading.body, new RegExp(OPTION));
        assert.doesNotMatch(reading.body, />קדם/);

        await approveOpening(carry);
        assert.equal((await column(carry)).rent_amount, RENT);
        assert.equal((await column(carry)).option_end_date, OPTION);

        const tenancyId = await carry.tenancyId();
        const ids = await Promise.all(
          ['rent_amount', 'rent_currency', 'option_end_date'].map((key) =>
            carry.rowId(carry.documentId, key),
          ),
        );
        await inTransaction(carry.pool, async (db) => {
          await db.query("SELECT set_config('dona.promoting', 'on', true)");
          await db.query(
            `UPDATE extracted_field
                SET promoted_to = NULL, promoted_by = NULL, promoted_at = NULL
              WHERE extracted_field_id = ANY($1::uuid[])`,
            [ids],
          );
          await db.query(
            `UPDATE tenancy
                SET rent_amount = NULL, rent_currency = NULL, option_end_date = NULL
              WHERE tenancy_id = $1`,
            [tenancyId],
          );
        });

        const page = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.match(page.body, new RegExp(RENT));
        assert.match(page.body, new RegExp(OPTION));
        assert.match(page.body, new RegExp(MARK));
        assert.doesNotMatch(page.body, /<dt>דמי שכירות<\/dt>\s*<dd>—/);
        assert.doesNotMatch(page.body, /<dt>תום האופציה<\/dt>\s*<dd>—/);

        const ledger = await carry.get(`/documents/${carry.documentId}/fields`);
        assert.match(ledger.body, new RegExp(MARK));
        assert.match(ledger.body, new RegExp(RENT));
        assert.match(ledger.body, new RegExp(OPTION));
        assert.match(ledger.body, />קדם/);
      },
    );
    if (!ran) t.skip(skipReason);
  });
});

const ON_SECOND_BAY = new Date('2026-10-01T09:00:00.000Z');

async function approveMapped(
  carry: Carry,
  documentId: string,
  key: string,
): Promise<void> {
  const stamped = await carry.post(`/documents/${documentId}/fields/approve`, {
    extracted_field_id: await carry.rowId(documentId, key),
  });
  assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 400));
}

async function bayLines(
  carry: Carry,
  documentId: string,
): Promise<{ key: string; value: string; approved: Date | null }[]> {
  const rows = await carry.pool.query<{
    key: string;
    value: string;
    approved: Date | null;
  }>(
    `SELECT f.field_key AS key, e.value, e.approved_at AS approved
       FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
      WHERE e.document_id = $1
        AND f.field_key IN ('parking_space_number', 'second_parking_space_number')
      ORDER BY f.field_key`,
    [documentId],
  );
  return rows.rows;
}

describe('evidence · a lease that names two bays assigns each', {
  concurrency: false,
}, () => {
  it('a plus becomes two lines, and the first assigns without the second', async (t) => {
    const address = 'שתי חניות 1';
    const ran = await withCarry(
      {
        tag: 'a179plus',
        city: 'עיר שתי חניות א',
        address,
        on: ON_SECOND_BAY,
        parking: ['237', '234'],
        findings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '237 + 234',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        const reading = await carry.get(
          `/documents/filing/${carry.documentId}`,
        );
        assert.equal(reading.statusCode, 200);
        assert.match(reading.body, /מספר חניה/);
        assert.match(reading.body, /חניה שנייה/);
        assert.match(reading.body, /value="237"/);
        assert.match(reading.body, /value="234"/);
        assert.doesNotMatch(reading.body, /237 \+ 234/);

        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['237', '234'],
        );
        assert.equal(lines[1]?.approved, null);

        const row = await column(carry);
        assert.equal(row.parking_name, '237');
        assert.equal(row.second_parking_name, null);
        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, /חניה משויכת[\s\S]{0,200}237/);
        assert.doesNotMatch(page.body, /חניה שנייה/);
        const built = await carry.pool.query<{ id: string | null }>(
          'SELECT parking_space_id AS id FROM unit WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(built.rows[0]?.id, null);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('a comma is the same two lines, and each assign leaves the other', async (t) => {
    const address = 'שתי חניות 2';
    const ran = await withCarry(
      {
        tag: 'a179comma',
        city: 'עיר שתי חניות ב',
        address,
        on: ON_SECOND_BAY,
        parking: ['234', '237'],
        findings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '234,237',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => `${line.key}=${line.value}`),
          ['parking_space_number=234', 'second_parking_space_number=237'],
        );
        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        assert.equal((await column(carry)).parking_name, '234');
        assert.equal((await column(carry)).second_parking_name, null);

        await approveMapped(
          carry,
          carry.documentId,
          'second_parking_space_number',
        );
        const row = await column(carry);
        assert.equal(row.parking_name, '234');
        assert.equal(row.second_parking_name, '237');
        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, /חניה משויכת[\s\S]{0,200}234/);
        assert.match(page.body, /חניה שנייה[\s\S]{0,200}237/);
        const built = await carry.pool.query<{ id: string | null }>(
          'SELECT parking_space_id AS id FROM unit WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(built.rows[0]?.id, null);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('the second line assigns when the first bay is not in the building', async (t) => {
    const address = 'שתי חניות 3';
    const ran = await withCarry(
      {
        tag: 'a179miss1',
        city: 'עיר שתי חניות ג',
        address,
        on: ON_SECOND_BAY,
        parking: ['237'],
        findings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '999 + 237',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        assert.equal((await column(carry)).parking_name, null);
        await approveMapped(
          carry,
          carry.documentId,
          'second_parking_space_number',
        );
        const row = await column(carry);
        assert.equal(row.parking_name, null);
        assert.equal(row.second_parking_name, '237');
        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, /999/);
        assert.match(page.body, /אינה חניה ב/);
        assert.doesNotMatch(page.body, /999 \+ 237/);
        assert.match(page.body, /חניה שנייה[\s\S]{0,200}237/);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('a missing second bay names that number, and קדם carries it once the space exists', async (t) => {
    const address = 'שתי חניות 4';
    const ran = await withCarry(
      {
        tag: 'a179miss2',
        city: 'עיר שתי חניות ד',
        address,
        on: ON_SECOND_BAY,
        parking: ['234'],
        findings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '234, 999',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        await approveMapped(
          carry,
          carry.documentId,
          'second_parking_space_number',
        );
        assert.equal((await column(carry)).parking_name, '234');
        assert.equal((await column(carry)).second_parking_name, null);

        const place = await carry.pool.query<{ id: string }>(
          `SELECT building_id AS id FROM space WHERE space_id = $1`,
          [carry.unitId],
        );
        const buildingId = place.rows[0]?.id ?? '';
        const href = `/estate/inventory/${buildingId}?parking_count=1&parking_first=999#more-spaces`;
        const tenancyId = await carry.tenancyId();
        const letting = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.match(letting.body, /999/);
        assert.match(letting.body, /אינה חניה ב/);
        assert.doesNotMatch(letting.body, /234, 999/);
        assert.match(letting.body, new RegExp(href.replace(/[?]/g, '\\?')));
        const ledger = await carry.get(`/documents/${carry.documentId}/fields`);
        assert.match(ledger.body, new RegExp(href.replace(/[?]/g, '\\?')));

        const viewer = await signIn(carry.pool, fixedClock(ON_SECOND_BAY), {
          email: 'viewer@a179miss2.test',
          role: 'VIEWER',
        });
        const hidden = await carry.getAs(
          viewer,
          `/estate/tenancies/${tenancyId}`,
        );
        assert.match(hidden.body, /אינה חניה ב/);
        assert.doesNotMatch(hidden.body, /parking_count=1/);

        const stuck = await carry.post(
          `/documents/${carry.documentId}/promote`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'second_parking_space_number',
            ),
          },
        );
        assert.equal(stuck.statusCode, 200, stuck.body.slice(0, 300));
        assert.equal((await column(carry)).second_parking_name, null);

        const added = await carry.post(
          `/estate/inventory/${buildingId}/spaces`,
          {
            unit_count: '0',
            parking_count: '1',
            parking_first: '999',
            storage_count: '0',
            elevator_count: '0',
          },
        );
        assert.equal(added.statusCode, 303, added.body.slice(0, 300));
        const carried = await carry.post(
          `/documents/${carry.documentId}/promote`,
          {
            extracted_field_id: await carry.rowId(
              carry.documentId,
              'second_parking_space_number',
            ),
          },
        );
        assert.equal(carried.statusCode, 302, carried.body.slice(0, 300));
        const row = await column(carry);
        assert.equal(row.parking_name, '234');
        assert.equal(row.second_parking_name, '999');
        const landed = await carry.get(`/estate/tenancies/${tenancyId}`);
        assert.match(landed.body, /חניה שנייה[\s\S]{0,200}999/);
        assert.doesNotMatch(landed.body, /מאושר, לא הועבר להשכרה/);
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('a second bay already on the letting is occupied for that line only', async (t) => {
    const address = 'שתי חניות 5';
    const ran = await withCarry(
      {
        tag: 'a179held',
        city: 'עיר שתי חניות ה',
        address,
        on: ON_SECOND_BAY,
        parking: ['234', '237', '238'],
        findings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '234 + 237',
            word_ids: [8],
          },
        ],
        otherFindings: [
          ...opening(address),
          {
            field_key: 'parking_space_number',
            value: '234 + 238',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        await approveOpening(carry);
        await approveMapped(
          carry,
          carry.documentId,
          'second_parking_space_number',
        );
        assert.equal((await column(carry)).parking_name, null);
        assert.equal((await column(carry)).second_parking_name, '237');
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        assert.equal((await column(carry)).parking_name, '234');
        assert.equal((await column(carry)).second_parking_name, '237');

        const second = await carry.fileBoundLease('SECOND-LEASE');
        await approveMapped(carry, second, 'second_parking_space_number');
        assert.equal((await column(carry)).parking_name, '234');
        assert.equal((await column(carry)).second_parking_name, '237');
        const refused = await carry.post(`/documents/${second}/promote`, {
          extracted_field_id: await carry.rowId(
            second,
            'second_parking_space_number',
          ),
        });
        assert.equal(refused.statusCode, 409);
        assert.match(refused.body, /העמודה כבר נושאת/);
        assert.match(refused.body, /237/);
        assert.equal((await column(carry)).parking_name, '234');
        assert.equal((await column(carry)).second_parking_name, '237');
      },
    );
    if (!ran) t.skip(skipReason);
  });

  it('one bay stays one line, and three numbers keep the first two', async (t) => {
    const address = 'שתי חניות 6';
    const one = await withCarry(
      {
        tag: 'a179one',
        city: 'עיר שתי חניות ו',
        address,
        on: ON_SECOND_BAY,
        findings: [
          ...opening(address),
          { field_key: 'parking_space_number', value: BAY, word_ids: [8] },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          [BAY],
        );
        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        assert.equal((await column(carry)).parking_name, BAY);
        assert.equal((await column(carry)).second_parking_name, null);
        const page = await carry.get(
          `/estate/tenancies/${await carry.tenancyId()}`,
        );
        assert.match(page.body, new RegExp(BAY));
        assert.doesNotMatch(page.body, /חניה שנייה/);
      },
    );
    if (!one) {
      t.skip(skipReason);
      return;
    }

    const threeAddress = 'שתי חניות 7';
    const three = await withCarry(
      {
        tag: 'a179three',
        city: 'עיר שתי חניות ז',
        address: threeAddress,
        on: ON_SECOND_BAY,
        parking: ['234', '237', '240'],
        findings: [
          ...opening(threeAddress),
          {
            field_key: 'parking_space_number',
            value: '234,237,240',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['234', '237'],
        );
        const third = await carry.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM extracted_field
            WHERE document_id = $1 AND value = '240'`,
          [carry.documentId],
        );
        assert.equal(third.rows[0]?.n, '0');
        await approveOpening(carry);
        await approveMapped(carry, carry.documentId, 'parking_space_number');
        await approveMapped(
          carry,
          carry.documentId,
          'second_parking_space_number',
        );
        const row = await column(carry);
        assert.equal(row.parking_name, '234');
        assert.equal(row.second_parking_name, '237');
        const built = await carry.pool.query<{ id: string | null }>(
          'SELECT parking_space_id AS id FROM unit WHERE unit_id = $1',
          [carry.unitId],
        );
        assert.equal(built.rows[0]?.id, null);
      },
    );
    if (!three) {
      t.skip(skipReason);
      return;
    }

    const bothAddress = 'שתי חניות 8';
    const both = await withCarry(
      {
        tag: 'a179both',
        city: 'עיר שתי חניות ח',
        address: bothAddress,
        on: ON_SECOND_BAY,
        parking: ['234', '237', '240'],
        findings: [
          ...opening(bothAddress),
          {
            field_key: 'parking_space_number',
            value: '234,237,240',
            word_ids: [8],
          },
          {
            field_key: 'second_parking_space_number',
            value: '234,237,240',
            word_ids: [9],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['234', '237'],
        );
      },
    );
    if (!both) {
      t.skip(skipReason);
      return;
    }

    const gluedSecond = await withCarry(
      {
        tag: 'a179glued2',
        city: 'עיר שתי חניות ט',
        address: 'שתי חניות 9',
        on: ON_SECOND_BAY,
        parking: ['234', '237', '240'],
        findings: [
          ...opening('שתי חניות 9'),
          { field_key: 'parking_space_number', value: '234', word_ids: [8] },
          {
            field_key: 'second_parking_space_number',
            value: '234,237,240',
            word_ids: [9],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['234', '237'],
        );
      },
    );
    if (!gluedSecond) {
      t.skip(skipReason);
      return;
    }

    const thirdOnSecond = await withCarry(
      {
        tag: 'a179third',
        city: 'עיר שתי חניות י',
        address: 'שתי חניות 10',
        on: ON_SECOND_BAY,
        parking: ['234', '237', '240'],
        findings: [
          ...opening('שתי חניות 10'),
          {
            field_key: 'parking_space_number',
            value: '234,237,240',
            word_ids: [8],
          },
          {
            field_key: 'second_parking_space_number',
            value: '240',
            word_ids: [9],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['234', '237'],
        );
        const dropped = await carry.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM extracted_field
            WHERE document_id = $1 AND value = '240'`,
          [carry.documentId],
        );
        assert.equal(dropped.rows[0]?.n, '0');
      },
    );
    if (!thirdOnSecond) {
      t.skip(skipReason);
      return;
    }

    const onlySecond = await withCarry(
      {
        tag: 'a179only2',
        city: 'עיר שתי חניות כ',
        address: 'שתי חניות 11',
        on: ON_SECOND_BAY,
        parking: ['234', '237'],
        findings: [
          ...opening('שתי חניות 11'),
          {
            field_key: 'second_parking_space_number',
            value: '234,237',
            word_ids: [8],
          },
        ],
      },
      async (carry) => {
        const lines = await bayLines(carry, carry.documentId);
        assert.deepEqual(
          lines.map((line) => line.value),
          ['234', '237'],
        );
      },
    );
    if (!onlySecond) t.skip(skipReason);
  });
});
