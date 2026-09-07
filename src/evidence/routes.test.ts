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
import { buildApp } from '../app.ts';
import type { EstatePlan } from '../estate/contract.ts';
import { importEstate } from '../estate/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { applyDocumentTypeCatalogue } from './contract.ts';
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
  for (const [name, value] of Object.entries(fields)) {
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

describe('evidence · the upload route', () => {
  it('files the right file and refuses the wrong one, both directions', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    // One app per document, because the reader is a dependency: the bytes say which *kind* of file
    // this is and the injected reader says what it says.
    const appFor = (text: string) =>
      buildApp({
        pool,
        version: '9.9.9-test',
        clock: fixedClock(AT),
        objects: createMemoryStore(),
        pdf: createFakePdfText([text]),
        bucket: BUCKET,
      });
    const lease = appFor(specimen('lease-standard.md'));
    const arnona = appFor(specimen('arnona-bill.md'));
    const hashes: string[] = [];
    let unitId = '';

    try {
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
        const response = await lease.inject({
          method: 'GET',
          url: `/documents/new?unit=${unitId}`,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /הוספת מסמך/);
        assert.match(response.body, /value="lease"/);
        assert.match(response.body, /value="handover_protocol"/);
        assert.match(response.body, /enctype="multipart\/form-data"/);
        // The rule every screen keeps until week 5: a flat, a type and a date, never a name.
        assert.doesNotMatch(response.body, /05\d[- ]?\d/);
      });

      await t.test('files a lease declared as a lease', async () => {
        const body = upload(
          { unit: unitId, type: 'lease', tenancy: '' },
          // A filename with a household's name in it, which is exactly what arrives in practice —
          // and it must reach neither the path nor the row nor the screen.
          { filename: 'שכירות כהן.pdf', bytes: pdfBytes('lease one') },
        );
        const response = await lease.inject({
          method: 'POST',
          url: '/documents',
          ...body,
        });
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /המסמך נשמר/);
        assert.doesNotMatch(response.body, /כהן/);

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
        'the named lease is on the unit page and in search, as text not a link',
        async () => {
          const unitPage = await lease.inject({
            method: 'GET',
            url: `/estate/units/${unitId}`,
          });
          assert.equal(unitPage.statusCode, 200);
          assert.match(unitPage.body, /חוזה שכירות/);
          assert.match(unitPage.body, /gs:\/\/dona-v5-test-docs\//);
          assert.match(unitPage.body, /נמצאו כל הביטויים הקבועים של הטופס/);
          assert.doesNotMatch(unitPage.body, /href="gs:/);
          assert.doesNotMatch(unitPage.body, /storage\.googleapis\.com/);

          const found = await lease.inject({
            method: 'GET',
            url: `/estate/search?q=${encodeURIComponent('בניין מסמכים')}`,
          });
          assert.equal(found.statusCode, 200);
          assert.match(found.body, /מסמכים/);
          assert.match(found.body, /חוזה שכירות/);
          assert.match(found.body, new RegExp(`/estate/units/${unitId}`));
        },
      );

      await t.test(
        'refuses an ארנונה bill in the lease slot, and files nothing',
        async () => {
          const response = await arnona.inject({
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
          const response = await lease.inject({
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
        const response = await lease.inject({
          method: 'POST',
          url: '/documents',
          ...upload({ unit: unitId, type: 'lease' }, null),
        });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().code, 'invalid');
      });

      await t.test(
        'a malformed unit is invalid and a missing one is not_found',
        async () => {
          const malformed = await lease.inject({
            method: 'GET',
            url: '/documents/new?unit=not-an-id',
          });
          assert.equal(malformed.statusCode, 400);
          assert.equal(malformed.json().code, 'invalid');

          const missing = await lease.inject({
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
      if (unitId) {
        await pool
          .query(
            "DELETE FROM audit_log WHERE action = 'evidence.file_document' AND subject_id = $1",
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
      await pool.end();
    }
  });
});
