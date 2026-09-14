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
import { createFakeExtractor } from '../kernel/extraction.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import {
  createFakeOcrText,
  type OcrText,
  onlineOcrPageLimit,
} from '../kernel/ocr.ts';
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
        // A ULID can contain `053-0`; a CSRF hash can contain `054` plus seven digits; a mobile
        // number is 05x plus seven more digits. Hidden tokens are not a person on the screen.
        const visible = response.body.replace(
          /<input type="hidden"[^>]*>/g,
          '',
        );
        assert.doesNotMatch(visible, /05\d[- ]?\d{7}/);
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
          uploaded_by: string | null;
        }>(
          `SELECT d.file_hash, d.storage_uri, d.uploaded_by FROM document d
             JOIN document_link l ON l.document_id = d.document_id
            WHERE l.entity_id = $1 AND d.uploaded_by = $2
            ORDER BY d.ingested_at DESC`,
          [unitId, who.staffAccountId],
        );
        assert.equal(rows.rows.length, 1);
        const filed = rows.rows[0];
        assert.ok(filed);
        hashes.push(filed.file_hash);
        assert.equal(filed.uploaded_by, who.staffAccountId);
        assert.match(
          filed.storage_uri,
          new RegExp(
            `^gs://${BUCKET}/unit/${unitId}/lease/[0-9a-f]{64}\\.pdf$`,
          ),
        );
        assert.doesNotMatch(filed.storage_uri, /כהן/);
      });

      await t.test(
        'the named lease is on the unit page and in search, as a door with a signed read',
        async () => {
          const unitPage = await as(lease).inject({
            method: 'GET',
            url: `/estate/units/${unitId}`,
          });
          assert.equal(unitPage.statusCode, 200);
          assert.match(unitPage.body, /חוזה שכירות/);
          assert.match(unitPage.body, /storage\.googleapis\.com/);
          assert.match(unitPage.body, /X-Goog-Expires=/);
          assert.match(unitPage.body, /נמצאו כל הביטויים הקבועים של הטופס/);
          assert.match(unitPage.body, /\/documents\/[0-9a-f-]{36}\/read/);
          assert.match(unitPage.body, /\/documents\/[0-9a-f-]{36}\/tenancy/);
          assert.doesNotMatch(unitPage.body, /href="gs:/);
          assert.doesNotMatch(unitPage.body, /gs:\/\/dona-v5-test-docs\//);

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
          // **`/503/` until 6.4, and it failed for weather.** This page prints a freshly generated
          // document id, and a hex id containing `503` turned a green suite red at random — the
          // same defect week 5 closed on, where a duplicated `/05\d/` read the CSRF token's own
          // hex. The status code above is what proves it was not a 503; what this line adds is that
          // the body is not the degraded shape, and `unavailable` is a word no identifier can be.
          assert.doesNotMatch(response.body, /unavailable/);
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
      // **Everything this suite's bucket holds, whoever left it.** Found at 6.3, by running this
      // file against a developer's own database several times in one afternoon: a case that reads
      // back its hash with `rows[0]` and no ORDER BY picks an arbitrary row once a previous run has
      // leaked one, pushes *that* hash, and leaves its own document behind — so one leak becomes a
      // leak per run. `BUCKET` is this suite's alone, so deleting by it is exact and self-healing.
      await pool
        .query(
          `DELETE FROM document_link WHERE document_id IN
             (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
          [`gs://${BUCKET}/%`],
        )
        .catch(() => {});
      await pool
        .query('DELETE FROM document WHERE storage_uri LIKE $1', [
          `gs://${BUCKET}/%`,
        ])
        .catch(() => {});
      await signOutAll(pool, STAFF_DOMAIN);
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
        `a3-http-${unitId.slice(24)}`,
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
        // **Slice 6.5, found by clicking.** This case writes a `terms_profile` through the pool and
        // never removed it, so every run since 4.7 left one behind: **121** of them by the time
        // A2's confirm screen put the annex list in front of a person. It is 6.3's leak in a second
        // table — one run leaks one row, and nothing says so until a select box is a hundred deep.
        // The tenancy that pointed at it went one statement ago, so this is safe and exact.
        await pool.query('DELETE FROM terms_profile WHERE name = $1', [
          `a3-http-${unitId.slice(24)}`,
        ]);
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

/**
 * **A12 — the document finds its own place. Slice 6.3.**
 *
 * The acceptance bar is two sentences from `tasks/todo.md`, and both are asserted here: a lease
 * naming רקפת 12, דירה 12A files against that flat *with no unit chosen by hand*; a lease naming an
 * address this system does not hold **writes no row and no object** and offers a search.
 *
 * The second half is the one worth the machinery. "Nothing was written" is not provable by the
 * absence of a screen, so it is proved by counting: document rows before and after, and every call
 * to `put` on the store, through a spy that wraps the memory one. A refusal that had written the
 * object and skipped the row would pass a body assertion and fail this.
 */
describe('evidence · A12 a document finds its own place', () => {
  it('files with no unit chosen, and writes nothing when the address is not ours', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const CITY_A12 = 'עיר קליטה';
    const ADDRESS_A12 = 'רקפת 12';
    const PROJECT_A12 = 'TEST-INTAKE';
    // The header a lease carries, in the anchors SPEC-evidence.md prints. Everything after it is
    // the specimen, which names no place at all — so what the reader reads is what this line says.
    const leasing = (address: string) =>
      `כתובת המושכר: ${address}\n${specimen('lease-standard.md')}`;

    // **The put counter.** A spy around the store rather than a second store, so what is under test
    // is the real path: the route writes the object through this and the count is the proof that on
    // a refusal it did not.
    const objects = createMemoryStore();
    let puts = 0;
    const counted = {
      ...objects,
      put: async (path: string, bytes: Buffer, contentType: string) => {
        puts += 1;
        return objects.put(path, bytes, contentType);
      },
    };
    const appFor = (text: string) =>
      buildApp({
        pool,
        version: '9.9.9-test',
        clock: fixedClock(AT),
        objects: counted,
        pdf: createFakePdfText([text]),
        bucket: BUCKET,
      });
    const here = appFor(leasing(`${ADDRESS_A12}, ${CITY_A12}, דירה 12A`));
    const elsewhere = appFor(leasing('אלמוג 5, עיר שאיננה, דירה 3'));
    const ambiguous = appFor(leasing(`${ADDRESS_A12}, ${CITY_A12}, דירה 9`));
    const apps = [here, elsewhere, ambiguous];
    const hashes: string[] = [];
    let unitA = '';
    let unitB = '';
    let viewer: SignedIn | null = null;

    const documentsHere = async (): Promise<number> => {
      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM document_link WHERE entity_id = ANY($1::uuid[])`,
        [[unitA, unitB]],
      );
      return Number(rows.rows[0]?.n ?? '0');
    };

    try {
      await signOutAll(pool, STAFF_DOMAIN);
      who = await signIn(pool, fixedClock(AT), {
        email: `ops@${STAFF_DOMAIN}`,
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await importEstate(pool, {
        projects: [
          {
            name: 'מכרז קליטה',
            projectCode: PROJECT_A12,
            tenderRef: null,
            status: 'ACTIVE',
          },
        ],
        buildings: [
          {
            name: 'בניין רקפת 12',
            addressLine: ADDRESS_A12,
            city: CITY_A12,
            projectCode: PROJECT_A12,
            handoverDate: '2025-03-01',
            warrantyEndDate: '2027-03-01',
            status: 'ACTIVE',
            spaces: [
              { kind: 'UNIT', name: 'דירה 12A', floor: '1', accessNote: null },
              { kind: 'UNIT', name: 'דירה 12B', floor: '1', accessNote: null },
            ],
            units: [
              {
                spaceName: 'דירה 12A',
                unitNumber: '12A',
                rooms: 3,
                areaSqm: 70,
                hasMamad: false,
                parkingSpaceName: null,
                storageSpaceName: null,
                warrantyEndDate: null,
                conditionStatus: 'READY',
              },
              {
                spaceName: 'דירה 12B',
                unitNumber: '12B',
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
      const found = await pool.query<{ unit_id: string; unit_number: string }>(
        `SELECT u.unit_id, u.unit_number FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2
          ORDER BY u.unit_number`,
        [CITY_A12, ADDRESS_A12],
      );
      unitA =
        found.rows.find((row) => row.unit_number === '12A')?.unit_id ?? '';
      unitB =
        found.rows.find((row) => row.unit_number === '12B')?.unit_id ?? '';
      assert.ok(unitA);
      assert.ok(unitB);

      await t.test(
        'the screen asks for a type and a file, and no flat',
        async () => {
          const response = await as(here).inject({
            method: 'GET',
            url: '/documents/new',
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /הוספת מסמך/);
          assert.match(response.body, /action="\/documents\/intake"/);
          assert.match(response.body, /value="lease"/);
          assert.doesNotMatch(response.body, /name="unit"/);
        },
      );

      await t.test(
        'a lease naming רקפת 12 דירה 12A files against 12A',
        async () => {
          const before = await documentsHere();
          const response = await as(here).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease' },
              { filename: 'שכירות לוי.pdf', bytes: pdfBytes('a12 one') },
            ),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.match(
            response.headers.location ?? '',
            /\/documents\/[0-9a-f-]{36}\/tenancy$/,
          );
          assert.equal((await documentsHere()) - before, 1);
          const rows = await pool.query<{
            file_hash: string;
            storage_uri: string;
          }>(
            `SELECT d.file_hash, d.storage_uri FROM document d
             JOIN document_link l ON l.document_id = d.document_id
            WHERE l.entity_id = $1
            ORDER BY d.ingested_at DESC LIMIT 1`,
            [unitA],
          );
          const filed = rows.rows[0];
          assert.ok(filed, 'the lease filed against 12A and not against 12B');
          hashes.push(filed.file_hash);
          assert.match(
            filed.storage_uri,
            new RegExp(
              `^gs://${BUCKET}/unit/${unitA}/lease/[0-9a-f]{64}\\.pdf$`,
            ),
          );
          // The filename carried a household name. It reached neither the path nor the screen.
          assert.doesNotMatch(filed.storage_uri, /לוי/);
        },
      );

      await t.test(
        'an address in no building writes no row and no object, and offers a search',
        async () => {
          const before = await documentsHere();
          const documentsBefore = await pool.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM document',
          );
          const putsBefore = puts;
          const response = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease' },
              { filename: 'unknown.pdf', bytes: pdfBytes('a12 elsewhere') },
            ),
          });
          assert.equal(response.statusCode, 422, response.body.slice(0, 400));
          // What was read, said back — so the refusal is one an operator can act on.
          assert.match(response.body, /אלמוג 5/);
          assert.match(response.body, /לא נשמר דבר/);
          assert.match(response.body, /חיפוש דירה אחרת/);
          assert.match(response.body, /type="file"/);

          assert.equal(await documentsHere(), before);
          const documentsAfter = await pool.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM document',
          );
          assert.equal(documentsAfter.rows[0]?.n, documentsBefore.rows[0]?.n);
          assert.equal(puts, putsBefore, 'no object was written');

          // The attempt is on the record, and counts against the day's cap.
          const audited = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_log
              WHERE action = 'evidence.intake_unresolved' AND actor_id = $1`,
            [who.staffAccountId],
          );
          assert.equal(audited.rows[0]?.n, '1');
        },
      );

      await t.test(
        'two flats at the address and neither is the one named — both are offered, nothing is written',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const response = await as(ambiguous).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease' },
              { filename: 'nine.pdf', bytes: pdfBytes('a12 ambiguous') },
            ),
          });
          assert.equal(response.statusCode, 422, response.body.slice(0, 400));
          assert.match(response.body, new RegExp(`value="${unitA}"`));
          assert.match(response.body, new RegExp(`value="${unitB}"`));
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test(
        'a candidate posted back files against it, unread',
        async () => {
          const before = await documentsHere();
          const response = await as(ambiguous).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease', unit: unitB },
              { filename: 'nine.pdf', bytes: pdfBytes('a12 chosen') },
            ),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal((await documentsHere()) - before, 1);
          const rows = await pool.query<{ file_hash: string }>(
            `SELECT d.file_hash FROM document d
             JOIN document_link l ON l.document_id = d.document_id
            WHERE l.entity_id = $1
            ORDER BY d.ingested_at DESC LIMIT 1`,
            [unitB],
          );
          const filed = rows.rows[0];
          assert.ok(filed, 'the chosen flat is the one it filed against');
          hashes.push(filed.file_hash);
        },
      );

      await t.test(
        'a scan too long for the reader is refused with a sentence, and files nothing',
        async () => {
          // **Slice 6.8, and it was red first.** `onlineOcrPageLimit` is 15 and real leases exceed
          // it. Until 6.8 the OCR call was silently declined and the row went in `unverified` — a
          // verdict that means *nobody could read this*, used for a file nobody looked at. It is a
          // refusal now, on a screen that says how long the file was and why that mattered, and the
          // call is not spent finding out.
          const before = await documentsHere();
          const putsBefore = puts;
          let calls = 0;
          const long = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects: counted,
            pdf: createFakePdfText(
              Array.from(
                { length: onlineOcrPageLimit + 1 },
                (_, at) => `עמוד ${at + 1} של סריקה ארוכה`,
              ),
            ),
            ocr: {
              describe: () => 'fake',
              pages: async () => {
                calls += 1;
                return { pages: [], images: [] };
              },
            },
            bucket: BUCKET,
          });
          const response = await as(long).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { csrf: (who as SignedIn).csrf, type: 'lease' },
              { filename: 'long.pdf', bytes: pdfBytes('a12 long scan') },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /ארוך מכדי/);
          assert.match(response.body, new RegExp(`${onlineOcrPageLimit + 1}`));
          // No candidate list: nothing was read off this file, so there is nothing to choose
          // between and offering a choice would be a question built on no reading.
          assert.doesNotMatch(response.body, /נקראה הכתובת/);
          assert.equal(calls, 0, 'the call was declined, not attempted');
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore, 'no object was written');
          await long.close();
        },
      );

      await t.test('a VIEWER is refused, and files nothing', async () => {
        viewer = await signIn(pool, fixedClock(AT), {
          email: `viewer@${STAFF_DOMAIN}`,
          role: 'VIEWER',
        });
        const before = await documentsHere();
        const putsBefore = puts;
        const body = upload(
          { csrf: viewer.csrf, type: 'lease' },
          { filename: 'viewer.pdf', bytes: pdfBytes('a12 viewer') },
        );
        const response = await here.inject({
          method: 'POST',
          url: '/documents/intake',
          ...body,
          headers: { ...body.headers, cookie: viewer.cookie },
        });
        assert.equal(response.statusCode, 403);
        assert.equal(response.json().code, 'not_allowed');
        assert.equal(await documentsHere(), before);
        assert.equal(puts, putsBefore);
      });

      await t.test(
        'a post with no token is refused, and files nothing',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const response = await as(here).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { csrf: '', type: 'lease' },
              { filename: 'forged.pdf', bytes: pdfBytes('a12 forged') },
            ),
          });
          assert.equal(response.statusCode, 403);
          assert.equal(response.json().code, 'not_allowed');
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );
    } finally {
      // **Before the accounts go.** An unresolved intake names no subject — there is no entity it
      // is about, which is the whole of what it records — so it is cleaned up by the operator who
      // made it, and `signOutAll` below is what takes that operator away.
      await pool
        .query(
          `DELETE FROM audit_log
            WHERE action = 'evidence.intake_unresolved' AND actor_id = $1`,
          [who.staffAccountId],
        )
        .catch(() => {});
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
      for (const unitId of [unitA, unitB].filter(Boolean)) {
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
        [CITY_A12, ADDRESS_A12],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_A12, ADDRESS_A12],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_A12, ADDRESS_A12],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_A12,
      ]);
      for (const app of apps) {
        await app.close();
      }
      await pool.end();
    }
  });
});

/**
 * **Slice 6.4.** The first identifier this system ever captures, and the three things that have to be
 * true about it before it may exist: an OPERATOR sees it nowhere, an ADMIN's read of it is on the
 * audit log, and a lease that names none is not an error.
 *
 * It drives the A12 intake route on a **scan**, which is also where 6.3's carry is paid: the route
 * reads the page to find the flat and `fileDocument` used to read the same bytes again for its own
 * verdict. The OCR spy counts what actually left, the way 6.3's put spy counted what was written.
 */
describe('evidence · a captured ת.ז., withheld unless the viewer may read it', () => {
  it('withholds from an OPERATOR, logs an ADMIN, and OCRs the scan once', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const CITY_ID = 'עיר מזהה';
    const ADDRESS_ID = 'רקפת 64';
    const PROJECT_ID = 'TEST-IDNUM';
    const STAFF_ID_DOMAIN = 'evidence-identifier.test';
    // A value that matches no other assertion in this repository: no `05` run, no `+972`. A fixture
    // that collided with one of those would fail for the wrong rule and be believed anyway.
    const ID_VALUE = '312345678';
    // **A clock on or after the declaration's `effective_from`, and this is not a detail.** The two
    // identifier fields open at `SCHEMA_V3 = '2026-09-13'`, so the suite's own `AT` of 7 Sep reads a
    // catalogue that does not declare them yet and extraction correctly returns nothing. R18's
    // versioning working is what that is, and it cost one confused run to see it.
    const AT_ID = new Date('2026-09-13T09:00:00.000Z');
    const leaseText = `כתובת המושכר: ${ADDRESS_ID}, ${CITY_ID}, דירה 64A\n${specimen(
      'lease-standard.md',
    )}`;

    // **The OCR counter**, around the real reader the route uses. Two calls for one scan was the
    // measured cost carried out of 6.3; this is the number that says it is one.
    let ocrCalls = 0;
    const reader = createFakeOcrText([leaseText]);
    const countedOcr: OcrText = {
      describe: () => reader.describe(),
      pages: async (bytes, mimeType, version) => {
        ocrCalls += 1;
        return reader.pages(bytes, mimeType, version);
      },
    };
    const withId = [
      { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
      { field_key: 'end_date', value: '2027-02-28', word_ids: [1] },
      { field_key: 'apartment_number', value: '64A', word_ids: [2] },
      {
        field_key: 'address',
        value: `${ADDRESS_ID} ${CITY_ID}`,
        word_ids: [3],
      },
      { field_key: 'tenant_name', value: 'יעל כהן', word_ids: [4] },
      { field_key: 'tenant_id_number', value: ID_VALUE, word_ids: [5] },
    ];
    let findings = withId;
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT_ID),
      objects: createMemoryStore(),
      // No text layer, so the page is a scan and OCR is the only way to its address.
      pdf: createFakePdfText([]),
      ocr: countedOcr,
      extractor: createFakeExtractor(() => ({ findings })),
      bucket: BUCKET,
    });
    const hashes: string[] = [];
    let operator: SignedIn | null = null;
    let admin: SignedIn | null = null;

    const reads = async (): Promise<number> => {
      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'evidence.read_identifier'`,
      );
      return Number(rows.rows[0]?.n ?? '0');
    };

    const fileScan = async (marker: string): Promise<string> => {
      const body = upload(
        { csrf: (admin as SignedIn).csrf, type: 'lease' },
        { filename: 'scan.png', bytes: pngBytes(marker) },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/documents/intake',
        ...body,
        headers: { ...body.headers, cookie: (admin as SignedIn).cookie },
      });
      assert.equal(response.statusCode, 302, response.body.slice(0, 400));
      const documentId =
        String(response.headers.location ?? '').match(
          /\/documents\/([0-9a-f-]{36})\/tenancy$/,
        )?.[1] ?? '';
      assert.ok(documentId, 'a verified lease goes to its confirm screen');
      const row = await pool.query<{ file_hash: string }>(
        'SELECT file_hash FROM document WHERE document_id = $1',
        [documentId],
      );
      const hash = row.rows[0]?.file_hash;
      assert.ok(hash);
      hashes.push(hash);
      return documentId;
    };

    try {
      await signOutAll(pool, STAFF_ID_DOMAIN);
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      admin = await signIn(pool, fixedClock(AT_ID), {
        email: `admin@${STAFF_ID_DOMAIN}`,
        role: 'ADMIN',
      });
      operator = await signIn(pool, fixedClock(AT_ID), {
        email: `ops@${STAFF_ID_DOMAIN}`,
        role: 'OPERATOR',
      });
      await importEstate(pool, {
        projects: [
          {
            name: 'מכרז מזהה',
            projectCode: PROJECT_ID,
            tenderRef: null,
            status: 'ACTIVE',
          },
        ],
        buildings: [
          {
            name: 'בניין מזהה',
            addressLine: ADDRESS_ID,
            city: CITY_ID,
            projectCode: PROJECT_ID,
            handoverDate: '2025-03-01',
            warrantyEndDate: '2027-03-01',
            status: 'ACTIVE',
            spaces: [
              { kind: 'UNIT', name: 'דירה 64A', floor: '1', accessNote: null },
            ],
            units: [
              {
                spaceName: 'דירה 64A',
                unitNumber: '64A',
                rooms: 3,
                areaSqm: 70,
                hasMamad: true,
                parkingSpaceName: null,
                storageSpaceName: null,
                warrantyEndDate: null,
                conditionStatus: 'READY',
              },
            ],
          },
        ],
      } satisfies EstatePlan);

      const documentId = await fileScan('idnum-lease');

      await t.test('the scan is OCR’d once, not twice', () => {
        // 6.3's carry, discharged. The route reads the page to find the flat and hands those pages
        // to `fileDocument` in `readPages`, so the `unverified` branch inside it reuses the reading
        // instead of buying a second one.
        assert.equal(ocrCalls, 1);
      });

      await t.test(
        'an ADMIN sees the value, and the read is logged',
        async () => {
          const before = await reads();
          const response = await asOperator(app, admin as SignedIn).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(response.statusCode, 200, response.body.slice(0, 400));
          assert.match(response.body, new RegExp(ID_VALUE));
          assert.match(response.body, /ת\.ז\. השוכר/);
          assert.equal(await reads(), before + 1);
        },
      );

      await t.test(
        'an OPERATOR sees a count, and nothing is logged',
        async () => {
          const before = await reads();
          const response = await asOperator(app, operator as SignedIn).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(response.statusCode, 200, response.body.slice(0, 400));
          assert.doesNotMatch(response.body, new RegExp(ID_VALUE));
          assert.doesNotMatch(response.body, /ת\.ז\. השוכר/);
          assert.match(response.body, /נקרא שדה מזהה אחד ואינו מוצג/);
          // The rest of the reading is still there: one row is withheld, the page is not.
          assert.match(response.body, /מספר הדירה/);
          // **Withholding is not a read.** A line here would make the count useless for the only
          // question it will ever be asked: who has seen this household's ת.ז.
          assert.equal(await reads(), before);
        },
      );

      await t.test('neither field may be promoted', async () => {
        // SPEC-evidence.md: the value becomes `party.national_id` when a human confirms a
        // household (6.5), which is an act and not a promotion. A mapping row here would make it
        // one button.
        const rows = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM field_promotion p
             JOIN document_type_field f
               ON f.document_type_field_id = p.document_type_field_id
            WHERE f.field_key = ANY($1::text[])`,
          [['tenant_id_number', 'guarantor_id_number']],
        );
        assert.equal(rows.rows[0]?.n, '0');
      });

      await t.test(
        'a lease naming no identifier is a correct result',
        async () => {
          findings = withId.filter(
            (finding) => finding.field_key !== 'tenant_id_number',
          );
          const second = await fileScan('idnum-lease-without');
          const before = await reads();
          const response = await asOperator(app, admin as SignedIn).inject({
            method: 'GET',
            url: `/documents/${second}/read`,
          });
          assert.equal(response.statusCode, 200, response.body.slice(0, 400));
          assert.doesNotMatch(response.body, /ת\.ז\./);
          assert.doesNotMatch(response.body, /שדה מזהה/);
          // Nothing was disclosed because nothing was captured, so nothing is logged.
          assert.equal(await reads(), before);
        },
      );
    } finally {
      await signOutAll(pool, STAFF_ID_DOMAIN);
      for (const hash of hashes) {
        await pool.query(
          `DELETE FROM audit_log WHERE action = 'evidence.read_identifier'
            AND subject_id IN (
              SELECT document_id::text FROM document WHERE file_hash = $1)`,
          [hash],
        );
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
      await pool.query(
        `DELETE FROM audit_log WHERE action LIKE 'evidence.%' AND subject_id IN (
           SELECT s.space_id::text FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY_ID, ADDRESS_ID],
      );
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY_ID, ADDRESS_ID],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_ID, ADDRESS_ID],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_ID, ADDRESS_ID],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_ID,
      ]);
      await app.close();
      await pool.end();
    }
  });
});
