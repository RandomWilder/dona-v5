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
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { inTransaction } from '../kernel/db.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import {
  createFakeOcrText,
  type OcrText,
  onlineOcrByteLimit,
} from '../kernel/ocr.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { upsertTenancy, upsertTermsProfile } from '../tenancy/contract.ts';
import {
  applyDocumentTypeCatalogue,
  columnTarget,
  documentFileHash,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const CITY = 'עיר מסמכים';
const ADDRESS = 'רחוב המסמכים 3';
const PROJECT_CODE = 'TEST-DOCS';
// **One bucket per suite, from 7.1.** This was `'dona-v5-test-docs'` in all eight evidence
// suites, while each suite's teardown deletes documents by `storage_uri LIKE 'gs://<BUCKET>/%'`
// — so every suite's cleanup deleted every other suite's rows, and `node --test` runs them at
// the same time. The failures that produced were real assertions on rows another process had
// just removed, and they moved from run to run, which is why they read as flakes. The comment
// on that teardown already claimed the bucket was this suite's alone; now it is.
const BUCKET = 'dona-v5-test-routes';
const AT = new Date('2026-09-07T09:00:00.000Z');

/** Stamp an address the opening screen can resolve. #244. */
async function approveCaptured(
  pool: Pool,
  actor: SignedIn,
  app: object,
  documentId: string,
  captured: Record<string, string>,
): Promise<void> {
  for (const [fieldKey, value] of Object.entries(captured)) {
    const declared: { rows: Array<{ id: string }> } = await pool.query(
      `SELECT f.document_type_field_id AS id
         FROM document_type_field f
         JOIN document_type t ON t.document_type_id = f.document_type_id
        WHERE t.type_key = 'lease' AND f.field_key = $1
        ORDER BY f.effective_from DESC
        LIMIT 1`,
      [fieldKey],
    );
    const fieldId: string = declared.rows[0]?.id ?? '';
    assert.ok(fieldId, fieldKey);
    const inserted: { rows: Array<{ id: string }> } = await pool.query(
      `INSERT INTO extracted_field (
         extracted_field_id, document_id, document_type_field_id, value,
         page, bbox, confidence, model, extracted_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3,
         1, '{"x":1,"y":2,"width":3,"height":4}'::jsonb, 0.99, 'fake', $4
       )
       RETURNING extracted_field_id AS id`,
      [documentId, fieldId, value, AT],
    );
    const extractedFieldId: string = inserted.rows[0]?.id ?? '';
    const client = asOperator(app as never, actor) as {
      inject: (
        options: object,
      ) => Promise<{ statusCode: number; body: string }>;
    };
    const stamped = await client.inject({
      method: 'POST',
      url: `/documents/filing/${documentId}/approve`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        csrf: actor.csrf,
        extracted_field_id: extractedFieldId,
      }).toString(),
    });
    assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
  }
}

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
  // `who` is this file's default session and `fields.csrf` overrides it — 6.9's suite signs in
  // as two roles of its own and hands the token in, so the default is read defensively rather
  // than assumed to have been assigned by a suite that may have skipped.
  for (const [name, value] of Object.entries({
    csrf: who?.csrf ?? '',
    ...fields,
  })) {
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

      await t.test(
        'the tab lands on a declaration, read out of the database',
        async () => {
          // **Slice 7.1.** The landing, and the three things it must get right: it is gated, it
          // shows a declaration rather than the alphabetically-first type's empty table, and every
          // row on it came from `document_type_field` rather than from a constant.
          const response = await as(lease).inject({
            method: 'GET',
            url: '/documents',
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /מה ייקרא מן הדף/);
          // `arnona` sorts first on `type_key` and declares no fields; the default is the first
          // type that declares one, which is the defect clicking the screen found.
          assert.match(response.body, /<option value="lease" selected>/);
          assert.match(response.body, />address</);
          assert.match(response.body, />start_date</);
          // A closed declaration is not on the screen. `address` was redeclared at 6.11, so the
          // 2026-09-07 row is closed and its hint — the one the new row replaced — must not show.
          assert.ok(!response.body.includes('רחוב ומספר, עיר'));
          // And the picker is the catalogue, not a list written into the view.
          assert.match(response.body, /value="handover_protocol"/);

          const empty = await as(lease).inject({
            method: 'GET',
            url: '/documents?type=arnona',
          });
          assert.equal(empty.statusCode, 200);
          assert.match(empty.body, /אין עדיין שדות מוצהרים/);
          assert.ok(!empty.body.includes('<table'));
        },
      );

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

      await t.test(
        'document screens return to the נכסים building page',
        async () => {
          const foundBuilding = await pool.query<{ building_id: string }>(
            `SELECT building_id FROM building
              WHERE city = $1 AND address_line = $2`,
            [CITY, ADDRESS],
          );
          const buildingId = foundBuilding.rows[0]?.building_id ?? '';
          assert.ok(buildingId);
          const inventory = `/estate/inventory/${buildingId}`;
          const oldPage = `/estate/buildings/${buildingId}`;

          const paths = (html: string): string[] =>
            [...html.matchAll(/href="([^"]*)"/g)].map((match) => {
              const href = (match[1] ?? '').replaceAll('&amp;', '&');
              return href.split(/[?#]/)[0] ?? href;
            });
          const assertNoOldBuilding = (
            html: string,
            location?: string,
          ): void => {
            for (const href of paths(html)) {
              assert.notEqual(href, oldPage);
            }
            if (location) {
              assert.notEqual(location.split(/[?#]/)[0], oldPage);
            }
          };

          const uploadPage = await as(lease).inject({
            method: 'GET',
            url: `/documents/new?unit=${unitId}`,
          });
          assert.equal(uploadPage.statusCode, 200);
          assert.match(
            uploadPage.body,
            new RegExp(`class="back" href="${inventory}"`),
          );
          assert.match(
            uploadPage.body,
            new RegExp(`href="${inventory}">ביטול`),
          );
          assertNoOldBuilding(uploadPage.body, uploadPage.headers.location);

          const blankBytes = pdfBytes(`return-blank-${Date.now()}`);
          hashes.push(documentFileHash(blankBytes));
          const filed = await as(blank).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'blank.pdf', bytes: blankBytes },
            ),
          });
          assert.equal(filed.statusCode, 200, filed.body.slice(0, 400));
          assert.match(filed.body, /המסמך נשמר/);
          assert.match(
            filed.body,
            new RegExp(`class="back" href="${inventory}"`),
          );
          assert.match(
            filed.body,
            new RegExp(`href="${inventory}">חזרה לבניין`),
          );
          assertNoOldBuilding(filed.body, filed.headers.location);

          const filedRow = await pool.query<{ document_id: string }>(
            'SELECT document_id FROM document WHERE file_hash = $1',
            [documentFileHash(blankBytes)],
          );
          const blankId = filedRow.rows[0]?.document_id ?? '';
          assert.ok(blankId);
          const read = await as(lease).inject({
            method: 'GET',
            url: `/documents/${blankId}/read`,
          });
          assert.equal(read.statusCode, 200, read.body.slice(0, 400));
          assert.match(
            read.body,
            new RegExp(`class="back" href="/documents/filing/${blankId}"`),
          );
          assertNoOldBuilding(read.body, read.headers.location);

          const unitFields = await as(lease).inject({
            method: 'GET',
            url: `/documents/${blankId}/fields`,
          });
          // #239: an unopened lease is approved on its filing workspace, not on the ledger.
          assert.equal(
            unitFields.statusCode,
            302,
            unitFields.body.slice(0, 400),
          );
          assert.equal(
            unitFields.headers.location,
            `/documents/filing/${blankId}`,
          );
          assertNoOldBuilding(unitFields.body, unitFields.headers.location);

          const protocol = appFor(specimen('handover-protocol.md'));
          extraApps.push(protocol);
          const protocolBytes = pdfBytes(`return-protocol-${Date.now()}`);
          hashes.push(documentFileHash(protocolBytes));
          const proposed = await as(protocol).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'handover_protocol', tenancy: '' },
              { filename: 'protocol.pdf', bytes: protocolBytes },
            ),
          });
          assert.equal(proposed.statusCode, 302, proposed.body.slice(0, 400));
          const seedUrl = String(proposed.headers.location);
          assert.match(seedUrl, /\/documents\/[0-9a-f-]{36}\/seed$/);
          assertNoOldBuilding('', seedUrl);
          const seed = await as(protocol).inject({
            method: 'GET',
            url: seedUrl,
          });
          assert.equal(seed.statusCode, 200, seed.body.slice(0, 400));
          assert.match(seed.body, /אישור מסירה/);
          assert.match(
            seed.body,
            new RegExp(`class="back" href="${inventory}"`),
          );
          assert.match(seed.body, new RegExp(`href="${inventory}">ביטול`));
          assertNoOldBuilding(seed.body, seed.headers.location);

          const seeded = await as(protocol).inject({
            method: 'POST',
            url: seedUrl,
            payload: new URLSearchParams({ csrf: who.csrf }).toString(),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          });
          assert.equal(seeded.statusCode, 200, seeded.body.slice(0, 400));
          assert.match(seeded.body, /המסירה נרשמה/);
          assert.match(
            seeded.body,
            new RegExp(`class="back" href="${inventory}"`),
          );
          assert.match(
            seeded.body,
            new RegExp(`href="${inventory}">חזרה לבניין`),
          );
          assertNoOldBuilding(seeded.body, seeded.headers.location);

          const buildingAndLeaseText =
            'מסירת הבניין מהיזם מערכות הבניין מועד המסירה: 2024-06-01 ' +
            'חוזה שכירות הדירה תקופת השכירות';
          const buildingPaper = appFor(buildingAndLeaseText);
          extraApps.push(buildingPaper);
          const buildingBytes = pdfBytes(`return-building-${Date.now()}`);
          hashes.push(documentFileHash(buildingBytes));
          const buildingFiled = await as(buildingPaper).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              {
                unit: unitId,
                type: 'building_handover_protocol',
                tenancy: '',
              },
              { filename: 'building.pdf', bytes: buildingBytes },
            ),
          });
          assert.equal(
            buildingFiled.statusCode,
            302,
            buildingFiled.body.slice(0, 400),
          );
          const buildingSeed = String(buildingFiled.headers.location);
          assert.match(buildingSeed, /\/seed$/);
          assertNoOldBuilding('', buildingSeed);
          const buildingDocumentId = /\/documents\/([0-9a-f-]{36})\/seed/.exec(
            buildingSeed,
          )?.[1];
          assert.ok(buildingDocumentId);
          const fields = await as(buildingPaper).inject({
            method: 'GET',
            url: `/documents/${buildingDocumentId}/fields`,
          });
          assert.equal(fields.statusCode, 200, fields.body.slice(0, 400));
          assert.match(
            fields.body,
            new RegExp(`class="back" href="${inventory}"`),
          );
          assert.doesNotMatch(fields.body, /href="\/estate\/units\//);
          assertNoOldBuilding(fields.body, fields.headers.location);
          const buildingRead = await as(buildingPaper).inject({
            method: 'GET',
            url: `/documents/${buildingDocumentId}/read`,
          });
          assert.equal(
            buildingRead.statusCode,
            200,
            buildingRead.body.slice(0, 400),
          );
          assert.match(
            buildingRead.body,
            new RegExp(`href="${inventory}">חזרה לבניין`),
          );
          assertNoOldBuilding(buildingRead.body, buildingRead.headers.location);

          const repeated = await as(buildingPaper).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'building.pdf', bytes: buildingBytes },
            ),
          });
          assert.equal(repeated.statusCode, 422, repeated.body.slice(0, 400));
          assert.match(repeated.body, /הקובץ הזה כבר מתויק/);
          assert.match(repeated.body, new RegExp(`href="${inventory}"`));
          assertNoOldBuilding(repeated.body, repeated.headers.location);

          // The cases below count this unit's documents, so these rows cannot
          // stay. An asset pointing at the protocol also blocks deleting it.
          const filedIds = [blankId, buildingDocumentId];
          const protocolId = /\/documents\/([0-9a-f-]{36})\/seed/.exec(
            seedUrl,
          )?.[1];
          if (protocolId) filedIds.push(protocolId);
          await pool.query(
            `DELETE FROM asset WHERE source_document_id = ANY($1::uuid[])`,
            [filedIds],
          );
          await pool.query(
            `DELETE FROM document_link WHERE document_id = ANY($1::uuid[])`,
            [filedIds],
          );
          await pool.query(
            `DELETE FROM document WHERE document_id = ANY($1::uuid[])`,
            [filedIds],
          );
        },
      );

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
        // #237: the flat page is one of the doors, and a lease through it is stored unassigned. The
        // flat is a preselection for פתיחת טיוטה, not a link.
        assert.equal(response.statusCode, 302);
        assert.match(
          response.headers.location ?? '',
          /\/documents\/filing\/[0-9a-f-]{36}$/,
        );
        const workspace = await as(lease).inject({
          method: 'GET',
          url: String(response.headers.location),
        });
        assert.equal(workspace.statusCode, 200);
        assert.doesNotMatch(workspace.body, /כהן/);

        const rows = await pool.query<{
          file_hash: string;
          storage_uri: string;
          uploaded_by: string | null;
          links: string;
        }>(
          `SELECT d.file_hash, d.storage_uri, d.uploaded_by,
                  (SELECT count(*) FROM document_link l
                    WHERE l.document_id = d.document_id)::text AS links
             FROM document d
            WHERE d.file_hash = $1`,
          [documentFileHash(pdfBytes('lease one'))],
        );
        assert.equal(rows.rows.length, 1);
        const filed = rows.rows[0];
        assert.ok(filed);
        hashes.push(filed.file_hash);
        assert.equal(filed.uploaded_by, who.staffAccountId);
        assert.equal(filed.links, '0');
        assert.match(
          filed.storage_uri,
          new RegExp(`^gs://${BUCKET}/unassigned/lease/[0-9a-f]{64}\\.pdf$`),
        );
        assert.doesNotMatch(filed.storage_uri, /כהן/);
        assert.doesNotMatch(filed.storage_uri, new RegExp(unitId));

        const opening = await as(lease).inject({
          method: 'GET',
          url: `${String(response.headers.location)}/open`,
        });
        assert.equal(opening.statusCode, 200, opening.body.slice(0, 400));
        assert.match(
          opening.body,
          new RegExp(`name="unit" value="${unitId}"`),
          'the flat the door stood on is preselected',
        );
      });

      await t.test(
        'an unopened lease is on neither the unit page nor in search',
        async () => {
          // #237: which flat a document is about is its path, or its `SUBJECT` link once the draft
          // opens. An unopened lease has neither, so nothing that lists a flat's papers reaches it.
          const unitPage = await as(lease).inject({
            method: 'GET',
            url: `/estate/units/${unitId}`,
          });
          assert.equal(unitPage.statusCode, 200);
          assert.doesNotMatch(
            unitPage.body,
            /\/documents\/[0-9a-f-]{36}\/read/,
          );
          assert.doesNotMatch(unitPage.body, /X-Goog-Expires=/);

          const found = await as(lease).inject({
            method: 'GET',
            url: `/estate/search?q=${encodeURIComponent('בניין מסמכים')}`,
          });
          assert.equal(found.statusCode, 200);
          assert.doesNotMatch(found.body, /\/documents\/[0-9a-f-]{36}\/read/);
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
          // The form comes back with what was chosen still chosen, and names every requirement
          // that was checked — **slice 7.1**, the director's comment. An ארנונה bill carries none
          // of the lease's three, so all three come back as `לא נמצא` and none as `נמצא`; the
          // mixed case, where the title matched and a body term did not, is asserted on the
          // renderer in tests/ui/tokens.test.ts, which is where the screen's own bytes are read.
          assert.match(response.body, /value="lease" selected/);
          assert.match(response.body, /class="chip term-missing"/);
          assert.equal(
            response.body.match(/class="chip term-missing"/g)?.length,
            3,
          );
          assert.ok(!response.body.includes('class="chip term-found"'));
          const count = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM document_link WHERE entity_id = $1`,
            [unitId],
          );
          assert.equal(count.rows[0]?.n, '0');
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
          assert.equal(count.rows[0]?.n, '0');
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
              WHERE d.file_hash = $1 AND d.verification_verdict = 'unverified'`,
            [documentFileHash(pdfBytes('empty layer'))],
          );
          const filed = rows.rows[0];
          assert.ok(filed);
          hashes.push(filed.file_hash);
        },
      );

      await t.test(
        'GET /documents/:id/read shows the page text, not word boxes',
        async () => {
          const rows = await pool.query<{ document_id: string }>(
            `SELECT d.document_id FROM document d
              WHERE d.file_hash = $1 AND d.verification_verdict = 'verified'`,
            [documentFileHash(pdfBytes('lease one'))],
          );
          const documentId = rows.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const response = await as(lease).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /מילים על הדף/);
          assert.doesNotMatch(response.body, /word-box/);
          assert.doesNotMatch(response.body, /field-box/);
          assert.doesNotMatch(response.body, /<img /);
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
        'GET /documents/:id/read a second time does not re-read the bytes',
        async () => {
          const bytes = pdfBytes(`stored-passages-${Date.now()}`);
          hashes.push(documentFileHash(bytes));
          let reads = 0;
          const inner = createFakePdfText([
            specimen('lease-standard.md'),
            'PAGE-TWO-ONLY-WORD',
          ]);
          const stored = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects,
            pdf: {
              pages: async (file) => {
                reads += 1;
                return inner.pages(file);
              },
              describe: () => inner.describe(),
            },
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            bucket: BUCKET,
          });
          extraApps.push(stored);
          const posted = await as(stored).inject({
            method: 'POST',
            url: '/documents',
            ...upload(
              { unit: unitId, type: 'lease', tenancy: '' },
              { filename: 'stored.pdf', bytes },
            ),
          });
          assert.equal(posted.statusCode, 302, posted.body.slice(0, 400));
          const afterUpload = reads;
          assert.equal(afterUpload, 1);
          const rows = await pool.query<{ document_id: string }>(
            'SELECT document_id FROM document WHERE file_hash = $1',
            [documentFileHash(bytes)],
          );
          const documentId = rows.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const first = await as(stored).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(first.statusCode, 200, first.body.slice(0, 400));
          assert.match(first.body, /הקריאה שנשמרה/);
          const second = await as(stored).inject({
            method: 'GET',
            url: `/documents/${documentId}/read?page=2`,
          });
          assert.equal(second.statusCode, 200);
          assert.match(second.body, /PAGE-TWO-ONLY-WORD/);
          assert.equal(reads, afterUpload);
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
            `SELECT d.file_hash FROM document d WHERE d.file_hash = $1`,
            [documentFileHash(pngBytes('timeout'))],
          );
          const hash = rows.rows[0]?.file_hash;
          assert.ok(hash);
          hashes.push(hash);
        },
      );

      await t.test(
        'OCRs a scan on the same request and offers the reading',
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
            `SELECT d.file_hash FROM document d WHERE d.file_hash = $1`,
            [documentFileHash(pngBytes(`ocr-overlay-${unitId}`))],
          );
          const postedHash = posted.rows[0]?.file_hash;
          assert.ok(postedHash);
          hashes.push(postedHash);
          const location = String(response.headers.location ?? '');
          const documentId =
            location.match(/\/documents\/filing\/([0-9a-f-]{36})$/)?.[1] ?? '';
          assert.ok(documentId);
          const overlay = await as(app).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(overlay.statusCode, 200, overlay.body.slice(0, 400));
          assert.doesNotMatch(overlay.body, /word-box/);
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
      await pool
        .query(
          `DELETE FROM asset WHERE source_document_id IN (
             SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
          [`gs://${BUCKET}/%`],
        )
        .catch(() => {});
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
          `DELETE FROM asset WHERE space_id IN (
             SELECT space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY, ADDRESS],
        )
        .catch(() => {});
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
      pdf: createFakePdfText(['נספח לחוזה השכירות תקופת השכירות']),
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
        await inTransaction(pool, async (db) => {
          await db.query("SELECT set_config('dona.approving', 'on', true)");
          await db.query(
            `UPDATE extracted_field
                SET approved_value = NULL, approved_by = NULL, approved_at = NULL
              WHERE document_id IN
                (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
          await db.query(
            `DELETE FROM extracted_field WHERE document_id IN
               (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
        });
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
    // **Slice 6.11.** No property label anywhere: the only address on this paper is the landlord's
    // own, written the way every standard form writes one, and printed above the property clause.
    const landlord = appFor(
      `המשכיר: אבי לוי ת.ז 012345678 מרחוב ${ADDRESS_A12}, ${CITY_A12}, דירה 12A\n${specimen(
        'lease-standard.md',
      )}`,
    );
    const apps = [here, elsewhere, ambiguous, landlord];
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

      // **#237.** A lease is stored unassigned at every door, and its flat is chosen on פתיחת טיוטה.
      // What A12 used to decide at upload — one flat, none, several — is now what the opening
      // proposes. `documentsHere` still counts this building's links, and it never moves: upload
      // links nothing.
      const stored = async (bytes: Buffer): Promise<string> => {
        const rows = await pool.query<{
          document_id: string;
          storage_uri: string;
          links: string;
        }>(
          `SELECT d.document_id, d.storage_uri,
                  (SELECT count(*) FROM document_link l
                    WHERE l.document_id = d.document_id)::text AS links
             FROM document d WHERE d.file_hash = $1`,
          [documentFileHash(bytes)],
        );
        const row = rows.rows[0];
        assert.ok(row, 'the lease is stored');
        hashes.push(documentFileHash(bytes));
        assert.match(
          row.storage_uri,
          new RegExp(`^gs://${BUCKET}/unassigned/lease/[0-9a-f]{64}\\.pdf$`),
        );
        assert.equal(row.links, '0');
        return row.document_id;
      };
      const opening = async (
        app: (typeof apps)[number],
        documentId: string,
      ): Promise<string> => {
        const response = await as(app).inject({
          method: 'GET',
          url: `/documents/filing/${documentId}/open`,
        });
        assert.equal(response.statusCode, 200, response.body.slice(0, 400));
        return response.body;
      };

      await t.test(
        'a lease naming רקפת 12 דירה 12A is stored unassigned, and opens with 12A preselected',
        async () => {
          const before = await documentsHere();
          const bytes = pdfBytes('a12 one');
          const response = await as(here).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload({ type: 'lease' }, { filename: 'שכירות לוי.pdf', bytes }),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.match(
            response.headers.location ?? '',
            /\/documents\/filing\/[0-9a-f-]{36}$/,
          );
          assert.equal(await documentsHere(), before);
          const documentId = await stored(bytes);
          await approveCaptured(pool, who, here, documentId, {
            address: `${ADDRESS_A12}, ${CITY_A12}`,
            apartment_number: '12A',
          });
          const body = await opening(here, documentId);
          assert.match(body, new RegExp(`name="unit" value="${unitA}"`));
          assert.doesNotMatch(body, new RegExp(`value="${unitB}"`));
          // The filename carried a household name. It reached neither the path nor the screen.
          assert.doesNotMatch(body, /לוי/);
        },
      );

      await t.test(
        'an address in no building is stored, and opening says so and offers a search',
        async () => {
          const before = await documentsHere();
          const bytes = pdfBytes('a12 elsewhere');
          const response = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload({ type: 'lease' }, { filename: 'unknown.pdf', bytes }),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal(await documentsHere(), before);
          const documentId = await stored(bytes);
          await approveCaptured(pool, who, elsewhere, documentId, {
            address: 'אלמוג 5, עיר שאיננה',
            apartment_number: '3',
          });
          const body = await opening(elsewhere, documentId);
          // What was read, said back — so the choice is one an operator can act on.
          assert.match(body, /אלמוג 5/);
          assert.match(body, /אינה בתיק/);
          assert.match(body, /חיפוש דירה/);
        },
      );

      await t.test(
        'a landlord address is not the property, and opening preselects nothing',
        async () => {
          // **Slice 6.11, at the route and not only at the reader.** This paper carries no property
          // label at all: its only address is the party line a standard form prints above the
          // property clause, and `רחוב` matched inside `מרחוב`. Before 6.11 it filed against 12A;
          // since #237 the danger is the same flat arriving preselected.
          const before = await documentsHere();
          const bytes = pdfBytes('a12 landlord');
          const response = await as(landlord).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload({ type: 'lease' }, { filename: 'landlord.pdf', bytes }),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal(await documentsHere(), before);
          const body = await opening(landlord, await stored(bytes));
          assert.doesNotMatch(body, new RegExp(`value="${unitA}"`));
          assert.match(body, /הכתובת טרם אושרה/);
          assert.match(body, /חיפוש דירה/);
        },
      );

      await t.test(
        'two flats at the address and neither is the one named — opening offers both',
        async () => {
          const before = await documentsHere();
          const bytes = pdfBytes('a12 ambiguous');
          const response = await as(ambiguous).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload({ type: 'lease' }, { filename: 'nine.pdf', bytes }),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal(await documentsHere(), before);
          const documentId = await stored(bytes);
          await approveCaptured(pool, who, ambiguous, documentId, {
            address: `${ADDRESS_A12}, ${CITY_A12}`,
            apartment_number: '9',
          });
          const body = await opening(ambiguous, documentId);
          assert.match(body, new RegExp(`value="${unitA}"`));
          assert.match(body, new RegExp(`value="${unitB}"`));
          assert.doesNotMatch(body, / required checked/);
        },
      );

      await t.test(
        'a flat the door carried is a preselection, and nothing is linked',
        async () => {
          const before = await documentsHere();
          const bytes = pdfBytes('a12 chosen');
          const response = await as(ambiguous).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease', unit: unitB },
              { filename: 'nine.pdf', bytes },
            ),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal(await documentsHere(), before);
          const documentId = await stored(bytes);
          await approveCaptured(pool, who, ambiguous, documentId, {
            address: `${ADDRESS_A12}, ${CITY_A12}`,
            apartment_number: '9',
          });
          const body = await opening(ambiguous, documentId);
          assert.match(body, new RegExp(`value="${unitB}" required checked`));
        },
      );

      await t.test(
        'the same bytes again are refused with a link to the document, and write nothing',
        async () => {
          // **Slice 6.10, carried.** One file is one document. An unassigned lease has no flat to
          // name, so the refusal names the document itself.
          const before = await documentsHere();
          const putsBefore = puts;
          const bytes = pdfBytes('a12 chosen');
          const found = await pool.query<{ document_id: string }>(
            'SELECT document_id FROM document WHERE file_hash = $1',
            [documentFileHash(bytes)],
          );
          const documentId = found.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const response = await as(ambiguous).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease', unit: unitA },
              { filename: 'nine.pdf', bytes },
            ),
          });
          assert.equal(response.statusCode, 422, response.body.slice(0, 400));
          assert.match(
            response.body,
            new RegExp(`/documents/filing/${documentId}"`),
          );
          assert.match(response.body, /לא נשמר דבר/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore, 'no object was written');

          // And the second door did not move the first one's preselection.
          const body = await opening(ambiguous, documentId);
          assert.match(body, new RegExp(`value="${unitB}" required checked`));
          assert.doesNotMatch(
            body,
            new RegExp(`value="${unitA}" required checked`),
          );
          // The old confirm door sends an unopened lease to its workspace rather than a 404.
          const confirm = await as(ambiguous).inject({
            method: 'GET',
            url: `/documents/${documentId}/tenancy`,
          });
          assert.equal(confirm.statusCode, 302);
          assert.equal(
            confirm.headers.location,
            `/documents/filing/${documentId}`,
          );
        },
      );

      await t.test(
        'a file too large for the reader is refused with a sentence, and files nothing',
        async () => {
          // **Slice 6.8, and it was red first.** A file above `onlineOcrByteLimit` cannot be read
          // online at any page count: the bound is on the request and the whole file rides in every
          // one of them. Until 6.8 the row went in `unverified` — a verdict that means *nobody
          // could read this*, used for a file nobody looked at. It is a refusal now, on a screen
          // that says how large the file was and why that mattered, and the call is not spent
          // finding out. (A *long* file is a different thing and is read in part: see
          // `intake.test.ts`.)
          const before = await documentsHere();
          const putsBefore = puts;
          let calls = 0;
          const long = buildApp({
            pool,
            version: '9.9.9-test',
            clock: fixedClock(AT),
            objects: counted,
            pdf: createFakePdfText(['סריקה גדולה ללא מילות הטופס']),
            ocr: {
              describe: () => 'fake',
              pages: async () => {
                calls += 1;
                return { pages: [] };
              },
            },
            bucket: BUCKET,
          });
          const response = await as(long).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { csrf: (who as SignedIn).csrf, type: 'lease' },
              {
                filename: 'huge.pdf',
                bytes: Buffer.concat([
                  pdfBytes('a12 huge scan'),
                  Buffer.alloc(onlineOcrByteLimit, 0x20),
                ]),
              },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /גדול מכדי/);
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
        await inTransaction(pool, async (db) => {
          await db.query("SELECT set_config('dona.approving', 'on', true)");
          await db.query(
            `UPDATE extracted_field
                SET approved_value = NULL, approved_by = NULL, approved_at = NULL
              WHERE document_id IN
                (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
          await db.query(
            `DELETE FROM extracted_field WHERE document_id IN
               (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
        });
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
          /\/documents\/filing\/([0-9a-f-]{36})$/,
        )?.[1] ?? '';
      assert.ok(documentId, 'a lease goes to its filing workspace');
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
        assert.equal(columnTarget('lease', 'tenant_id_number'), null);
        assert.equal(columnTarget('lease', 'guarantor_id_number'), null);
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

/**
 * **Slice 6.9, flow A12. The refusal that offers to create.**
 *
 * Until this slice an operator holding the right paper for an address in nobody's portfolio was
 * told only that it could not be placed — a correct answer and a dead end, which is what the
 * week-6 demo walked into. The director's ruling of 14 Sep overrules A12's *does not create*:
 * **creating is still an admin's act, and it is offered from here.**
 *
 * Two stances against the identical request, because that is the whole of the design: `estate.write`
 * is ADMIN-only and `documents.write` is an operator's ordinary day, so the same 422 is two screens.
 * A door an operator may see and may not walk through is the refusal-after-typing A11 refused to
 * build, and this suite is what says this slice did not build one either.
 */
describe('evidence · A12 offers to create, to an admin', () => {
  it('walks refusal → building → flat → filed, and shows an operator none of it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const DOMAIN_69 = 'evidence-create.test';
    const CITY_69 = 'עיר היצירה';
    const HELD = 'אורן 7';
    const UNHELD = 'דקל 9';
    const PROJECT_69 = 'TEST-CREATE';
    const leasing = (address: string) =>
      `כתובת המושכר: ${address}\n${specimen('lease-standard.md')}`;

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
    // An address this estate does not hold at all — no building, no flat. The create offer's case.
    const unheld = appFor(leasing(`${UNHELD}, ${CITY_69}, דירה 4`));
    // The building is held and the flat is not: 6.3's `רקפת 12, דירה 999`, which is the commoner of
    // the two and gets the narrower offer.
    const flatOnly = appFor(leasing(`${HELD}, ${CITY_69}, דירה 12`));
    const apps = [unheld, flatOnly];
    let admin: SignedIn | null = null;
    let operator: SignedIn | null = null;
    const hashes: string[] = [];

    // A count of every document races the other suites, which commit their own
    // rows into the same table. This walk only needs to know that its own file
    // was not stored.
    const documentsFor = async (bytes: Buffer): Promise<string> =>
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM document WHERE file_hash = $1',
          [documentFileHash(bytes)],
        )
      ).rows[0]?.n ?? '0';

    try {
      await signOutAll(pool, DOMAIN_69);
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      admin = await signIn(pool, fixedClock(AT), {
        email: `admin@${DOMAIN_69}`,
        role: 'ADMIN',
      });
      operator = await signIn(pool, fixedClock(AT), {
        email: `ops@${DOMAIN_69}`,
        role: 'OPERATOR',
      });
      await importEstate(pool, {
        projects: [
          {
            name: 'מכרז יצירה',
            projectCode: PROJECT_69,
            tenderRef: null,
            status: 'ACTIVE',
          },
        ],
        buildings: [
          {
            name: 'בניין אורן 7',
            addressLine: HELD,
            city: CITY_69,
            projectCode: PROJECT_69,
            handoverDate: '2025-03-01',
            warrantyEndDate: '2027-03-01',
            status: 'ACTIVE',
            spaces: [
              { kind: 'UNIT', name: 'דירה 3', floor: '1', accessNote: null },
            ],
            units: [
              {
                spaceName: 'דירה 3',
                unitNumber: '3',
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

      // The file's own `as`, but bound to a session this suite signed in rather than to the
      // module-level one: two stances against one request is the whole design here.
      const asRole = <T extends { inject: (o: never) => unknown }>(
        app: T,
        actor: SignedIn,
      ): T => asOperator(app as never, actor) as unknown as T;

      // **#237.** A lease is stored first and its flat is chosen at פתיחת טיוטה, so the create offer
      // moved from A12's refusal to the opening screen, under the same permission. The walk from
      // there to a new flat is `lease-filing.test.ts`'s; this suite keeps the two stances.
      const store = async (
        app: (typeof apps)[number],
        who: SignedIn,
        marker: string,
      ): Promise<string> => {
        const bytes = pdfBytes(`6.9 ${marker}`);
        const response = (await asRole(app, who).inject({
          method: 'POST',
          url: '/documents/intake',
          ...upload(
            { type: 'lease', csrf: who.csrf },
            { filename: 'create.pdf', bytes },
          ),
        } as never)) as {
          statusCode: number;
          body: string;
          headers: Record<string, string>;
        };
        assert.equal(response.statusCode, 302, response.body.slice(0, 400));
        hashes.push(documentFileHash(bytes));
        assert.equal(await documentsFor(bytes), '1');
        return (
          /\/documents\/filing\/([0-9a-f-]{36})$/.exec(
            String(response.headers.location ?? ''),
          )?.[1] ?? ''
        );
      };
      const open = async (
        app: (typeof apps)[number],
        who: SignedIn,
        documentId: string,
      ): Promise<string> => {
        const response = (await asRole(app, who).inject({
          method: 'GET',
          url: `/documents/filing/${documentId}/open`,
        } as never)) as { statusCode: number; body: string };
        assert.equal(response.statusCode, 200, response.body.slice(0, 400));
        return response.body;
      };

      await t.test(
        'an OPERATOR sees the search box and no create control',
        async () => {
          const who = operator as SignedIn;
          const body = await open(unheld, who, await store(unheld, who, 'ops'));
          assert.match(body, /חיפוש דירה/);
          assert.doesNotMatch(body, /action="\/documents\/filing\/place"/);
          assert.doesNotMatch(body, /יצירת הבניין/);
        },
      );

      await t.test(
        'an ADMIN is offered the building and the flat, prefilled',
        async () => {
          const who = admin as SignedIn;
          const documentId = await store(unheld, who, 'admin');
          await approveCaptured(pool, who, unheld, documentId, {
            address: `${UNHELD}, ${CITY_69}`,
            apartment_number: '4',
          });
          const body = await open(unheld, who, documentId);
          assert.match(body, /action="\/documents\/filing\/place"/);
          assert.match(body, new RegExp(`value="${UNHELD}"`));
          assert.match(body, new RegExp(`value="${CITY_69}"`));
          assert.match(
            body,
            new RegExp(`name="document" value="${documentId}"`),
          );
        },
      );

      await t.test(
        'the building is held and only the flat is offered',
        async () => {
          const who = admin as SignedIn;
          const documentId = await store(flatOnly, who, 'flat only');
          await approveCaptured(pool, who, flatOnly, documentId, {
            address: `${HELD}, ${CITY_69}`,
            apartment_number: '12',
          });
          const body = await open(flatOnly, who, documentId);
          assert.match(body, /הבניין נמצא בתיק, והדירה לא/);
          assert.match(body, /name="building"/);
        },
      );
    } finally {
      for (const actor of [admin, operator].filter(Boolean) as SignedIn[]) {
        await pool
          .query(
            `DELETE FROM audit_log
              WHERE action = 'evidence.intake_unresolved' AND actor_id = $1`,
            [actor.staffAccountId],
          )
          .catch(() => {});
      }
      await signOutAll(pool, DOMAIN_69);
      for (const hash of hashes) {
        await inTransaction(pool, async (db) => {
          await db.query("SELECT set_config('dona.approving', 'on', true)");
          await db.query(
            `UPDATE extracted_field
                SET approved_value = NULL, approved_by = NULL, approved_at = NULL
              WHERE document_id IN
                (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
          await db.query(
            `DELETE FROM extracted_field WHERE document_id IN
               (SELECT document_id FROM document WHERE file_hash = $1)`,
            [hash],
          );
        });
        await pool.query(
          `DELETE FROM document_link WHERE document_id IN
             (SELECT document_id FROM document WHERE file_hash = $1)`,
          [hash],
        );
        await pool.query('DELETE FROM document WHERE file_hash = $1', [hash]);
      }
      for (const address of [HELD, UNHELD]) {
        await pool.query(
          `DELETE FROM unit WHERE unit_id IN (
             SELECT space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_69, address],
        );
        await pool.query(
          `DELETE FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
          [CITY_69, address],
        );
        await pool.query(
          'DELETE FROM building WHERE city = $1 AND address_line = $2',
          [CITY_69, address],
        );
      }
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_69,
      ]);
      for (const app of apps) {
        await app.close();
      }
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// **The declaration editor, driven the way an administrator drives it.** Slice 7.2, flow A14.
//
// Foundation rule 8 says a field is a row and costs no deploy. Everything below is that claim
// posted through a real form: the write, the correction, the retire, and the refusal the slice
// exists to make — a role that may not declare.
//
// **The role refusal is here and not in `tests/policy/`.** `tests/policy/` builds no application —
// its cases are SQL and pure functions — and every role refusal in this repository is asserted at
// the route, against the stance the composition root actually registered
// (`src/estate/routes.test.ts`, `src/staff/routes.test.ts`, `src/settings.test.ts`).
//
// **There was a second refusal here, and it is gone.** A declaration naming money was refused by a
// vocabulary guard until 15 Sep 2026; foundation rule 2 is retired
// (`docs/decisions/ADR-0008-money-is-ordinary-data.md`) and this suite's money case went with the
// policy case that carried the vocabulary. Nothing replaces either.
//
// **It was red first.** The route was registered with `documents.write` — which an OPERATOR holds —
// and this suite's refusal case failed with 303 before the stance became `settings.write`. The
// output is in `tasks/evidence/7.2.md`.
// ---------------------------------------------------------------------------------------------
const DECLARE_DOMAIN = 'evidence-declare.test';
const DECLARE_TYPE = 'a14_editor_type';

describe('evidence · an administrator declares a field (7.2, A14)', () => {
  it('declares, corrects, retires — and refuses a role', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    // Two days, because a correction is a new row at a new date and one clock cannot show that.
    const DAY_ONE = new Date('2026-09-20T06:00:00.000Z');
    const DAY_TWO = new Date('2026-09-21T06:00:00.000Z');
    const appOn = (at: Date) =>
      buildApp({
        pool,
        version: '9.9.9-test',
        clock: fixedClock(at),
        objects: createMemoryStore(),
        pdf: createFakePdfText(['']),
        bucket: BUCKET,
      });
    const dayOne = appOn(DAY_ONE);
    const dayTwo = appOn(DAY_TWO);

    /** Every declaration of the suite's field, oldest first — the rows, not the screen's view. */
    const rows = async (): Promise<
      {
        label_he: string;
        effective_from: string;
        effective_to: string | null;
      }[]
    > => {
      const result = await pool.query<{
        label_he: string;
        effective_from: string;
        effective_to: string | null;
      }>(
        `SELECT f.label_he,
                to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from,
                to_char(f.effective_to, 'YYYY-MM-DD') AS effective_to
           FROM document_type_field f
           JOIN document_type t ON t.document_type_id = f.document_type_id
          WHERE t.type_key = $1
          ORDER BY f.effective_from`,
        [DECLARE_TYPE],
      );
      return result.rows;
    };
    const post = (
      app: ReturnType<typeof buildApp>,
      session: SignedIn,
      form: Record<string, string>,
    ) =>
      app.inject({
        method: 'POST',
        url: `/documents/types/${DECLARE_TYPE}/fields`,
        payload: new URLSearchParams({
          csrf: session.csrf,
          ...form,
        }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: session.cookie,
        },
      });

    // **A session per day, and this cost a run to find.** `SESSION_ABSOLUTE_MS` is twelve hours
    // (5.1), so a session minted on the 20th is expired on the 21st and the guard answers a 303
    // redirect to sign-in — which reads exactly like a route that accepted the post. Every refusal
    // below was "passing" as a 303 until each day got its own. `signIn` upserts the account on its
    // email, so these are two sessions of **one** operator and the audit count at the end is still
    // one actor's.
    const admins: Record<string, SignedIn> = {};
    let operator: SignedIn | null = null;
    const adminOn = async (at: Date): Promise<SignedIn> => {
      const key = at.toISOString();
      const held = admins[key];
      if (held) return held;
      const fresh = await signIn(pool, fixedClock(at), {
        email: `admin@${DECLARE_DOMAIN}`,
        role: 'ADMIN',
      });
      admins[key] = fresh;
      return fresh;
    };
    let admin: SignedIn | null = null;
    let adminTwo: SignedIn | null = null;
    try {
      await signOutAll(pool, DECLARE_DOMAIN);
      admin = await adminOn(DAY_ONE);
      adminTwo = await adminOn(DAY_TWO);
      operator = await signIn(pool, fixedClock(DAY_TWO), {
        email: `ops@${DECLARE_DOMAIN}`,
        role: 'OPERATOR',
      });
      await pool.query(
        `INSERT INTO document_type (document_type_id, type_key, label_he, label_en,
                                    verification_terms, is_active)
         VALUES (gen_random_uuid(), $1, 'סוג לעורך', null, null, true)
         ON CONFLICT (type_key) DO NOTHING`,
        [DECLARE_TYPE],
      );
      await pool.query(
        `DELETE FROM document_type_field WHERE document_type_id =
           (SELECT document_type_id FROM document_type WHERE type_key = $1)`,
        [DECLARE_TYPE],
      );

      await t.test(
        'an ADMIN declares a field, and the screen shows it',
        async () => {
          const declared = await post(dayOne, admin as SignedIn, {
            action: 'declare',
            field_key: 'city',
            label_he: 'עיר',
            value_type: 'TEXT',
            extraction_hint: 'עיר בלבד, לא הרחוב',
          });
          assert.equal(declared.statusCode, 303);
          assert.match(
            String(declared.headers.location),
            /\/documents\?type=a14_editor_type&saved=declared/,
          );
          const screen = await dayOne.inject({
            method: 'GET',
            url: `/documents?type=${DECLARE_TYPE}`,
            headers: { cookie: (admin as SignedIn).cookie },
          });
          assert.equal(screen.statusCode, 200);
          assert.match(screen.body, /city/);
          assert.match(screen.body, /עיר בלבד, לא הרחוב/);
          // The editor is on the page for this role, which is the other half of the refusal below.
          assert.match(screen.body, /אדמין בלבד/);
          assert.equal((await rows()).length, 1);
        },
      );

      await t.test(
        'the same field again on the same day is a conflict',
        async () => {
          const again = await post(dayOne, admin as SignedIn, {
            action: 'declare',
            field_key: 'city',
            label_he: 'עיר אחרת',
            value_type: 'TEXT',
          });
          assert.equal(again.statusCode, 409);
          assert.equal(again.json().code, 'conflict');
          const only = await rows();
          assert.equal(only.length, 1);
          assert.equal(
            only[0]?.label_he,
            'עיר',
            'the first declaration is untouched',
          );
        },
      );

      await t.test(
        'a correction the next day leaves two rows, and the old one still says what it said',
        async () => {
          const corrected = await post(dayTwo, adminTwo as SignedIn, {
            action: 'declare',
            field_key: 'city',
            label_he: 'עיר המושכר',
            value_type: 'TEXT',
            is_required: 'true',
            extraction_hint: 'עיר בלבד, לא הרחוב ולא המיקוד',
          });
          assert.equal(corrected.statusCode, 303);
          const both = await rows();
          assert.equal(
            both.length,
            2,
            'a correction is a new row, never an edit',
          );
          assert.equal(both[0]?.label_he, 'עיר');
          assert.equal(both[0]?.effective_from, '2026-09-20');
          // Closed the day *before* the successor opens, or both would govern the 21st.
          assert.equal(both[0]?.effective_to, '2026-09-20');
          assert.equal(both[1]?.label_he, 'עיר המושכר');
          assert.equal(both[1]?.effective_from, '2026-09-21');
          assert.equal(both[1]?.effective_to, null);

          const screen = await dayTwo.inject({
            method: 'GET',
            url: `/documents?type=${DECLARE_TYPE}`,
            headers: { cookie: (adminTwo as SignedIn).cookie },
          });
          // One row on the screen, not two: the superseded declaration is closed, and a closed
          // declaration is not shown (7.1's rule, and the date parameter doing its job).
          assert.equal(screen.body.split('>city<').length - 1, 1);
          assert.match(screen.body, /עיר המושכר/);
        },
      );

      await t.test('an OPERATOR is refused, and writes nothing', async () => {
        const before = (await rows()).length;
        const refused = await post(dayTwo, operator as SignedIn, {
          action: 'declare',
          field_key: 'floor_area',
          label_he: 'שטח',
          value_type: 'NUMBER',
        });
        assert.equal(refused.statusCode, 403);
        assert.equal(refused.json().code, 'not_allowed');
        assert.equal(refused.json().message, 'not_allowed');
        assert.equal((await rows()).length, before, 'nothing was declared');
        // And the form is not on their page at all, which is why there is no refusal screen.
        const screen = await dayTwo.inject({
          method: 'GET',
          url: `/documents?type=${DECLARE_TYPE}`,
          headers: { cookie: (operator as SignedIn).cookie },
        });
        assert.equal(screen.statusCode, 200);
        assert.doesNotMatch(screen.body, /אדמין בלבד/);
        assert.doesNotMatch(screen.body, /הוצאה משימוש/);
      });

      await t.test(
        'a post with no token is refused, and writes nothing',
        async () => {
          const before = (await rows()).length;
          const refused = await dayTwo.inject({
            method: 'POST',
            url: `/documents/types/${DECLARE_TYPE}/fields`,
            payload: new URLSearchParams({
              csrf: '',
              action: 'declare',
              field_key: 'forged',
              label_he: 'מזויף',
              value_type: 'TEXT',
            }).toString(),
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              cookie: (adminTwo as SignedIn).cookie,
            },
          });
          assert.equal(refused.statusCode, 403);
          assert.equal(refused.json().code, 'not_allowed');
          assert.equal((await rows()).length, before);
        },
      );

      await t.test('retiring closes the row and deletes nothing', async () => {
        const retired = await post(dayTwo, adminTwo as SignedIn, {
          action: 'retire',
          field_key: 'city',
        });
        // The live declaration opened today, so retiring it today would invert its own window.
        assert.equal(retired.statusCode, 409);
        const DAY_THREE = new Date('2026-09-22T06:00:00.000Z');
        const nextDay = appOn(DAY_THREE);
        const adminThree = await adminOn(DAY_THREE);
        const gone = await post(nextDay, adminThree, {
          action: 'retire',
          field_key: 'city',
        });
        assert.equal(gone.statusCode, 303);
        const kept = await rows();
        assert.equal(kept.length, 2, 'deactivate, never delete');
        assert.equal(kept[1]?.effective_to, '2026-09-21');
        const screen = await nextDay.inject({
          method: 'GET',
          url: `/documents?type=${DECLARE_TYPE}`,
          headers: { cookie: adminThree.cookie },
        });
        assert.doesNotMatch(screen.body, />city</);
        await nextDay.close();
      });

      await t.test('every declaration left an audit line', async () => {
        const { rows: lines } = await pool.query<{ action: string; n: string }>(
          `SELECT action, count(*)::text AS n FROM audit_log
            WHERE actor_id = $1 AND action IN ('evidence.declare_field', 'evidence.retire_field')
            GROUP BY action ORDER BY action`,
          [(admin as SignedIn).staffAccountId],
        );
        // Two declares that succeeded plus one that conflicted; one retire that conflicted plus one
        // that closed the row. `audit.around` records both outcomes. It was five declares until the
        // money refusals went with foundation rule 2 (ADR-0008).
        assert.equal(
          lines.find((line) => line.action === 'evidence.declare_field')?.n,
          '3',
        );
        assert.equal(
          lines.find((line) => line.action === 'evidence.retire_field')?.n,
          '2',
        );
      });
    } finally {
      for (const account of [admin, operator]) {
        if (account) {
          await pool
            .query(`DELETE FROM audit_log WHERE actor_id = $1`, [
              account.staffAccountId,
            ])
            .catch(() => {});
        }
      }
      await pool
        .query(
          `DELETE FROM document_type_field WHERE document_type_id =
             (SELECT document_type_id FROM document_type WHERE type_key = $1)`,
          [DECLARE_TYPE],
        )
        .catch(() => {});
      await pool
        .query(`DELETE FROM document_type WHERE type_key = $1`, [DECLARE_TYPE])
        .catch(() => {});
      await signOutAll(pool, DECLARE_DOMAIN);
      await dayOne.close();
      await dayTwo.close();
      await pool.end();
    }
  });
});

const OFFICE_DAY_DOMAIN = 'evidence-office-day.test';
const OFFICE_DAY_TYPE = 'b7_2b_office_day_type';

// 7.2b, and this is the defect exactly as 7.2 met it: the verify click ran at 00:02 IDT and the
// declaration was stamped with the previous date. The route's `on` is the whole of the fix here, so
// the case drives the real HTTP path and reads the row, rather than asserting about `today(clock)`
// twice (`src/kernel/clock.test.ts` has that half).
//
// **A schema row stamped a day early is the cosmetic end of this.** The same derivation was the
// isolation join's, where it decides which of two people lives in a unit — that case is in
// `tests/policy/isolation.test.ts`, because the scope is never tested through a route.
describe('evidence · a declaration made after midnight (7.2b)', () => {
  it('is stamped the day the office is having, not the UTC day', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    // 00:30 on the 22nd in Jerusalem. In UTC it is still the 21st, which is what the row used to say.
    const AFTER_MIDNIGHT = new Date('2026-09-21T21:30:00.000Z');
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AFTER_MIDNIGHT),
      objects: createMemoryStore(),
      pdf: createFakePdfText(['']),
      bucket: BUCKET,
    });
    let admin: SignedIn | null = null;
    try {
      await signOutAll(pool, OFFICE_DAY_DOMAIN);
      admin = await signIn(pool, fixedClock(AFTER_MIDNIGHT), {
        email: `admin@${OFFICE_DAY_DOMAIN}`,
        role: 'ADMIN',
      });
      await pool.query(
        `INSERT INTO document_type (document_type_id, type_key, label_he, label_en,
                                    verification_terms, is_active)
         VALUES (gen_random_uuid(), $1, 'סוג אחרי חצות', null, null, true)
         ON CONFLICT (type_key) DO NOTHING`,
        [OFFICE_DAY_TYPE],
      );

      const declared = await app.inject({
        method: 'POST',
        url: `/documents/types/${OFFICE_DAY_TYPE}/fields`,
        payload: new URLSearchParams({
          csrf: admin.csrf,
          action: 'declare',
          field_key: 'district',
          label_he: 'מחוז',
          value_type: 'TEXT',
        }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: admin.cookie,
        },
      });
      assert.equal(declared.statusCode, 303);

      const stamped = await pool.query<{ effective_from: string }>(
        `SELECT to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from
           FROM document_type_field f
           JOIN document_type t ON t.document_type_id = f.document_type_id
          WHERE t.type_key = $1 AND f.field_key = 'district'`,
        [OFFICE_DAY_TYPE],
      );
      assert.equal(
        stamped.rows[0]?.effective_from,
        '2026-09-22',
        'the declaration is dated the day the calendar on the wall says',
      );
    } finally {
      if (admin) {
        await pool
          .query(`DELETE FROM audit_log WHERE actor_id = $1`, [
            admin.staffAccountId,
          ])
          .catch(() => {});
      }
      await pool
        .query(
          `DELETE FROM document_type_field WHERE document_type_id =
             (SELECT document_type_id FROM document_type WHERE type_key = $1)`,
          [OFFICE_DAY_TYPE],
        )
        .catch(() => {});
      await pool
        .query(`DELETE FROM document_type WHERE type_key = $1`, [
          OFFICE_DAY_TYPE,
        ])
        .catch(() => {});
      await signOutAll(pool, OFFICE_DAY_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});

/**
 * **Slice 7.3, flow A15 — the approval ledger, driven at both stances.**
 *
 * Every role refusal in this repository is asserted against the stance the composition root actually
 * registered, which is 7.2's ruling and the reason these are route cases and not policy cases:
 * `tests/policy/` builds no application, and a permission is a fact about a door.
 *
 * **Red first, by registering the wrong stance.** `POST /documents/:id/fields/reveal` was registered
 * at `documents.read` and the OPERATOR case below answered 200 with the ת.ז. on the page; the output
 * is in `tasks/evidence/7.3.md`. A stance is the only thing that refusal is about, so the only honest
 * way to write it red is to register the one that lets the caller through.
 */
describe('evidence · the approval ledger, and who may sign what', () => {
  it('shows, signs, withholds and refuses', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const CITY_AP = 'עיר אישור';
    const ADDRESS_AP = 'האישור 7';
    const PROJECT_AP = 'TEST-APPROVE';
    const DOMAIN_AP = 'evidence-approve.test';
    const ID_VALUE_AP = '312345679';
    // On or after the identifier declarations' `effective_from` (2026-09-13), or the catalogue does
    // not declare `tenant_id_number` yet and there is nothing to withhold. 6.4 paid for this once.
    const AT_AP = new Date('2026-09-15T09:00:00.000Z');
    const leaseText = `כתובת המושכר: ${ADDRESS_AP}, ${CITY_AP}, דירה 7\n${specimen(
      'lease-standard.md',
    )}`;
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT_AP),
      objects: createMemoryStore(),
      pdf: createFakePdfText([leaseText]),
      extractor: createFakeExtractor(() => ({
        findings: [
          { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
          { field_key: 'end_date', value: '2027-02-28', word_ids: [1] },
          { field_key: 'apartment_number', value: '7', word_ids: [2] },
          {
            field_key: 'address',
            value: `${ADDRESS_AP} ${CITY_AP}`,
            word_ids: [3],
          },
          { field_key: 'tenant_name', value: 'יעל כהן', word_ids: [4] },
          { field_key: 'tenant_id_number', value: ID_VALUE_AP, word_ids: [5] },
        ],
      })),
      bucket: BUCKET,
    });
    let admin: SignedIn | null = null;
    let operator: SignedIn | null = null;
    let documentId = '';

    const reads = async (): Promise<number> => {
      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'evidence.read_identifier' AND subject_id = $1`,
        [documentId],
      );
      return Number(rows.rows[0]?.n ?? '0');
    };
    const rowIdOf = async (fieldKey: string): Promise<string> => {
      const rows = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = $2`,
        [documentId, fieldKey],
      );
      const id = rows.rows[0]?.id;
      assert.ok(id, `no reading for ${fieldKey}`);
      return id;
    };
    const form = (fields: Record<string, string>): string =>
      new URLSearchParams(fields).toString();
    const post = (who: SignedIn, url: string, fields: Record<string, string>) =>
      asOperator(app as never, who).inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form(fields),
      } as never) as unknown as ReturnType<typeof app.inject>;

    try {
      await signOutAll(pool, DOMAIN_AP);
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      admin = await signIn(pool, fixedClock(AT_AP), {
        email: `admin@${DOMAIN_AP}`,
        role: 'ADMIN',
      });
      operator = await signIn(pool, fixedClock(AT_AP), {
        email: `ops@${DOMAIN_AP}`,
        role: 'OPERATOR',
      });
      await importEstate(pool, {
        projects: [
          {
            name: 'מכרז אישור',
            projectCode: PROJECT_AP,
            tenderRef: null,
            status: 'ACTIVE',
          },
        ],
        buildings: [
          {
            name: 'בניין אישור',
            addressLine: ADDRESS_AP,
            city: CITY_AP,
            projectCode: PROJECT_AP,
            handoverDate: '2025-03-01',
            warrantyEndDate: '2027-03-01',
            status: 'ACTIVE',
            spaces: [
              { kind: 'UNIT', name: 'דירה 7', floor: '1', accessNote: null },
            ],
            units: [
              {
                spaceName: 'דירה 7',
                unitNumber: '7',
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

      const body = upload(
        { csrf: (admin as SignedIn).csrf, type: 'lease' },
        { filename: 'lease.pdf', bytes: pdfBytes('approve-ledger') },
      );
      const filed = await app.inject({
        method: 'POST',
        url: '/documents/intake',
        ...body,
        headers: { ...body.headers, cookie: (admin as SignedIn).cookie },
      });
      assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
      documentId =
        String(filed.headers.location ?? '').match(
          /\/documents\/filing\/([0-9a-f-]{36})$/,
        )?.[1] ?? '';
      assert.ok(documentId, 'a lease goes to its filing workspace');

      await t.test(
        'an OPERATOR opening the ledger of an unopened lease lands on הקריאה (#239)',
        async () => {
          const response = await asOperator(app, operator as SignedIn).inject({
            method: 'GET',
            url: `/documents/${documentId}/fields`,
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.equal(
            response.headers.location,
            `/documents/filing/${documentId}`,
          );
          assert.doesNotMatch(response.body, new RegExp(ID_VALUE_AP));
          // Opening a ledger is not a disclosure, so it writes no line — the same rule 6.4 wrote for
          // the overlay, kept at the finer grain 7.3 introduces.
          assert.equal(await reads(), 0);
        },
      );

      await t.test(
        'an OPERATOR may not reveal, and may not sign what is hidden',
        async () => {
          const revealed = await post(
            operator as SignedIn,
            `/documents/${documentId}/fields/reveal`,
            { extracted_field_id: await rowIdOf('tenant_id_number') },
          );
          assert.equal(revealed.statusCode, 403, revealed.body.slice(0, 200));
          assert.doesNotMatch(revealed.body, new RegExp(ID_VALUE_AP));

          // And the command refuses too, at a route the operator *may* post to: the gate is not only
          // on the door that discloses. A screen that simply omitted the button would be a control
          // and not a rule.
          const signed = await post(
            operator as SignedIn,
            `/documents/${documentId}/fields/approve`,
            {
              extracted_field_id: await rowIdOf('tenant_id_number'),
              approved_value: '999999999',
            },
          );
          assert.equal(signed.statusCode, 403, signed.body.slice(0, 200));
          const row = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM extracted_field
            WHERE document_id = $1 AND approved_at IS NOT NULL`,
            [documentId],
          );
          assert.equal(row.rows[0]?.n, '0');
          assert.equal(await reads(), 0);
        },
      );

      await t.test(
        'an OPERATOR signs the unflagged rows, and the ת.ז. is not among them',
        async () => {
          const response = await post(
            operator as SignedIn,
            `/documents/${documentId}/fields/approve`,
            { action: 'unflagged' },
          );
          assert.equal(response.statusCode, 302, response.body.slice(0, 200));
          // #239: a lease lands back on its one approval screen.
          assert.equal(
            response.headers.location,
            `/documents/filing/${documentId}`,
          );
          const identifier = await pool.query<{ approved_at: Date | null }>(
            `SELECT e.approved_at FROM extracted_field e
             JOIN document_type_field f
               ON f.document_type_field_id = e.document_type_field_id
            WHERE e.document_id = $1 AND f.field_key = 'tenant_id_number'`,
            [documentId],
          );
          assert.equal(identifier.rows[0]?.approved_at, null);
        },
      );

      await t.test(
        'a correction is written beside the reading, and signed once',
        async () => {
          const nameRow = await rowIdOf('tenant_name');
          // On a lease a name is one press each (#239), so the press above left `tenant_name`.
          // The unsign below is kept for the case it was: the trigger is what makes clearing a
          // stamp a deliberate act rather than an UPDATE somebody could write by accident.
          await inTransaction(pool, async (db) => {
            await db.query("SELECT set_config('dona.approving', 'on', true)");
            await db.query(
              `UPDATE extracted_field
                SET approved_value = NULL, approved_by = NULL, approved_at = NULL
              WHERE extracted_field_id = $1`,
              [nameRow],
            );
          });

          const first = await post(
            operator as SignedIn,
            `/documents/${documentId}/fields/approve`,
            { extracted_field_id: nameRow, approved_value: 'יעל לוי' },
          );
          assert.equal(first.statusCode, 302, first.body.slice(0, 200));
          const row = await pool.query<{
            value: string;
            approved_value: string;
          }>(
            `SELECT value, approved_value FROM extracted_field
            WHERE extracted_field_id = $1`,
            [nameRow],
          );
          assert.equal(row.rows[0]?.value, 'יעל כהן');
          assert.equal(row.rows[0]?.approved_value, 'יעל לוי');

          const second = await post(
            operator as SignedIn,
            `/documents/${documentId}/fields/approve`,
            { extracted_field_id: nameRow, approved_value: 'יעל לוי' },
          );
          assert.equal(second.statusCode, 409, second.body.slice(0, 200));
        },
      );

      await t.test(
        'an ADMIN reveals one row, and the disclosure is logged',
        async () => {
          const before = await reads();
          const response = await post(
            admin as SignedIn,
            `/documents/${documentId}/fields/reveal`,
            { extracted_field_id: await rowIdOf('tenant_id_number') },
          );
          assert.equal(response.statusCode, 200, response.body.slice(0, 400));
          assert.match(response.body, new RegExp(ID_VALUE_AP));
          assert.equal(await reads(), before + 1);

          // **One row, and only that row.** A reveal that disclosed the page would make the line a
          // record of who opened a screen, which is what 6.4's overlay log already is and what 7.3's
          // finer door exists to improve on.
          const ordinary = await post(
            admin as SignedIn,
            `/documents/${documentId}/fields/reveal`,
            { extracted_field_id: await rowIdOf('apartment_number') },
          );
          assert.equal(ordinary.statusCode, 400, ordinary.body.slice(0, 200));
          assert.equal(await reads(), before + 1);
        },
      );

      await t.test(
        'the pixels no longer write, and carry the door to the ledger',
        async () => {
          const pixels = await asOperator(app, operator as SignedIn).inject({
            method: 'GET',
            url: `/documents/${documentId}/read`,
          });
          assert.equal(pixels.statusCode, 200, pixels.body.slice(0, 400));
          // 7.3 moved the promote control to the ledger. Two screens writing the same row is how the
          // two drift into disagreeing about which one is the flow.
          assert.doesNotMatch(
            pixels.body,
            /action="\/documents\/[0-9a-f-]+\/promote"/,
          );
          // And it carries the door to where that write went. Asserted on the **overlay** and not
          // on the ledger, which links to itself in every form it draws — the first draft of this
          // line read `ledger.body` and was true of any page carrying a form.
          assert.match(
            pixels.body,
            new RegExp(`/documents/${documentId}/fields`),
          );
        },
      );
    } finally {
      await signOutAll(pool, DOMAIN_AP);
      // An approved row is undeletable by design, so the teardown unsigns before it deletes —
      // through the same flag the command uses, which is the trigger doing its job on the way out.
      await inTransaction(pool, async (db) => {
        await db.query("SELECT set_config('dona.approving', 'on', true)");
        await db.query(
          `UPDATE extracted_field
              SET approved_value = NULL, approved_by = NULL, approved_at = NULL
            WHERE document_id IN (SELECT document_id FROM document
                                   WHERE storage_uri LIKE $1)`,
          [`gs://${BUCKET}/%`],
        );
      });
      if (documentId) {
        await pool.query(
          `DELETE FROM audit_log WHERE subject_id = $1
             AND action IN ('evidence.read_identifier', 'evidence.approve_field')`,
          [documentId],
        );
        await pool.query(
          `DELETE FROM audit_log WHERE inputs->>'documentId' = $1`,
          [documentId],
        );
        await pool.query('DELETE FROM extracted_field WHERE document_id = $1', [
          documentId,
        ]);
        await pool.query('DELETE FROM document_link WHERE document_id = $1', [
          documentId,
        ]);
        await pool.query('DELETE FROM document WHERE document_id = $1', [
          documentId,
        ]);
      }
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT space_id FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2))`,
        [CITY_AP, ADDRESS_AP],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_AP, ADDRESS_AP],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_AP, ADDRESS_AP],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_AP,
      ]);
      await app.close();
      await pool.end();
    }
  });
});
