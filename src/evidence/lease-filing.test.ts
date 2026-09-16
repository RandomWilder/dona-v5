// A16 — the lease-filing tab: see the match, then file. Issue #116.
//
// Highest seam is HTTP against the new tab. Command guts (place reader, fileDocument, type
// guard, OCR ceiling) stay proved where they already are. This suite proves the sequence and
// that A12's door still files on exact one.
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
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakeOcrText, onlineOcrByteLimit } from '../kernel/ocr.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { applyDocumentTypeCatalogue, documentFileHash } from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const CITY = 'עיר תיוק חוזה';
const ADDRESS = 'הבילויים 10';
const PROJECT = 'TEST-A16';
const BUCKET = 'dona-v5-test-a16';
const AT = new Date('2026-09-16T09:00:00.000Z');
const STAFF_DOMAIN = 'a16-filing.test';
const BOUNDARY = '----donaa16';

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const leasing = (address: string) =>
  `כתובת המושכר: ${address}\n${specimen('lease-standard.md')}`;

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז תיוק חוזה',
      projectCode: PROJECT,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין הבילויים 10',
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [
        { kind: 'UNIT', name: 'דירה 9', floor: '1', accessNote: null },
        { kind: 'UNIT', name: 'דירה 10', floor: '1', accessNote: null },
      ],
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
        {
          spaceName: 'דירה 10',
          unitNumber: '10',
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

let who: SignedIn;
const as = <T extends { inject: (o: never) => unknown }>(app: T): T =>
  asOperator(app as never, who) as unknown as T;

function upload(
  fields: Record<string, string>,
  file: { filename: string; bytes: Buffer } | null,
): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
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

describe('evidence · A16 file a lease in one workspace', () => {
  it('shows the tab, confirms exact one, then files on this tab', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }

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
    const here = appFor(leasing(`${ADDRESS}, ${CITY}, דירה 9`));
    const several = appFor(leasing(`${ADDRESS}, ${CITY}`));
    const elsewhere = appFor(leasing('אלמוג 5, עיר שאיננה, דירה 3'));
    const annex = appFor(
      `${specimen('lease-standard.md')}\nהמושכר כמפורט בנספח א'.`,
    );
    const unread = appFor(specimen('lease-standard.md'));
    const wrong = appFor(specimen('arnona-bill.md'));
    const huge = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      objects: counted,
      pdf: createFakePdfText(['סריקה גדולה ללא מילות הטופס']),
      ocr: createFakeOcrText([]),
      bucket: BUCKET,
    });
    const apps = [here, several, elsewhere, annex, unread, wrong, huge];
    const hashes: string[] = [];
    let unitNine = '';
    let unitTen = '';

    const documentsHere = async (): Promise<number> => {
      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM document_link WHERE entity_id = ANY($1::uuid[])`,
        [[unitNine, unitTen]],
      );
      return Number(rows.rows[0]?.n ?? '0');
    };

    try {
      await signOutAll(pool, STAFF_DOMAIN);
      who = await signIn(pool, fixedClock(AT), {
        email: `ops@${STAFF_DOMAIN}`,
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await importEstate(pool, plan);
      const found = await pool.query<{ unit_id: string; unit_number: string }>(
        `SELECT u.unit_id, u.unit_number FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2
          ORDER BY u.unit_number`,
        [CITY, ADDRESS],
      );
      unitNine =
        found.rows.find((row) => row.unit_number === '9')?.unit_id ?? '';
      unitTen =
        found.rows.find((row) => row.unit_number === '10')?.unit_id ?? '';
      assert.ok(unitNine);
      assert.ok(unitTen);

      await t.test(
        'the rail item sits under מסמכים, and the empty tab is lease-only attach',
        async () => {
          const response = await as(here).inject({
            method: 'GET',
            url: '/documents/filing',
          });
          assert.equal(response.statusCode, 200);
          assert.match(response.body, /<h1>תיוק חוזה<\/h1>/);
          assert.match(response.body, /חוזה שכירות/);
          assert.match(response.body, /action="\/documents\/filing"/);
          assert.match(response.body, /type="file"/);
          assert.doesNotMatch(response.body, /<select[^>]*name="type"/);
          assert.doesNotMatch(response.body, /name="type"/);
          assert.match(response.body, /class="filing-beats"/);
          assert.match(response.body, /המסמך/);
          assert.match(response.body, /הדירה/);
          assert.match(response.body, /הקריאה/);
          assert.match(response.body, /הטיוטה/);
          assert.match(response.body, /די היום/);
          const beats = response.body.match(
            /<ol class="filing-beats"[^>]*>[\s\S]*?<\/ol>/,
          )?.[0];
          assert.ok(beats);
          assert.doesNotMatch(beats, /<a /);
          const docs = response.body.indexOf('data-dest="documents"');
          const filing = response.body.indexOf('data-dest="filing"');
          assert.ok(docs !== -1 && filing !== -1 && docs < filing);
          assert.match(response.body, />תיוק חוזה</);
        },
      );

      await t.test(
        'a VIEWER does not see the tab, and the GET refuses',
        async () => {
          const viewer = await signIn(pool, fixedClock(AT), {
            email: `viewer@${STAFF_DOMAIN}`,
            role: 'VIEWER',
          });
          const rail = await here.inject({
            method: 'GET',
            url: '/',
            headers: { cookie: viewer.cookie },
          });
          assert.equal(rail.statusCode, 200);
          assert.doesNotMatch(rail.body, /data-dest="filing"/);
          assert.doesNotMatch(rail.body, />תיוק חוזה</);
          const tab = await here.inject({
            method: 'GET',
            url: '/documents/filing',
            headers: { cookie: viewer.cookie },
          });
          assert.equal(tab.statusCode, 403);
        },
      );

      await t.test(
        'exact one Unit is shown, and Continue is what writes the row',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const seen = await as(here).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { type: 'arnona' },
              { filename: 'שכירות.pdf', bytes: pdfBytes('a16 one') },
            ),
          });
          assert.equal(seen.statusCode, 200, seen.body.slice(0, 400));
          assert.match(seen.body, /דירה אחת/);
          assert.match(seen.body, new RegExp(`value="${unitNine}"`));
          assert.match(seen.body, /type="file"/);
          assert.doesNotMatch(seen.body, /type="radio"/);
          assert.doesNotMatch(seen.body, /חיפוש דירה אחרת/);
          assert.doesNotMatch(seen.body, /יצירת הבניין/);
          assert.doesNotMatch(seen.body, /מה נקרא מן המסמך/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore, 'no object was written');

          const filed = await as(here).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { unit: unitNine },
              { filename: 'שכירות.pdf', bytes: pdfBytes('a16 one') },
            ),
          });
          assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
          assert.match(
            filed.headers.location ?? '',
            /\/documents\/filing\/[0-9a-f-]{36}$/,
          );
          assert.doesNotMatch(filed.headers.location ?? '', /\/fields$/);
          assert.equal((await documentsHere()) - before, 1);

          const next = await as(here).inject({
            method: 'GET',
            url: String(filed.headers.location),
          });
          assert.equal(next.statusCode, 200);
          assert.match(next.body, /תיוק חוזה/);
          assert.match(next.body, /הקריאה/);
          assert.doesNotMatch(next.body, /מה נקרא מן המסמך/);
          hashes.push(documentFileHash(pdfBytes('a16 one')));
        },
      );

      await t.test(
        'a file that is not a lease refuses on this tab and writes nothing',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const response = await as(wrong).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'arnona.pdf', bytes: pdfBytes('a16 arnona') },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /תיוק חוזה/);
          assert.match(response.body, /אינו נראה כמו/);
          assert.match(response.body, /type="file"/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test(
        'a scan the reader cannot carry refuses on this tab and writes nothing',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const response = await as(huge).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              {
                filename: 'huge.pdf',
                bytes: Buffer.concat([
                  pdfBytes('a16 huge'),
                  Buffer.alloc(onlineOcrByteLimit, 0x20),
                ]),
              },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /גדול מכדי/);
          assert.match(response.body, /type="file"/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test(
        'duplicate bytes refuse on this tab, name the existing Document, and write nothing',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const existing = await pool.query<{ document_id: string }>(
            'SELECT document_id FROM document WHERE file_hash = $1',
            [documentFileHash(pdfBytes('a16 one'))],
          );
          const documentId = existing.rows[0]?.document_id ?? '';
          assert.ok(documentId);
          const response = await as(here).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { unit: unitNine },
              { filename: 'again.pdf', bytes: pdfBytes('a16 one') },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /תיוק חוזה/);
          assert.match(response.body, /כבר מתויק/);
          assert.match(
            response.body,
            new RegExp(`/documents/${documentId}/read`),
          );
          assert.match(response.body, /type="file"/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test(
        'not exactly one Unit stays here with A12’s sentence and no pick UI',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const many = await as(several).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'several.pdf', bytes: pdfBytes('a16 several') },
            ),
          });
          assert.equal(many.statusCode, 422);
          assert.match(many.body, /נמצאה יותר מדירה אחת/);
          assert.match(many.body, /type="file"/);
          assert.doesNotMatch(many.body, /type="radio"/);
          assert.doesNotMatch(many.body, /חיפוש דירה אחרת/);
          assert.doesNotMatch(many.body, /יצירת הבניין/);

          const none = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'none.pdf', bytes: pdfBytes('a16 none') },
            ),
          });
          assert.equal(none.statusCode, 422);
          assert.match(none.body, /אינה בתיק/);
          assert.match(none.body, /type="file"/);
          assert.doesNotMatch(none.body, /חיפוש דירה אחרת/);

          const deferred = await as(annex).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'annex.pdf', bytes: pdfBytes('a16 annex') },
            ),
          });
          assert.equal(deferred.statusCode, 422);
          assert.match(deferred.body, /מפנה את פרטי הנכס לנספח/);
          assert.match(deferred.body, /type="file"/);
          assert.doesNotMatch(deferred.body, /חיפוש דירה אחרת/);

          const blank = await as(unread).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'blank.pdf', bytes: pdfBytes('a16 unread') },
            ),
          });
          assert.equal(blank.statusCode, 422);
          assert.match(blank.body, /לא נקראה כתובת/);
          assert.match(blank.body, /type="file"/);
          assert.doesNotMatch(blank.body, /חיפוש דירה אחרת/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test(
        'A12 still files immediately on exact one Unit',
        async () => {
          const before = await documentsHere();
          const response = await as(here).inject({
            method: 'POST',
            url: '/documents/intake',
            ...upload(
              { type: 'lease' },
              { filename: 'a12.pdf', bytes: pdfBytes('a16 a12 still') },
            ),
          });
          assert.equal(response.statusCode, 302, response.body.slice(0, 400));
          assert.match(
            response.headers.location ?? '',
            /\/documents\/[0-9a-f-]{36}\/fields$/,
          );
          assert.equal((await documentsHere()) - before, 1);
          hashes.push(documentFileHash(pdfBytes('a16 a12 still')));
        },
      );
    } finally {
      await pool
        .query(
          `DELETE FROM audit_log
            WHERE action = 'evidence.intake_unresolved' AND actor_id = $1`,
          [who?.staffAccountId],
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
      for (const unitId of [unitNine, unitTen].filter(Boolean)) {
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
        await pool.query('DELETE FROM unit WHERE unit_id = $1', [unitId]);
        await pool.query('DELETE FROM space WHERE space_id = $1', [unitId]);
      }
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY, ADDRESS],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT,
      ]);
      for (const app of apps) {
        await app.close();
      }
      await pool.end();
    }
  });
});
