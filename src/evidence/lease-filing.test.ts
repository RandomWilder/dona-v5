// A16 — the lease-filing tab. Issues #116, #117, #118 and #119.
//
// Highest seam is HTTP against the new tab. Command guts (place reader, fileDocument, type
// guard, OCR ceiling, upsertUnitRow, draft from approved reading, same-Unit-and-start conflict)
// stay proved where they already are. This suite proves the sequence: confirm-then-file,
// pick/search/create, thin reading → טיוטה on this tab, paper marks, that A12 still files on
// exact one, and that the paint is gone.
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
import { createFakeOcrText, onlineOcrByteLimit } from '../kernel/ocr.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { upsertTermsProfile } from '../tenancy/contract.ts';
import {
  applyDocumentTypeCatalogue,
  DEFAULT_TERMS_PROFILE,
  documentFileHash,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const CITY = 'עיר תיוק חוזה';
const ADDRESS = 'הבילויים 10';
const NONE_CITY = 'עיר תיוק מקום';
const NONE_STREET = 'ארז 88';
const PROJECT = 'TEST-A16';
const BUCKET = 'dona-v5-test-a16';
const AT = new Date('2026-09-16T09:00:00.000Z');
const STAFF_DOMAIN = 'a16-filing.test';
const BOUNDARY = '----donaa16';

const paperMarks = (html: string): string[] => {
  const marks: string[] = [];
  const start = /<span class="excerpt"[^>]*>/g;
  let found = start.exec(html);
  while (found) {
    let depth = 1;
    let at = found.index + found[0].length;
    const innerStart = at;
    while (at < html.length && depth > 0) {
      const open = html.indexOf('<span', at);
      const close = html.indexOf('</span>', at);
      if (close === -1) break;
      if (open !== -1 && open < close) {
        depth += 1;
        at = open + 5;
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        marks.push(
          html
            .slice(innerStart, close)
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
      at = close + 7;
    }
    found = start.exec(html);
  }
  return marks;
};

const noA16Paint = (html: string) => {
  assert.doesNotMatch(html, /class="excerpt"/);
  assert.doesNotMatch(html, /class="file-well"/);
  assert.doesNotMatch(html, /class="filing-beats"/);
};

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
let operator: SignedIn;
const as = <T extends { inject: (o: never) => unknown }>(app: T): T =>
  asOperator(app as never, who) as unknown as T;
const asRole = <T extends { inject: (o: never) => unknown }>(
  app: T,
  actor: SignedIn,
): T => asOperator(app as never, actor) as unknown as T;

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

describe('evidence · A16 file a lease in one workspace', {
  concurrency: false,
}, () => {
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
    const elsewhere = appFor(leasing(`${NONE_STREET}, ${NONE_CITY}, דירה 3`));
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
        email: `admin@${STAFF_DOMAIN}`,
        role: 'ADMIN',
      });
      operator = await signIn(pool, fixedClock(AT), {
        email: `ops@${STAFF_DOMAIN}`,
        role: 'OPERATOR',
      });
      const wipePlace = async (city: string, address: string) => {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
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
      };
      await wipePlace(CITY, ADDRESS);
      await wipePlace(NONE_CITY, NONE_STREET);
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
          assert.match(response.body, /class="file-well"/);
          assert.deepEqual(paperMarks(response.body), []);
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
          const marks = paperMarks(seen.body);
          assert.ok(marks.some((mark) => mark.includes(ADDRESS)));
          assert.ok(marks.some((mark) => mark.includes(CITY)));
          assert.ok(marks.some((mark) => mark === '9'));
          assert.ok(marks.every((mark) => !/נקראה|בתיק|המשך/.test(mark)));
          assert.match(seen.body, /class="file-well"/);
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
          assert.match(response.body, /class="file-well"/);
          assert.deepEqual(paperMarks(response.body), []);
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
        'several Units: the sentence, a list to pick, then attach again files',
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
          const marks = paperMarks(many.body);
          assert.ok(marks.some((mark) => mark.includes(ADDRESS)));
          assert.ok(marks.some((mark) => mark.includes(CITY)));
          assert.ok(marks.every((mark) => !/נקראה|יותר מדירה/.test(mark)));
          assert.match(many.body, /class="file-well"/);
          assert.match(many.body, /type="radio"/);
          assert.match(many.body, new RegExp(`value="${unitNine}"`));
          assert.match(many.body, new RegExp(`value="${unitTen}"`));
          assert.match(many.body, /חיפוש דירה/);
          assert.match(many.body, /type="file"/);
          assert.doesNotMatch(many.body, /\/estate\/buildings\/new/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);

          const filed = await as(several).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { unit: unitTen },
              { filename: 'several.pdf', bytes: pdfBytes('a16 several') },
            ),
          });
          assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
          assert.match(
            filed.headers.location ?? '',
            /\/documents\/filing\/[0-9a-f-]{36}$/,
          );
          assert.equal((await documentsHere()) - before, 1);
          hashes.push(documentFileHash(pdfBytes('a16 several')));
        },
      );

      await t.test(
        'nothing readable, annex, and an address in nobody’s portfolio stay here with A12’s sentences',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
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
          const marks = paperMarks(none.body);
          assert.ok(marks.some((mark) => mark.includes(NONE_STREET)));
          assert.ok(marks.some((mark) => mark.includes(NONE_CITY)));
          assert.ok(marks.every((mark) => !/אינה בתיק/.test(mark)));
          assert.match(none.body, /חיפוש דירה/);
          assert.match(none.body, /type="file"/);
          assert.doesNotMatch(none.body, /\/estate\/buildings\/new/);

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
          assert.match(deferred.body, /חיפוש דירה/);
          assert.doesNotMatch(deferred.body, /יצירת הבניין/);
          assert.doesNotMatch(deferred.body, /יצירת דירה/);

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
          assert.match(blank.body, /חיפוש דירה/);
          assert.doesNotMatch(blank.body, /יצירת הבניין/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);
        },
      );

      await t.test('search for a Unit works on this step', async () => {
        const found = await as(here).inject({
          method: 'GET',
          url: `/documents/filing?q=${encodeURIComponent(ADDRESS)}`,
        });
        assert.equal(found.statusCode, 200);
        assert.match(found.body, /תיוק חוזה/);
        assert.match(found.body, /type="radio"/);
        assert.match(found.body, new RegExp(`value="${unitNine}"`));
        assert.match(found.body, /type="file"/);
        assert.match(found.body, /action="\/documents\/filing"/);
        assert.doesNotMatch(found.body, /\/estate\/buildings\/new/);
      });

      await t.test(
        'an OPERATOR sees pick and search and no create control',
        async () => {
          const response = await asRole(elsewhere, operator).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { csrf: operator.csrf },
              { filename: 'ops.pdf', bytes: pdfBytes('a16 ops none') },
            ),
          });
          assert.equal(response.statusCode, 422);
          assert.match(response.body, /חיפוש דירה/);
          assert.doesNotMatch(response.body, /יצירת הבניין/);
          assert.doesNotMatch(response.body, /יצירת דירה/);
          assert.doesNotMatch(response.body, /name="address_line"/);
          assert.doesNotMatch(
            response.body,
            /action="\/documents\/filing\/place"/,
          );
          const forbidden = await asRole(elsewhere, operator).inject({
            method: 'POST',
            url: '/documents/filing/place',
            payload: new URLSearchParams({
              csrf: operator.csrf,
              address_line: NONE_STREET,
              city: NONE_CITY,
              unit_number: '3',
            }).toString(),
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
          });
          assert.equal(forbidden.statusCode, 403);
        },
      );

      await t.test(
        'estate-write creates a Building and Unit on this step, prefilled, then attach files',
        async () => {
          const before = await documentsHere();
          const putsBefore = puts;
          const createBytes = pdfBytes(`a16-117-create-${Date.now()}`);
          const seen = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload({}, { filename: 'create.pdf', bytes: createBytes }),
          });
          assert.equal(seen.statusCode, 422, seen.body.slice(0, 400));
          assert.match(seen.body, /action="\/documents\/filing\/place"/);
          assert.match(seen.body, /name="address_line"/);
          assert.match(seen.body, new RegExp(`value="${NONE_STREET}"`));
          assert.match(seen.body, new RegExp(`value="${NONE_CITY}"`));
          assert.match(seen.body, /value="3"/);
          assert.doesNotMatch(seen.body, /\/estate\/buildings\/new/);
          assert.doesNotMatch(seen.body, /handover_date/);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);

          const created = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/filing/place',
            payload: new URLSearchParams({
              address_line: NONE_STREET,
              city: NONE_CITY,
              unit_number: '3',
            }).toString(),
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
          });
          assert.equal(created.statusCode, 200, created.body.slice(0, 400));
          assert.match(created.body, /הדירה נוצרה/);
          assert.match(created.body, /type="file"/);
          assert.match(created.body, /type="radio"/);
          assert.doesNotMatch(created.body, /\/estate\/buildings\//);
          const createdUnit =
            /name="unit"[^>]*value="([0-9a-f-]{36})"/.exec(created.body)?.[1] ??
            /value="([0-9a-f-]{36})"[^>]*name="unit"/.exec(created.body)?.[1] ??
            '';
          assert.ok(createdUnit);
          assert.equal(await documentsHere(), before);
          assert.equal(puts, putsBefore);

          const filed = await as(elsewhere).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              { unit: createdUnit },
              { filename: 'create.pdf', bytes: createBytes },
            ),
          });
          assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
          assert.match(
            filed.headers.location ?? '',
            /\/documents\/filing\/[0-9a-f-]{36}$/,
          );
          const linked = await pool.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM document_link WHERE entity_id = $1',
            [createdUnit],
          );
          assert.equal(linked.rows[0]?.n, '1');
          hashes.push(documentFileHash(createBytes));
        },
      );

      await t.test(
        'when the building is already held, only the Unit is created on this step',
        async () => {
          const missingFlat = appFor(leasing(`${ADDRESS}, ${CITY}, דירה 12`));
          apps.push(missingFlat);
          const seen = await as(missingFlat).inject({
            method: 'POST',
            url: '/documents/filing',
            ...upload(
              {},
              { filename: 'flat.pdf', bytes: pdfBytes('a16 flat only') },
            ),
          });
          assert.equal(seen.statusCode, 422);
          assert.match(seen.body, /הבניין נמצא בתיק, והדירה לא/);
          assert.match(seen.body, /name="building"/);
          const buildingId =
            /name="building"[^>]*value="([0-9a-f-]{36})"/.exec(
              seen.body,
            )?.[1] ??
            /value="([0-9a-f-]{36})"[^>]*name="building"/.exec(
              seen.body,
            )?.[1] ??
            '';
          assert.ok(buildingId);
          const created = await as(missingFlat).inject({
            method: 'POST',
            url: '/documents/filing/place',
            payload: new URLSearchParams({
              building: buildingId,
              address_line: ADDRESS,
              city: CITY,
              unit_number: '12',
            }).toString(),
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
          });
          assert.equal(created.statusCode, 200, created.body.slice(0, 400));
          const createdUnit =
            /name="unit"[^>]*value="([0-9a-f-]{36})"/.exec(created.body)?.[1] ??
            /value="([0-9a-f-]{36})"[^>]*name="unit"/.exec(created.body)?.[1] ??
            '';
          assert.ok(createdUnit);
          const row = await pool.query<{ building_id: string }>(
            'SELECT building_id FROM space WHERE space_id = $1',
            [createdUnit],
          );
          assert.equal(row.rows[0]?.building_id, buildingId);
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
          const intake = await as(here).inject({
            method: 'GET',
            url: '/documents/new',
          });
          assert.equal(intake.statusCode, 200);
          noA16Paint(intake.body);
          const catalogue = await as(here).inject({
            method: 'GET',
            url: '/documents',
          });
          assert.equal(catalogue.statusCode, 200);
          noA16Paint(catalogue.body);
          const fields = await as(here).inject({
            method: 'GET',
            url: String(response.headers.location),
          });
          assert.equal(fields.statusCode, 200);
          assert.match(fields.body, /מה נקרא מן המסמך/);
          noA16Paint(fields.body);
        },
      );
    } finally {
      await pool
        .query(
          `DELETE FROM audit_log
            WHERE action = 'evidence.intake_unresolved' AND actor_id = ANY($1::uuid[])`,
          [[who?.staffAccountId, operator?.staffAccountId].filter(Boolean)],
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
      for (const [city, address] of [
        [CITY, ADDRESS],
        [NONE_CITY, NONE_STREET],
      ] as const) {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
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
      }
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT,
      ]);
      for (const app of apps) {
        await app.close();
      }
      await pool.end();
    }
  });

  it('stamps names and dates on this tab, then arrives at טיוטה', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }

    const CITY_R = 'עיר תיוק קריאה';
    const ADDRESS_R = 'הבילויים 11';
    const PROJECT_R = 'TEST-A16-R';
    const BUCKET_R = 'dona-v5-test-a16-read';
    const DOMAIN_R = 'a16-read.test';
    const START = '2026-11-01';
    const END = '2027-10-31';
    const TENANT = 'יוסף כהן';
    const findings = [
      { field_key: 'start_date', value: START, word_ids: [0] },
      { field_key: 'end_date', value: END, word_ids: [1] },
      { field_key: 'apartment_number', value: '9', word_ids: [2] },
      { field_key: 'address', value: ADDRESS_R, word_ids: [3] },
      { field_key: 'tenant_name', value: TENANT, word_ids: [4] },
      { field_key: 'tenant_id_number', value: '123456789', word_ids: [5] },
    ];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      objects: createMemoryStore(),
      pdf: createFakePdfText([leasing(`${ADDRESS_R}, ${CITY_R}, דירה 9`)]),
      extractor: createFakeExtractor(() => ({ findings })),
      bucket: BUCKET_R,
    });
    const planR: EstatePlan = {
      projects: [
        {
          name: 'מכרז תיוק קריאה',
          projectCode: PROJECT_R,
          tenderRef: null,
          status: 'ACTIVE',
        },
      ],
      buildings: [
        {
          name: 'בניין הבילויים 11',
          addressLine: ADDRESS_R,
          city: CITY_R,
          projectCode: PROJECT_R,
          handoverDate: '2025-03-01',
          warrantyEndDate: '2027-03-01',
          status: 'ACTIVE',
          spaces: [
            { kind: 'UNIT', name: 'דירה 9', floor: '1', accessNote: null },
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
          ],
        },
      ],
    };

    const form = (fields: Record<string, string>): string =>
      new URLSearchParams(fields).toString();
    let actor: SignedIn;
    const post = (url: string, fields: Record<string, string>) =>
      asRole(app, actor).inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ csrf: actor.csrf, ...fields }),
      });
    const send = (
      fields: Record<string, string>,
      file: { filename: string; bytes: Buffer },
    ) => {
      const body = upload({ csrf: actor.csrf, ...fields }, file);
      return asRole(app, actor).inject({
        method: 'POST',
        url: '/documents/filing',
        ...body,
      });
    };

    const rowIdOf = async (
      documentId: string,
      fieldKey: string,
    ): Promise<string> => {
      const rows = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = $2
          ORDER BY e.extracted_field_id`,
        [documentId, fieldKey],
      );
      const id = rows.rows[0]?.id ?? '';
      assert.ok(id, fieldKey);
      return id;
    };

    const fileOnTab = async (marker: string): Promise<string> => {
      const seen = await send(
        {},
        { filename: 'שכירות.pdf', bytes: pdfBytes(marker) },
      );
      assert.equal(seen.statusCode, 200, seen.body.slice(0, 400));
      const filed = await send(
        { unit: unitId },
        { filename: 'שכירות.pdf', bytes: pdfBytes(marker) },
      );
      assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
      const location = String(filed.headers.location ?? '');
      assert.match(location, /\/documents\/filing\/[0-9a-f-]{36}$/);
      return location.match(/\/documents\/filing\/([0-9a-f-]{36})$/)?.[1] ?? '';
    };

    const stampOpening = async (documentId: string) => {
      for (const key of ['start_date', 'end_date', 'tenant_name'] as const) {
        const stamped = await post(`/documents/filing/${documentId}/approve`, {
          extracted_field_id: await rowIdOf(documentId, key),
        });
        if (key !== 'tenant_name') {
          assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 400));
          assert.equal(
            stamped.headers.location,
            `/documents/filing/${documentId}`,
          );
        } else {
          return stamped;
        }
      }
      throw new Error('no last stamp');
    };

    let unitId = '';
    try {
      await signOutAll(pool, DOMAIN_R);
      actor = await signIn(pool, fixedClock(AT), {
        email: `admin@${DOMAIN_R}`,
        role: 'ADMIN',
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await pool.query(
        'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
      );
      try {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM tenancy WHERE unit_id IN (
             SELECT s.space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM unit WHERE unit_id IN (
             SELECT s.space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM space WHERE building_id IN (
             SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          'DELETE FROM building WHERE city = $1 AND address_line = $2',
          [CITY_R, ADDRESS_R],
        );
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
      await importEstate(pool, planR);
      await upsertTermsProfile(pool, DEFAULT_TERMS_PROFILE);
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY_R, ADDRESS_R],
      );
      unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);

      const documentId = await fileOnTab('a16-read-one');
      const reading = await asRole(app, actor).inject({
        method: 'GET',
        url: `/documents/filing/${documentId}`,
      });
      assert.equal(reading.statusCode, 200);
      assert.match(reading.body, /תיוק חוזה/);
      assert.match(reading.body, /הקריאה/);
      assert.match(reading.body, new RegExp(TENANT));
      assert.match(reading.body, new RegExp(START));
      assert.match(reading.body, new RegExp(END));
      const readingMarks = paperMarks(reading.body);
      assert.ok(readingMarks.includes(TENANT));
      assert.ok(readingMarks.includes(START));
      assert.ok(readingMarks.includes(END));
      assert.ok(readingMarks.includes('9'));
      assert.ok(readingMarks.every((mark) => !/חתמו|טיוטה|שדה/.test(mark)));
      assert.match(
        reading.body,
        new RegExp(`action="/documents/filing/${documentId}/approve"`),
      );
      assert.doesNotMatch(reading.body, /מה נקרא מן המסמך/);
      assert.doesNotMatch(reading.body, /אישור כל מה שלא סומן/);
      assert.doesNotMatch(reading.body, />קדם/);
      assert.doesNotMatch(reading.body, /\/fields\/reveal/);
      assert.doesNotMatch(reading.body, /פתיחת החוזה/);
      assert.match(reading.body, /123456789/);

      const ledger = await asRole(app, actor).inject({
        method: 'GET',
        url: `/documents/${documentId}/fields`,
      });
      assert.equal(ledger.statusCode, 200);
      assert.match(ledger.body, /מה נקרא מן המסמך/);
      assert.match(ledger.body, /איכות הקריאה/);
      assert.match(ledger.body, /\/documents\/.*\/fields\/approve/);
      noA16Paint(ledger.body);

      const last = await stampOpening(documentId);
      assert.equal(last.statusCode, 302, last.body.slice(0, 400));
      assert.equal(last.headers.location, `/documents/filing/${documentId}`);
      assert.doesNotMatch(
        String(last.headers.location),
        /\/estate\/tenancies\//,
      );

      const draft = await asRole(app, actor).inject({
        method: 'GET',
        url: `/documents/filing/${documentId}`,
      });
      assert.equal(draft.statusCode, 200);
      assert.match(draft.body, /הטיוטה/);
      assert.match(draft.body, /די היום/);
      assert.match(draft.body, new RegExp(TENANT));
      assert.match(draft.body, new RegExp(START));
      assert.match(draft.body, new RegExp(END));
      const draftMarks = paperMarks(draft.body);
      assert.ok(draftMarks.includes(TENANT));
      assert.ok(draftMarks.includes(START));
      assert.ok(draftMarks.includes(END));
      assert.ok(
        draftMarks.every((mark) => !/הטיוטה נרשמה|פרוטוקול|די היום/.test(mark)),
      );
      assert.match(draft.body, /פרוטוקול מסירה/);
      assert.match(draft.body, /לא הוגש/);
      assert.match(
        draft.body,
        /<a href="\/estate\/tenancies\/[0-9a-f-]{36}">פרוטוקול מסירה<\/a>/,
      );
      assert.match(draft.body, /href="\/documents\/filing"/);
      assert.match(draft.body, /פתיחת החוזה/);
      assert.match(draft.body, /פתיחת הדירה/);
      assert.match(draft.body, new RegExp(`/estate/units/${unitId}`));
      assert.doesNotMatch(draft.body, /\/activate/);
      assert.doesNotMatch(draft.body, /name="file"/);
      assert.doesNotMatch(draft.body, /handover_protocol/);
      assert.doesNotMatch(draft.body, /מה נקרא מן המסמך/);
      const tenancyHref =
        draft.body.match(/href="(\/estate\/tenancies\/[0-9a-f-]{36})"/)?.[1] ??
        '';
      assert.ok(tenancyHref);
      const tenancyId =
        tenancyHref.match(/\/estate\/tenancies\/([0-9a-f-]{36})$/)?.[1] ?? '';
      const tenancy = await asRole(app, actor).inject({
        method: 'GET',
        url: tenancyHref,
      });
      assert.equal(tenancy.statusCode, 200);
      assert.doesNotMatch(tenancy.body, /class="excerpt"/);
      assert.doesNotMatch(tenancy.body, /class="filing-beats"/);
      assert.match(tenancy.body, /class="file-well"/);
      assert.match(tenancy.body, /הגשת פרוטוקול מסירה/);

      const another = await asRole(app, actor).inject({
        method: 'GET',
        url: '/documents/filing',
      });
      assert.equal(another.statusCode, 200);
      assert.match(another.body, /type="file"/);
      assert.doesNotMatch(another.body, new RegExp(TENANT));
      const kept = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tenancy WHERE tenancy_id = $1',
        [tenancyId],
      );
      assert.equal(kept.rows[0]?.n, '1');

      const secondId = await fileOnTab('a16-read-two');
      const clash = await stampOpening(secondId);
      assert.equal(clash.statusCode, 409, clash.body.slice(0, 400));
      assert.match(clash.body, /conflict/);
      assert.match(clash.body, new RegExp(`/estate/tenancies/${tenancyId}`));
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
          [`gs://${BUCKET_R}/%`],
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
          [`gs://${BUCKET_R}/%`],
        );
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
        await pool.query(
          `DELETE FROM tenancy WHERE unit_id IN (
             SELECT s.space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_R, ADDRESS_R],
        );
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
      await pool.query(
        `DELETE FROM extracted_field WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_R}/%`],
      );
      await pool.query(
        `DELETE FROM document_passage WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_R}/%`],
      );
      await pool.query(
        `DELETE FROM document_link WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_R}/%`],
      );
      await pool.query('DELETE FROM document WHERE storage_uri LIKE $1', [
        `gs://${BUCKET_R}/%`,
      ]);
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT s.space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY_R, ADDRESS_R],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_R, ADDRESS_R],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_R, ADDRESS_R],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_R,
      ]);
      await app.close();
      await pool.end();
    }
  });

  it('reads the declared set on הקריאה, and a money row is approvable without its currency', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }

    const CITY_D = 'עיר תיוק מוצהר';
    const ADDRESS_D = 'הבילויים 12';
    const PROJECT_D = 'TEST-A16-D';
    const BUCKET_D = 'dona-v5-test-a16-declared';
    const DOMAIN_D = 'a16-declared.test';
    const ON = new Date('2026-09-21T09:00:00.000Z');
    const START = '2026-11-01';
    const END = '2027-10-31';
    const TENANT = 'יוסף כהן';
    const ID = '312345678';
    const findings = [
      { field_key: 'start_date', value: START, word_ids: [0] },
      { field_key: 'end_date', value: END, word_ids: [1] },
      { field_key: 'apartment_number', value: '9', word_ids: [2] },
      { field_key: 'address', value: ADDRESS_D, word_ids: [3] },
      { field_key: 'main_tenant_name', value: TENANT, word_ids: [4] },
      { field_key: 'main_tenant_name', value: `${TENANT} ב`, word_ids: [4] },
      { field_key: 'main_tenant_id_number', value: ID, word_ids: [5] },
      { field_key: 'rent_amount', value: '4500', word_ids: [0] },
    ];
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(ON),
      objects: createMemoryStore(),
      pdf: createFakePdfText([leasing(`${ADDRESS_D}, ${CITY_D}, דירה 9`)]),
      extractor: createFakeExtractor(() => ({ findings })),
      bucket: BUCKET_D,
    });
    const planD: EstatePlan = {
      projects: [
        {
          name: 'מכרז תיוק מוצהר',
          projectCode: PROJECT_D,
          tenderRef: null,
          status: 'ACTIVE',
        },
      ],
      buildings: [
        {
          name: 'בניין הבילויים 12',
          addressLine: ADDRESS_D,
          city: CITY_D,
          projectCode: PROJECT_D,
          handoverDate: '2025-03-01',
          warrantyEndDate: '2027-03-01',
          status: 'ACTIVE',
          spaces: [
            { kind: 'UNIT', name: 'דירה 9', floor: '1', accessNote: null },
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
          ],
        },
      ],
    };

    const form = (fields: Record<string, string>): string =>
      new URLSearchParams(fields).toString();
    let actor: SignedIn;
    const post = (url: string, fields: Record<string, string>) =>
      asRole(app, actor).inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ csrf: actor.csrf, ...fields }),
      });
    const send = (
      fields: Record<string, string>,
      file: { filename: string; bytes: Buffer },
    ) => {
      const body = upload({ csrf: actor.csrf, ...fields }, file);
      return asRole(app, actor).inject({
        method: 'POST',
        url: '/documents/filing',
        ...body,
      });
    };
    const rowIdsOf = async (
      documentId: string,
      fieldKey: string,
    ): Promise<string[]> => {
      const rows = await pool.query<{ id: string }>(
        `SELECT e.extracted_field_id AS id FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = $2
          ORDER BY e.extracted_field_id`,
        [documentId, fieldKey],
      );
      return rows.rows.map((row) => row.id);
    };

    let unitId = '';
    try {
      await signOutAll(pool, DOMAIN_D);
      actor = await signIn(pool, fixedClock(ON), {
        email: `admin@${DOMAIN_D}`,
        role: 'ADMIN',
      });
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await pool.query(
        'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
      );
      try {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
        await pool.query(
          `DELETE FROM tenancy WHERE unit_id IN (
             SELECT s.space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
      await importEstate(pool, planD);
      await upsertTermsProfile(pool, DEFAULT_TERMS_PROFILE);
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY_D, ADDRESS_D],
      );
      unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);

      const seen = await send(
        {},
        { filename: 'שכירות.pdf', bytes: pdfBytes('a16-declared') },
      );
      assert.equal(seen.statusCode, 200, seen.body.slice(0, 400));
      const filed = await send(
        { unit: unitId },
        { filename: 'שכירות.pdf', bytes: pdfBytes('a16-declared') },
      );
      assert.equal(filed.statusCode, 302, filed.body.slice(0, 400));
      const documentId =
        String(filed.headers.location ?? '').match(
          /\/documents\/filing\/([0-9a-f-]{36})$/,
        )?.[1] ?? '';
      assert.ok(documentId);

      const reading = await asRole(app, actor).inject({
        method: 'GET',
        url: `/documents/filing/${documentId}`,
      });
      assert.equal(reading.statusCode, 200);
      assert.match(reading.body, /<th class="group"[^>]*>תאריכים<\/th>/);
      assert.match(reading.body, /<th class="group"[^>]*>כסף<\/th>/);
      assert.match(reading.body, /<th class="group"[^>]*>אנשים<\/th>/);
      assert.match(reading.body, /<th class="group"[^>]*>מקום<\/th>/);
      assert.match(reading.body, /דמי שכירות חודשיים/);
      assert.match(reading.body, /חסר מטבע/);
      assert.match(reading.body, new RegExp(TENANT));
      assert.match(reading.body, new RegExp(`${TENANT} ב`));
      assert.match(reading.body, new RegExp(ID));
      assert.match(reading.body, /שוכר ראשי/);
      assert.doesNotMatch(reading.body, /אישור כל מה שלא סומן/);
      assert.doesNotMatch(reading.body, />קדם/);
      assert.doesNotMatch(reading.body, /\/fields\/reveal/);

      const rentId = (await rowIdsOf(documentId, 'rent_amount'))[0] ?? '';
      const rent = await post(`/documents/filing/${documentId}/approve`, {
        extracted_field_id: rentId,
      });
      assert.equal(rent.statusCode, 302, rent.body.slice(0, 400));

      for (const key of ['start_date', 'end_date'] as const) {
        const id = (await rowIdsOf(documentId, key))[0] ?? '';
        const stamped = await post(`/documents/filing/${documentId}/approve`, {
          extracted_field_id: id,
        });
        assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 400));
      }
      const names = await rowIdsOf(documentId, 'main_tenant_name');
      assert.equal(names.length, 2);
      const last = await post(`/documents/filing/${documentId}/approve`, {
        extracted_field_id: names[0] ?? '',
      });
      assert.equal(last.statusCode, 302, last.body.slice(0, 400));
      const draft = await asRole(app, actor).inject({
        method: 'GET',
        url: `/documents/filing/${documentId}`,
      });
      assert.equal(draft.statusCode, 200);
      assert.match(draft.body, /הטיוטה/);
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
          [`gs://${BUCKET_D}/%`],
        );
      });
      await pool.query(
        'ALTER TABLE tenancy_event DISABLE TRIGGER tenancy_event_is_append_only',
      );
      try {
        await pool.query(
          `DELETE FROM tenancy_event WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
        await pool.query(
          `DELETE FROM tenancy_party WHERE tenancy_id IN (
             SELECT t.tenancy_id FROM tenancy t
             JOIN space s ON s.space_id = t.unit_id
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
        await pool.query(
          `DELETE FROM tenancy WHERE unit_id IN (
             SELECT s.space_id FROM space s
             JOIN building b ON b.building_id = s.building_id
             WHERE b.city = $1 AND b.address_line = $2)`,
          [CITY_D, ADDRESS_D],
        );
      } finally {
        await pool.query(
          'ALTER TABLE tenancy_event ENABLE TRIGGER tenancy_event_is_append_only',
        );
      }
      await pool.query(
        `DELETE FROM extracted_field WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_D}/%`],
      );
      await pool.query(
        `DELETE FROM document_passage WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_D}/%`],
      );
      await pool.query(
        `DELETE FROM document_link WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET_D}/%`],
      );
      await pool.query('DELETE FROM document WHERE storage_uri LIKE $1', [
        `gs://${BUCKET_D}/%`,
      ]);
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT s.space_id FROM space s
           JOIN building b ON b.building_id = s.building_id
           WHERE b.city = $1 AND b.address_line = $2)`,
        [CITY_D, ADDRESS_D],
      );
      await pool.query(
        `DELETE FROM space WHERE building_id IN (
           SELECT building_id FROM building WHERE city = $1 AND address_line = $2)`,
        [CITY_D, ADDRESS_D],
      );
      await pool.query(
        'DELETE FROM building WHERE city = $1 AND address_line = $2',
        [CITY_D, ADDRESS_D],
      );
      await pool.query('DELETE FROM project WHERE project_code = $1', [
        PROJECT_D,
      ]);
      await app.close();
      await pool.end();
    }
  });
});
