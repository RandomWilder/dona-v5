// The upload screen, driven the way an administrator drives it. Slice 3.3, flow A1.
//
// `app.inject` posts a real `multipart/form-data` body, so what is under test is the whole path a
// browser takes: the form, the plugin, the sniffer, the guard, the object store and the rows. The
// wrong-file case is asserted **in both directions and against the tier-1 specimens**, which is the
// slice's Verify step; `tests/policy/document-verification.test.ts` is the same constraint at the
// level below, over every pair.
//
// Like `src/estate/routes.test.ts` this suite **commits**, because the routes read through the pool
// and a rolled-back transaction is invisible to them. The fixture carries an address of its own and
// the cleanup deletes exactly it.
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
import { KernelError } from '../kernel/errors.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakeOcrText, type OcrText } from '../kernel/ocr.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { upsertTenancy, upsertTermsProfile } from '../tenancy/contract.ts';
import { applyDocumentTypeCatalogue, documentFileHash } from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const CITY = 'עיר מסמכים';
const ADDRESS = 'רחוב המסמכים 3';
const PROJECT_CODE = 'TEST-DOCS';
const BUCKET = 'dona-v5-test-docs';
const AT = new Date('2026-09-07T09:00:00.000Z');

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז מסמכים',
      projectCode: PROJECT_CODE,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין מסמכים',
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT_CODE,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [{ kind: 'UNIT', name: 'דירה 4', floor: '1', accessNote: null }],
      units: [
        {
          spaceName: 'דירה 4',
          unitNumber: '4',
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

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const STAFF_DOMAIN = 'evidence-routes.test';

/**
 * The operator this suite drives as. **Slice 5.2**: this route is behind the session now, it is the
 * one route in the system that verifies its own CSRF token, and both facts are properties of the
 * request rather than of the assertions — so they are here, once, and every case gets them.
 */
let who: SignedIn;
const as = <T extends { inject: (o: never) => unknown }>(app: T): T =>
  asOperator(app as never, who) as unknown as T;

const BOUNDARY = '----donadomtest';

/**
 * A `multipart/form-data` body, built by hand.
 *
 * Written out rather than taken from a library because the point of this suite is that the *wire*
 * format the browser sends is the one the route parses; a helper that also built the parser's input
 * would be testing the two halves of one assumption against each other. The file part is last, as an
 * HTML form sends it.
 */
function upload(
  fields: Record<string, string>,
  file: { filename: string; bytes: Buffer } | null,
): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  // The token rides in the body, as a part, because this body is the multipart stream the route
  // parses itself (SPEC-evidence.md). It is first, before the file, which is the order an HTML form
  // sends a hidden input that is written above the file input.
  for (const [name, value] of Object.entries({ csrf: who.csrf, ...fields })) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
  };
}

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

const pngBytes = (marker: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(marker),
  ]);

function unavailableOcr(): OcrText {
  return {
    async pages() {
      throw new KernelError('unavailable', 'the ocr call timed out', {
        timeoutMs: 20_000,
      });
    },
    describe: () => 'fake',
  };
}

describe('evidence · the upload route', () => {
  it('files the right file and refuses the wrong one, both directions', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    // One app per document, because the reader is a dependency: the bytes say which *kind* of file
    // this is and the injected reader says what it says.
    const objects = createMemoryStore();
    const appFor = (text: string) =>
      buildApp({
        pool,
        version: '9.9.9-test',
        clock: fixedClock(AT),
        objects,
        pdf: createFakePdfText([text]),
        bucket: BUCKET,
      });
    const lease = appFor(specimen('lease-standard.md'));
    const arnona = appFor(specimen('arnona-bill.md'));
    const blank = appFor('');
    const hashes: string[] = [];
    const extraApps: ReturnType<typeof buildApp>[] = [];
    let unitId = '';

    try {
      await signOutAll(pool, STAFF_DOMAIN);
      who = await signIn(pool, fixedClock(AT), {
        email: `ops@${STAFF_DOMAIN}`,
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await importEstate(pool, plan);
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY, ADDRESS],
      );
      unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);

      await t.test('the screen offers the catalogue and the flat', async () => {
        const response = await as(lease).inject({
          method: 'GET',
          url: `/documents/new?unit=${unitId}`,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /הוספת מסמך/);
        assert.match(response.body, /value="lease"/);
        assert.match(response.body, /value="handover_protocol"/);
        assert.match(response.body, /enctype="multipart\/form-data"/);
        // The rule every screen keeps, and 5.2 kept deliberately: a flat, a type and a date,
        // never a name.
        // A ULID can contain `053-0`; a mobile number is 05x plus seven more digits.
        assert.doesNotMatch(response.body, /05\d[- ]?\d{7}/);
      });

      await t.test('files a lease declared as a lease', async () => {
        const body = upload(
          { unit: unitId, type: 'lease', tenancy: '' },
          // A filename with a household's name in it, which is exactly what arrives in practice —
          // and it must reach neither the path nor the row nor the screen.
          { filename: 'שכירות כהן.pdf', bytes: pdfBytes('lease one') },
        );
        const response = await as(lease).inject({
          method: 'POST',
          url: '/documents',
          ...body,
        });
        assert.equal(response.statusCode, 302);
        assert.match(
          response.headers.location ?? '',
          /\/documents\/[0-9a-f-]{36}\/tenancy$/,
        );
        const confirm = await as(lease).inject({
          method: 'GET',
          url: String(response.headers.location),
        });
        assert.equal(confirm.statusCode, 200);
        assert.match(confirm.body, /אישור חוזה/);
        assert.doesNotMatch(confirm.body, /כהן/);

        const rows = await pool.query<{
          file_hash: string;
          storage_uri: string;
        }>(
          `SELECT d.file_hash, d.storage_uri FROM document d
             JOIN document_link l ON l.document_id = d.document_id
            WHERE l.entity_id = $1`,
          [unitId],
        );
        assert.equal(rows.rows.length, 1);
        const filed = rows.rows[0];
        assert.ok(filed);
        hashes.push(filed.file_hash);
        assert.match(
          filed.storage_uri,
          new RegExp(
            `^gs://${BUCKET}/unit/${unitId}/lease/[0-9a-f]{64}\\.pdf$`,
          ),
        );
        assert.doesNotMatch(filed.storage_uri, /כהן/);
      });

      await t.test(
        'the named lease is on the unit page and in search, as a door not a gs:// href',
        async () => {
          const unitPage = await as(lease).inject({
            method: 'GET',
            url: `/estate/units/${unitId}`,
          });
          assert.equal(unitPage.statusCode, 200);
          assert.match(unitPage.body, /חוזה שכירות/);
          assert.match(unitPage.body, /gs:\/\/dona-v5-test-docs\//);
          assert.match(unitPage.body, /נמצאו כל הביטויים הקבועים של הטופס/);
          assert.match(unitPage.body, /\/documents\/[0-9a-f-]{36}\/read/);
          assert.match(unitPage.body, /\/documents\/[0-9a-f-]{36}\/tenancy/);
          assert.doesNotMatch(unitPage.body, /href="gs:/);
          assert.doesNotMatch(unitPage.body, /storage\.googleapis\.com/);

          const found = await as(lease).inject({
            method: 'GET',
            url: `/estate/search?q=${encodeURIComponent('בניין מסמכים')}`,
          });
          assert.equal(found.statusCode, 200);
          assert.match(found.body, /מסמכים/);
          assert.match(found.body, /חוזה שכירות/);
          assert.match(found.body, /\/documents\/[0-9a-f-]{36}\/read/);
        },
      );

      await t.test(
        'refuses an ארנונה bill in the lease slot, and files nothing',
        async () => {
          const response = await as(arnona).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'bill.pdf', bytes: pdfBytes('arnona bill') },
            ),
          });
          // 422 and not 400: the request was well formed and the file was wrong.
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /אינו נראה כמו/);
          // The form comes back with what was chosen still chosen, and names what was missing.
          assert.match(response.body, /value="lease" selected/);
          assert.match(response.body, /class="chip"/);
          const count = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM document_link WHERE entity_id = $1`,
            [unitId],
          );
          assert.equal(count.rows[0]?.n, '1');
        },
      );

      await t.test(
        'refuses a lease in the ארנונה slot — the other direction',
        async () => {
          const response = await as(lease).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'arnona', tenancy: '' },
              { filename: 'lease.pdf', bytes: pdfBytes('lease two') },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /אינו נראה כמו/);
          const count = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM document_link WHERE entity_id = $1`,
            [unitId],
          );
          assert.equal(count.rows[0]?.n, '1');
        },
      );

      await t.test('refuses a post with no file at all', async () => {
        const response = await as(lease).inject({
          method: 'POST',
          url: '/documents',
          ...upload({ unit: unitId, type: 'lease' }, null),
        });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().code, 'invalid');
      });

      await t.test(
        'an empty text layer files as unverified, HTTP 200 not 503',
        async () => {
          const response = await as(blank).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'scan.pdf', bytes: pdfBytes('empty layer') },
            ),
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /המסמך נשמר/);
          assert.match(response.body, /אינו נושא שכבת טקסט/);
          assert.doesNotMatch(response.body, /503/);
          const rows = await pool.query<{
            file_hash: string;
            document_id: string;
          }>(
            `SELECT d.file_hash, d.document_id FROM document d
               JOIN document_link l ON l.document_id = d.document_id
              WHERE l.entity_id = $1 AND d.verification_verdict = 'unverified'`,
            [unitId],
          );
          const filed = rows.rows[0];
          assert.ok(filed);
          hashes.push(filed.file_hash);
        },
      );

      await t.test(
        'GET /documents/:id/read draws word boxes for a native PDF',
        async () => {
          const rows = await pool.query<{ document_id: string }>(
            `SELECT d.document_id FROM document d
               JOIN document_link l ON l.document_id = d.document_id
              WHERE l.entity_id = $1 AND d.verification_verdict = 'verified'
              LIMIT 1`,
            [unitId],
          );
          const documentId = rows.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const response = await as(lease).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /מילים על הדף/);
          assert.match(response.body, /word-box/);
          assert.match(response.body, /inset-inline-start/);
          assert.doesNotMatch(response.body, /(?:^|[\s;{])left\s*:/);
        },
      );

      await t.test(
        'GET /documents/:id/read?page=2 shows that page, not page 1',
        async () => {
          const bytes = pdfBytes(`two-page-read-${Date.now()}`);
          hashes.push(documentFileHash(bytes));
          const two = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects,
            pdf: createFakePdfText([
              specimen('lease-standard.md'),
              'PAGE-TWO-ONLY-WORD',
            ]),
            bucket: BUCKET,
          });
          extraApps.push(two);
          const posted = await as(two).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'two.pdf', bytes },
            ),
          });
          assert.equal(posted.statusCode, 302, posted.body.slice(0, 400));
          const rows = await pool.query<{ document_id: string }>(
            'SELECT document_id FROM document WHERE file_hash = $1',
            [documentFileHash(bytes)],
          );
          const documentId = rows.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const first = await as(two).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(first.statusCode, 200, first.body.slice(0, 400));
          assert.doesNotMatch(first.body, /PAGE-TWO-ONLY-WORD/);
          const second = await as(two).inject({
            method: 'GET',
            url: `/documents/${documentId}/read?page=2`,
          });
          assert.equal(second.statusCode, 200, second.body.slice(0, 400));
          assert.match(second.body, /PAGE-TWO-ONLY-WORD/);
          const bad = await as(two).inject({
            method: 'GET',
            url: `/documents/${documentId}/read?page=nope`,
          });
          assert.equal(bad.statusCode, 400);
        },
      );

      await t.test(
        'an OCR timeout still files the scan, HTTP 200 not 503',
        async () => {
          const app = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects: createMemoryStore(),
            pdf: createFakePdfText([]),
            ocr: unavailableOcr(),
            bucket: BUCKET,
          });
          extraApps.push(app);
          const response = await as(app).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'photo.png', bytes: pngBytes('timeout') },
            ),
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /אינו נושא שכבת טקסט/);
          const rows = await pool.query<{ file_hash: string }>(
            `SELECT d.file_hash FROM document d
               JOIN document_link l ON l.document_id = d.document_id
              WHERE l.entity_id = $1 AND d.storage_uri LIKE '%.png'`,
            [unitId],
          );
          const hash = rows.rows[0]?.file_hash;
          assert.ok(hash);
          hashes.push(hash);
        },
      );

      await t.test(
        'OCRs a scan on the same request and offers the overlay',
        async () => {
          const app = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects: createMemoryStore(),
            pdf: createFakePdfText([]),
            ocr: createFakeOcrText([specimen('lease-standard.md')]),
            bucket: BUCKET,
          });
          extraApps.push(app);
          const response = await as(app).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              {
                filename: 'scan.png',
                bytes: pngBytes(`ocr-overlay-${unitId}`),
              },
            ),
          });
          assert.equal(response.statusCode, 302);
          const posted = await pool.query<{ file_hash: string }>(
            `SELECT d.file_hash FROM document d
               JOIN document_link l ON l.document_id = d.document_id
              WHERE l.entity_id = $1
              ORDER BY d.ingested_at DESC
              LIMIT 1`,
            [unitId],
          );
          const postedHash = posted.rows[0]?.file_hash;
          assert.ok(postedHash);
          hashes.push(postedHash);
          const location = String(response.headers.location ?? '');
          const documentId =
            location.match(/\/documents\/([0-9a-f-]{36})\/tenancy$/)?.[1] ?? '';
          assert.ok(documentId);
          const overlay = await as(app).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(overlay.statusCode, 200, overlay.body.slice(0, 400));
          assert.match(overlay.body, /word-box/);
          assert.match(overlay.body, /קריאה אוטומטית/);
        },
      );

      await t.test(
        'a malformed unit is invalid and a missing one is not_found',
        async () => {
          const malformed = await as(lease).inject({
            method: 'GET',
            url: '/documents/new?unit=not-an-id',
          });
          assert.equal(malformed.statusCode, 400);
          assert.equal(malformed.json().code, 'invalid');

          const missing = await as(lease).inject({
            method: 'GET',
            url: '/documents/new?unit=11111111-1111-4111-8111-111111111111',
          });
          assert.equal(missing.statusCode, 404);
          assert.equal(missing.json().code, 'not_found');
        },
      );
    } finally {
      await signOutAll(pool, STAFF_DOMAIN);
      for (const hash of hashes) {
        await pool
          .query(
            'DELETE FROM document_link WHERE document_id IN (SELECT document_id FROM document WHERE file_hash = $1)',
            [hash],
          )
          .catch(() => {});
        await pool
          .query('DELETE FROM document WHERE file_hash = $1', [hash])
          .catch(() => {});
      }
      if (unitId) {
        await pool
          .query(
            `DELETE FROM audit_log
              WHERE action IN (
                'evidence.file_document',
                'evidence.read_document',
                'evidence.extract_document'
              )
                AND subject_id = $1`,
            [unitId],
          )
          .catch(() => {});
      }
      await pool
        .query(
          `DELETE FROM unit WHERE unit_id IN (
             SELECT space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY, ADDRESS],
        )
        .catch(() => {});
      await pool
        .query(
          `DELETE FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
          [CITY, ADDRESS],
        )
        .catch(() => {});
      await pool
        .query('DELETE FROM building WHERE city = $1 AND address_line = $2', [
          CITY,
          ADDRESS,
        ])
        .catch(() => {});
      await pool
        .query('DELETE FROM project WHERE project_code = $1', [PROJECT_CODE])
        .catch(() => {});
      await lease.close();
      await arnona.close();
      await blank.close();
      for (const extra of extraApps) {
        await extra.close();
      }
      await pool.end();
    }
  });
});

describe('evidence · A3 addendum upload redirects to confirm', () => {
  it('a verified addendum filed against a letting is 302 to /tenancy', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const CITY_A3 = 'עיר נספח';
    const ADDRESS_A3 = 'רחוב הנספח 7';
    const PROJECT_A3 = 'TEST-AMEND';
    const objects = createMemoryStore();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      objects,
      pdf: createFakePdfText(['נספח לחוזה השכירות']),
      bucket: BUCKET,
    });
    let unitId = '';
    const hashes: string[] = [];
    try {
      await signOutAll(pool, STAFF_DOMAIN);
      who = await signIn(pool, fixedClock(AT), {
        email: `ops@${STAFF_DOMAIN}`,
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await importEstate(pool, {
        projects: [
          {
            name: 'מכרז נספח',
            projectCode: PROJECT_A3,
            tenderRef: null,
            status: 'ACTIVE',
          },
        ],
        buildings: [
          {
            name: 'בניין נספח',
            addressLine: ADDRESS_A3,
            city: CITY_A3,
            projectCode: PROJECT_A3,
            handoverDate: '2025-03-01',
            warrantyEndDate: '2027-03-01',
            status: 'ACTIVE',
            spaces: [
              { kind: 'UNIT', name: 'דירה 4', floor: '1', accessNote: null },
            ],
            units: [
              {
                spaceName: 'דירה 4',
                unitNumber: '4',
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
      });
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY_A3, ADDRESS_A3],
      );
      unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);
      const profile = await upsertTermsProfile(
        pool,
        `a3-http-${unitId.slice(0, 8)}`,
      );
      const tenancy = await upsertTenancy(pool, {
        unitId,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        status: 'DRAFT',
        termsProfileId: profile.id,
        noticeDate: null,
        actualMoveOut: null,
      });
      const response = await as(app).inject({
        method: 'POST',
        url: '/documents',
        ...upload(
          {
            unit: unitId,
            type: 'lease_amendment',
            tenancy: tenancy.id,
          },
          { filename: 'amendment.pdf', bytes: pdfBytes('a3-http') },
        ),
      });
      assert.equal(response.statusCode, 302);
      assert.match(
        response.headers.location ?? '',
        /\/documents\/[0-9a-f-]{36}\/tenancy$/,
      );
      const hashed = await pool.query<{ file_hash: string }>(
        `SELECT file_hash FROM document d
           JOIN document_link l ON l.document_id = d.document_id
          WHERE l.entity_id = $1
          ORDER BY d.ingested_at DESC LIMIT 1`,
        [unitId],
      );
      if (hashed.rows[0]) hashes.push(hashed.rows[0].file_hash);
    } finally {
      await signOutAll(pool, STAFF_DOMAIN);
      for (const hash of hashes) {
        await pool.query(
          `DELETE FROM extracted_field WHERE document_id IN
             (SELECT document_id FROM document WHERE file_hash = $1)`,
          [hash],
        );
        await pool.query(
          `DELETE FROM document_link WHERE document_id IN
             (SELECT document_id FROM document WHERE file_hash = $1)`,
          [hash],
        );
        await pool.query('DELETE FROM document WHERE file_hash = $1', [hash]);
      }
      if (unitId) {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN
             (SELECT tenancy_id FROM tenancy WHERE unit_id = $1)`,
          [unitId],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN
             (SELECT tenancy_id FROM tenancy WHERE unit_id = $1)`,
          [unitId],
        );
        await pool.query('DELETE FROM tenancy WHERE unit_id = $1', [unitId]);
        await pool.query(
          `DELETE FROM audit_log WHERE action LIKE 'evidence.%' AND subject_id = $1`,
          [unitId],
        );
      }
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY_A3, ADDRESS_A3],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_A3, ADDRESS_A3],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_A3, ADDRESS_A3],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_A3,
      ]);
      await app.close();
      await pool.end();
    }
  });
});
