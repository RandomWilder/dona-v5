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
  const app = buildApp({
    pool,
    version: '9.9.9-test',
    clock: fixedClock(ON),
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
          { kind: 'UNIT', name: 'דירה 13', floor: null, accessNote: null },
          { kind: 'PARKING', name: BAY, floor: null, accessNote: null },
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
    actor.current = await signIn(pool, fixedClock(ON), {
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
  storage_name: string | null;
}> {
  const letting = await carry.pool.query<{
    rent_amount: string | null;
    rent_currency: string | null;
    option_end_date: string | null;
    parking_name: string | null;
    storage_name: string | null;
  }>(
    `SELECT t.rent_amount::text AS rent_amount,
            t.rent_currency,
            t.option_end_date::text AS option_end_date,
            p.name AS parking_name,
            s.name AS storage_name
       FROM tenancy t
       LEFT JOIN space p ON p.space_id = t.parking_space_id
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
