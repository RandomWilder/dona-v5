// Ticket #109. One HTTP path: upload, read, correct, approve.
//
// Driven the way an administrator drives it — a real multipart body through `app.inject` — with
// the reader and extractor injected, so the suite is deterministic and spends nothing. Assertions
// are on the response, the rendered Hebrew, and the rows afterwards, never on how the answer was
// reached. The existing evidence route suite's posture: it commits, and it cleans up against its
// own bucket, because routes read through the pool.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
  unitDocumentAction,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const CITY = 'עיר תזמור';
const ADDRESS = 'רחוב התזמור 9';
const PROJECT = 'TEST-ORCH';
const BUCKET = 'dona-v5-test-orchestrate';
const DOMAIN = 'evidence-orchestrate.test';
const AT = new Date('2026-09-15T09:00:00.000Z');

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const BOUNDARY = '----donaorch';

function upload(
  fields: Record<string, string>,
  file: { filename: string; bytes: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    file.bytes,
    Buffer.from('\r\n'),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
  };
}

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז תזמור',
      projectCode: PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין תזמור',
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [{ kind: 'UNIT', name: 'דירה 9', floor: '1', accessNote: null }],
      units: [
        {
          spaceName: 'דירה 9',
          unitNumber: '9',
          rooms: 3,
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

describe('evidence · upload, read, approve', () => {
  it('files against a flat, lands on the ledger, corrects and stamps', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const pageOne = `כתובת המושכר: ${ADDRESS}, ${CITY}, דירה 9\n${specimen('lease-standard.md')}`;
    const pageTwo = 'דמי שכירות חמשת אלפים מטבע פיקדון';
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      objects: createMemoryStore(),
      pdf: {
        async pages(bytes) {
          const marker = bytes.toString('latin1');
          const text = marker.includes('orch-protocol')
            ? 'פרוטוקול מצב המושכר מונה מים מועד המסירה: 2026-03-01 דירה 9'
            : `${pageOne}\n${pageTwo}`;
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
      extractor: createFakeExtractor(() => ({
        findings: [
          { field_key: 'address', value: `${ADDRESS} ${CITY}`, word_ids: [0] },
          { field_key: 'apartment_number', value: '9', word_ids: [0] },
          { field_key: 'start_date', value: '2026-01-07', word_ids: [0] },
          { field_key: 'end_date', value: '2027-02-28', word_ids: [0] },
          { field_key: 'tenant_name', value: 'דנה כהן', word_ids: [0] },
          { field_key: 'rent_amount', value: '5200', word_ids: [0] },
          { field_key: 'rent_currency', value: 'ILS', word_ids: [0] },
          { field_key: 'deposit_amount', value: '10400', word_ids: [0] },
          { field_key: 'deposit_currency', value: 'ILS', word_ids: [0] },
        ],
      })),
      bucket: BUCKET,
    });
    let who: SignedIn | null = null;
    let documentId = '';
    let unitId = '';

    const form = (fields: Record<string, string>): string =>
      new URLSearchParams(fields).toString();
    const post = (url: string, fields: Record<string, string>) =>
      asOperator(app as never, who as SignedIn).inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form(fields),
      } as never) as unknown as ReturnType<typeof app.inject>;

    const sweepDocs = async (): Promise<void> => {
      await inTransaction(pool, async (db) => {
        await db.query("SELECT set_config('dona.approving', 'on', true)");
        await db.query("SELECT set_config('dona.promoting', 'on', true)");
        await db.query(
          `UPDATE extracted_field
              SET approved_value = NULL, approved_by = NULL, approved_at = NULL,
                  promoted_to = NULL, promoted_by = NULL, promoted_at = NULL
            WHERE document_id IN (SELECT document_id FROM document
                                   WHERE storage_uri LIKE $1)`,
          [`gs://${BUCKET}/%`],
        );
      });
      await pool.query(
        'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
      );
      try {
        await pool.query(
          `DELETE FROM tenancy_event WHERE extracted_field_id IN (
             SELECT extracted_field_id FROM extracted_field
              WHERE document_id IN (SELECT document_id FROM document
                                     WHERE storage_uri LIKE $1))`,
          [`gs://${BUCKET}/%`],
        );
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
      await pool.query(
        `DELETE FROM extracted_field WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET}/%`],
      );
      await pool.query(
        `DELETE FROM document_passage WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET}/%`],
      );
      await pool.query(
        `DELETE FROM document_link WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET}/%`],
      );
      await pool.query('DELETE FROM document WHERE storage_uri LIKE $1', [
        `gs://${BUCKET}/%`,
      ]);
    };
    const sweepPlace = async (): Promise<void> => {
      await pool.query(
        'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
      );
      try {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
           SELECT tenancy_id FROM tenancy WHERE unit_id IN (
             SELECT space_id FROM space WHERE building_id IN (
               SELECT building_id FROM building WHERE city = $1 AND address_line = $2)))`,
          [CITY, ADDRESS],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN (
           SELECT tenancy_id FROM tenancy WHERE unit_id IN (
             SELECT space_id FROM space WHERE building_id IN (
               SELECT building_id FROM building WHERE city = $1 AND address_line = $2)))`,
          [CITY, ADDRESS],
        );
        await pool.query(
          `DELETE FROM tenancy WHERE unit_id IN (
           SELECT space_id FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2))`,
          [CITY, ADDRESS],
        );
        await pool.query(
          `DELETE FROM unit WHERE unit_id IN (
           SELECT space_id FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2))`,
          [CITY, ADDRESS],
        );
        await pool.query(
          `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
          [CITY, ADDRESS],
        );
        await pool.query(
          'DELETE FROM building WHERE city = $1 AND address_line = $2',
          [CITY, ADDRESS],
        );
        await pool.query('DELETE FROM project WHERE project_code = $1', [
          PROJECT,
        ]);
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
    };

    try {
      await signOutAll(pool, DOMAIN);
      await sweepPlace();
      await sweepDocs();
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      who = await signIn(pool, fixedClock(AT), {
        email: `ops@${DOMAIN}`,
        role: 'ADMIN',
      });
      await importEstate(pool, plan);
      await upsertTermsProfile(pool, DEFAULT_TERMS_PROFILE);
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY, ADDRESS],
      );
      unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);

      const filed = await asOperator(app as never, who).inject({
        method: 'POST',
        url: '/documents',
        ...upload(
          { csrf: who.csrf, unit: unitId, type: 'lease', tenancy: '' },
          { filename: 'lease.pdf', bytes: pdfBytes(`orch-lease-${who.csrf}`) },
        ),
      });
      assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
      documentId =
        String(filed.headers.location ?? '').match(
          /\/documents\/([0-9a-f-]{36})\/fields$/,
        )?.[1] ?? '';
      assert.ok(documentId);
      assert.equal(
        String(filed.headers.location),
        unitDocumentAction('lease', documentId)?.href,
      );

      const anchored = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM document_link
          WHERE document_id = $1 AND entity_type = 'UNIT' AND entity_id = $2`,
        [documentId, unitId],
      );
      assert.equal(anchored.rows[0]?.n, '1');

      const read = await asOperator(app as never, who).inject({
        method: 'GET',
        url: `/documents/${documentId}/read`,
      });
      assert.equal(read.statusCode, 200);
      assert.match(read.body, /איכות הקריאה: לא נמדדה/);

      const ledger = await asOperator(app as never, who).inject({
        method: 'GET',
        url: `/documents/${documentId}/fields`,
      });
      assert.equal(ledger.statusCode, 200);
      assert.match(ledger.body, /מה נקרא מן המסמך/);
      assert.match(ledger.body, /<th>עמוד<\/th>/);
      assert.match(ledger.body, /דמי שכירות חודשיים/);
      assert.match(ledger.body, /סכום הפיקדון/);
      assert.match(ledger.body, /שוכר ראשי/);
      assert.match(ledger.body, /איכות הקריאה: לא נמדדה/);
      assert.doesNotMatch(ledger.body, /אישור כל מה שלא סומן/);
      assert.match(ledger.body, /<details class="prose-fold"/);

      const start = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = 'start_date'`,
        [documentId],
      );
      const startId = start.rows[0]?.id ?? '';
      assert.ok(startId);

      const corrected = await post(`/documents/${documentId}/fields/approve`, {
        csrf: who.csrf,
        extracted_field_id: startId,
        approved_value: '2026-01-01',
      });
      assert.equal(corrected.statusCode, 302);
      const afterCorrect = await asOperator(app as never, who).inject({
        method: 'GET',
        url: String(corrected.headers.location),
      });
      assert.match(afterCorrect.body, /2026-01-01/);
      assert.match(afterCorrect.body, /נקרא: 2026-01-07/);

      const stamped = await pool.query<{ approved_value: string }>(
        'SELECT approved_value FROM extracted_field WHERE extracted_field_id = $1',
        [startId],
      );
      assert.equal(stamped.rows[0]?.approved_value, '2026-01-01');

      await pool.query(
        `UPDATE extracted_field e
            SET confidence = 0.95
           FROM document_type_field f
          WHERE f.document_type_field_id = e.document_type_field_id
            AND e.document_id = $1
            AND f.field_key IN ('apartment_number', 'rent_amount', 'rent_currency',
              'deposit_amount', 'deposit_currency', 'address')`,
        [documentId],
      );

      const measured = await asOperator(app as never, who).inject({
        method: 'GET',
        url: `/documents/${documentId}/fields`,
      });
      assert.match(measured.body, /איכות הקריאה: טובה/);
      assert.match(measured.body, /אישור כל מה שלא סומן/);

      const bulk = await post(`/documents/${documentId}/fields/approve`, {
        csrf: who.csrf,
        action: 'unflagged',
      });
      assert.equal(bulk.statusCode, 302);
      const afterBulk = await asOperator(app as never, who).inject({
        method: 'GET',
        url: String(bulk.headers.location),
      });
      assert.doesNotMatch(afterBulk.body, /אישור כל מה שלא סומן/);

      const openNames = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND e.approved_at IS NULL
            AND f.field_key = 'tenant_name'`,
        [documentId],
      );
      assert.equal(openNames.rows[0]?.n, '1');

      const end = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = 'end_date'`,
        [documentId],
      );
      const name = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = 'tenant_name'`,
        [documentId],
      );
      await post(`/documents/${documentId}/fields/approve`, {
        csrf: who.csrf,
        extracted_field_id: end.rows[0]?.id ?? '',
      });
      const created = await post(`/documents/${documentId}/fields/approve`, {
        csrf: who.csrf,
        extracted_field_id: name.rows[0]?.id ?? '',
      });
      assert.equal(created.statusCode, 302);
      const tenancyUrl = String(created.headers.location);
      assert.match(tenancyUrl, /\/estate\/tenancies\/[0-9a-f-]{36}$/);
      const tenancyId =
        tenancyUrl.match(/\/estate\/tenancies\/([0-9a-f-]{36})$/)?.[1] ?? '';
      assert.ok(tenancyId);

      const sheet = await asOperator(app as never, who).inject({
        method: 'GET',
        url: tenancyUrl,
      });
      assert.equal(sheet.statusCode, 200);
      assert.match(sheet.body, /דנה כהן/);
      assert.match(sheet.body, /טיוטה/);
      assert.match(sheet.body, new RegExp(`/documents/${documentId}/fields`));
      assert.match(sheet.body, /שוכר ראשי/);
      assert.match(sheet.body, /disabled/);
      assert.match(sheet.body, /פרוטוקול מסירה — לא הוגש/);

      const refused = await post(`/estate/tenancies/${tenancyId}/activate`, {
        csrf: who.csrf,
      });
      assert.equal(refused.statusCode, 400);
      assert.equal(refused.json().code, 'invalid');
      assert.match(
        JSON.stringify(refused.json()),
        /this tenancy cannot be activated/,
      );
      assert.match(JSON.stringify(refused.json().details ?? {}), /handover/);

      const protocol = await asOperator(app as never, who).inject({
        method: 'POST',
        url: '/documents',
        ...upload(
          {
            csrf: who.csrf,
            unit: unitId,
            type: 'handover_protocol',
            tenancy: tenancyId,
          },
          {
            filename: 'protocol.pdf',
            bytes: pdfBytes(`orch-protocol-${who.csrf}`),
          },
        ),
      });
      assert.equal(protocol.statusCode, 302, protocol.body.slice(0, 400));

      const armed = await asOperator(app as never, who).inject({
        method: 'GET',
        url: tenancyUrl,
      });
      assert.match(
        armed.body,
        new RegExp(`action="/estate/tenancies/${tenancyId}/activate"`),
      );
      assert.doesNotMatch(armed.body, /disabled/);

      const live = await post(`/estate/tenancies/${tenancyId}/activate`, {
        csrf: who.csrf,
      });
      assert.equal(live.statusCode, 302);
      const afterLive = await asOperator(app as never, who).inject({
        method: 'GET',
        url: String(live.headers.location),
      });
      assert.match(afterLive.body, /פעיל/);

      const unitPage = await asOperator(app as never, who).inject({
        method: 'GET',
        url: `/estate/units/${unitId}`,
      });
      assert.match(
        unitPage.body,
        new RegExp(unitDocumentAction('lease', documentId)?.href ?? 'missing'),
      );
    } finally {
      await signOutAll(pool, DOMAIN);
      await sweepPlace();
      await sweepDocs();
      await app.close();
      await pool.end();
    }
  });
});
