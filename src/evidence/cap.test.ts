// **The bound on the caller. Slice 5.2's third acceptance line.**
//
// 3.3 bounded a *request*: one file, twenty megabytes, four sniffed kinds. Nothing bounded a
// *caller*, so one poster could fill a versioned bucket this application is deliberately unable to
// empty (slice 3.2) one legal request at a time. 5.2 is the first slice with a caller to bound.
//
// **What is asserted is the fifty-first**, not the fifty. A cap tested only below its edge is a
// cap nobody has seen refuse anything. The rows are written straight into `audit_log` rather than
// by posting fifty documents, because what the cap counts *is* those rows — posting fifty files to
// prove that fifty rows are fifty would be testing the audit log twice and the cap once, slowly.
// The fifty-first goes through the route, which is the one that has to be refused.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import type { EstatePlan } from '../estate/contract.ts';
import { importEstate } from '../estate/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { applyDocumentTypeCatalogue } from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-10-04T06:00:00.000Z');
const CITY = 'עיר התקרה';
const ADDRESS = 'רחוב התקרה 1';
const PROJECT_CODE = 'TEST-CAP';
const STAFF_DOMAIN = 'evidence-cap.test';
const BUCKET = 'dona-v5-test-docs';
const BOUNDARY = '----donadomcap';

/** A specimen that passes the lease type's verification guard, so the cap is the only refusal. */
const leaseText =
  specimenDocuments.find((document) => document.file === 'lease-standard.md')
    ?.text ?? '';

const plan: EstatePlan = {
  projects: [
    {
      name: 'מכרז התקרה',
      projectCode: PROJECT_CODE,
      tenderRef: null,
      status: 'ACTIVE',
    },
  ],
  buildings: [
    {
      name: 'בניין התקרה',
      addressLine: ADDRESS,
      city: CITY,
      projectCode: PROJECT_CODE,
      handoverDate: '2025-03-01',
      warrantyEndDate: '2027-03-01',
      status: 'ACTIVE',
      spaces: [{ kind: 'UNIT', name: 'דירה 1', floor: '1', accessNote: null }],
      units: [
        {
          spaceName: 'דירה 1',
          unitNumber: '1',
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
};

function upload(
  fields: Record<string, string>,
  bytes: Buffer,
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
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    bytes,
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

/** One `evidence.file_document` line for this operator, as the route would have written it. */
async function pretendFiled(
  pool: import('pg').Pool,
  staffAccountId: string,
  at: Date,
  outcome: 'ok' | 'error',
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (id, at, actor_kind, actor_id, action, inputs, outcome)
     VALUES ($1, $2, 'staff', $3, 'evidence.file_document', '{}'::jsonb, $4)`,
    [newId(fixedClock(at)), at, staffAccountId, outcome],
  );
}

describe('evidence · the per-caller upload cap', () => {
  it('refuses the fifty-first upload from one operator, and files nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const objects = createMemoryStore();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      objects,
      pdf: createFakePdfText([leaseText]),
      bucket: BUCKET,
    });
    try {
      await signOutAll(pool, STAFF_DOMAIN);
      await pool.query(
        "DELETE FROM audit_log WHERE action = 'evidence.file_document' AND actor_id IS NULL",
      );
      await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
      await importEstate(pool, plan);
      const found = await pool.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u
           JOIN space s ON s.space_id = u.unit_id
           JOIN building b ON b.building_id = s.building_id
          WHERE b.city = $1 AND b.address_line = $2`,
        [CITY, ADDRESS],
      );
      const unitId = found.rows[0]?.unit_id ?? '';
      assert.ok(unitId);

      const who = await signIn(pool, clock, { email: `ops@${STAFF_DOMAIN}` });
      const other = await signIn(pool, clock, {
        email: `other@${STAFF_DOMAIN}`,
      });

      const post = (
        session: { cookie: string; csrf: string },
        marker: string,
      ) =>
        app.inject({
          method: 'POST',
          url: '/documents',
          ...upload(
            {
              csrf: session.csrf,
              unit: unitId,
              type: 'lease',
              tenancy: '',
            },
            Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1'),
          ),
          headers: {
            ...upload({}, Buffer.alloc(0)).headers,
            cookie: session.cookie,
          },
        });

      // Forty-nine filed and one refused: **both count**, because the bound is on what reached
      // intake and not on what survived it. That is what puts this caller on exactly fifty.
      const hourAgo = new Date(AT.getTime() - 60 * 60 * 1000);
      for (let n = 0; n < 49; n += 1) {
        await pretendFiled(pool, who.staffAccountId, hourAgo, 'ok');
      }
      await pretendFiled(pool, who.staffAccountId, hourAgo, 'error');

      const refused = await post(who, `cap-${Date.now()}`);
      assert.equal(refused.statusCode, 429);
      assert.deepEqual(refused.json(), {
        code: 'too_many',
        message: 'too many documents filed today',
      });

      // Nothing was written: no object, no row, and not even the audit line the route writes when
      // it files — the cap refuses before intake is called at all.
      const filed = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE actor_id = $1 AND action = 'evidence.file_document'`,
        [who.staffAccountId],
      );
      assert.equal(filed.rows[0]?.n, '50', 'the refusal wrote a filing line');

      // **The cap is per caller and not per system.** A second operator at zero is unaffected,
      // which is the difference between a bound on a person and an outage.
      const served = await post(other, `cap-other-${Date.now()}`);
      assert.notEqual(served.statusCode, 429);

      // **And the window rolls.** The same rows, dated over a day ago, do not count.
      await pool.query(
        `UPDATE audit_log SET at = $2
          WHERE actor_id = $1 AND action = 'evidence.file_document'`,
        [who.staffAccountId, new Date(AT.getTime() - 25 * 60 * 60 * 1000)],
      );
      const later = await post(who, `cap-rolled-${Date.now()}`);
      assert.notEqual(later.statusCode, 429);
    } finally {
      await pool.query(
        `DELETE FROM audit_log WHERE action = 'evidence.file_document'
           AND actor_id IN (
             SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
        [`%@${STAFF_DOMAIN}`],
      );
      await pool.query(
        `DELETE FROM document_link WHERE document_id IN (
           SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET}/%`],
      );
      await pool.query(
        `DELETE FROM extracted_field WHERE document_id IN (
           SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${BUCKET}/%`],
      );
      await pool.query(`DELETE FROM document WHERE storage_uri LIKE $1`, [
        `gs://${BUCKET}/%`,
      ]);
      await pool.query(
        `DELETE FROM unit WHERE unit_id IN (
           SELECT space_id FROM space s JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2)`,
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
        PROJECT_CODE,
      ]);
      await signOutAll(pool, STAFF_DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
