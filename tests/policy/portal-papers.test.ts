// POLICY — a tenant sees the documents bound to their tenancy, and a document
// of another tenancy, or of the unit, or of the building, is not found by its
// identifier. Opening and downloading the file are audit rows. #280.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import {
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
} from '../../src/evidence/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore, devBucketName } from '../../src/kernel/objects.ts';
import { asTenant } from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T08:00:00.000Z');
const HOST = 'tenant.localhost';
const PHONES = ['+972520002801', '+972520002802'] as const;
const [MINE, OTHER] = PHONES;

function pdf(mark: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${mark}\n%%EOF\n`);
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log
      WHERE subject_id IN (
        SELECT d.document_id::text
          FROM document d
          JOIN document_type dt ON dt.document_type_id = d.document_type_id
         WHERE dt.type_key LIKE 'p280_%'
      )
      OR actor_id IN (
        SELECT portal_identity_id::text FROM portal_identity WHERE phone = ANY($1::text[])
      )
      OR subject_id IN (
        SELECT party_id::text FROM party_contact WHERE value = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM document_link
      WHERE document_id IN (
        SELECT d.document_id
          FROM document d
          JOIN document_type dt ON dt.document_type_id = d.document_type_id
         WHERE dt.type_key LIKE 'p280_%'
      )`,
  );
  await pool.query(
    `DELETE FROM document
      WHERE document_type_id IN (
        SELECT document_type_id FROM document_type WHERE type_key LIKE 'p280_%'
      )`,
  );
  await pool.query(`DELETE FROM document_type WHERE type_key LIKE 'p280_%'`);
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_opt_in
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_session
      WHERE portal_identity_id IN (
        SELECT portal_identity_id FROM portal_identity WHERE phone = ANY($1::text[])
      )`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM portal_identity WHERE phone = ANY($1::text[])`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = ANY($1::text[]))`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 280%'
      )`,
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = ANY($1::text[])
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [PHONES],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city LIKE 'פורטל 280%'
      )`,
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city LIKE 'פורטל 280%')`,
  );
  await pool.query(`DELETE FROM building WHERE city LIKE 'פורטל 280%'`);
}

async function place(
  pool: Pool,
  spec: { phone: string; unit: string; line: string; city: string },
): Promise<{ tenancyId: string; unitId: string; buildingId: string }> {
  const seeded = await seedOccupancy(pool, spec.unit, {
    phone: spec.phone,
    contactFrom: '2026-01-01',
    contactTo: null,
    tenancyFrom: '2026-03-01',
    tenancyTo: '2027-02-28',
    address: { line: spec.line, city: spec.city },
  });
  const building = await pool.query<{ building_id: string }>(
    `SELECT building_id FROM space WHERE space_id = $1`,
    [seeded.unitId],
  );
  const buildingId = building.rows[0]?.building_id;
  assert.ok(buildingId);
  await pool.query(
    `UPDATE building SET portal_enabled = true WHERE building_id = $1`,
    [buildingId],
  );
  return { tenancyId: seeded.tenancyId, unitId: seeded.unitId, buildingId };
}

async function file(
  pool: Pool,
  objects: ReturnType<typeof createMemoryStore>,
  spec: {
    typeKey: string;
    label: string;
    place: 'UNIT' | 'BUILDING';
    placeId: string;
    link: 'TENANCY' | 'UNIT' | 'BUILDING';
    linkId: string;
    mark: string;
  },
): Promise<string> {
  const bytes = pdf(spec.mark);
  const hash = documentFileHash(bytes);
  const path = documentObjectPath({
    place: { kind: spec.place, id: spec.placeId },
    typeKey: spec.typeKey,
    fileHash: hash,
    extension: 'pdf',
  });
  await objects.put(path, bytes, 'application/pdf');
  const type = await pool.query<{ document_type_id: string }>(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, $3, NULL, NULL, true)
     ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
     RETURNING document_type_id`,
    [newId(), spec.typeKey, spec.label],
  );
  const documentId = newId();
  await pool.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
    [
      documentId,
      type.rows[0]?.document_type_id,
      documentStorageUri(devBucketName, path),
      hash,
      new Date('2026-09-01T12:00:00Z'),
    ],
  );
  await pool.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, $2, $3, 'EVIDENCE')`,
    [documentId, spec.link, spec.linkId],
  );
  return documentId;
}

describe('policy · my papers', { concurrency: 1 }, () => {
  it('shows tenancy documents and does not find a unit, building or other tenancy file', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const objects = createMemoryStore();
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
      objects,
      bucket: devBucketName,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });

    const mine = await place(pool, {
      phone: MINE,
      unit: '12',
      line: 'רחוב 280 אלף',
      city: 'פורטל 280א',
    });
    const other = await place(pool, {
      phone: OTHER,
      unit: '3',
      line: 'רחוב 280 בית',
      city: 'פורטל 280ב',
    });
    const lease = await file(pool, objects, {
      typeKey: 'p280_lease',
      label: 'חוזה שכירות',
      place: 'UNIT',
      placeId: mine.unitId,
      link: 'TENANCY',
      linkId: mine.tenancyId,
      mark: 'lease',
    });
    await pool.query(
      `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
       VALUES ($1, 'UNIT', $2, 'SUBJECT')`,
      [lease, mine.unitId],
    );
    const unitOnly = await file(pool, objects, {
      typeKey: 'p280_unit',
      label: 'תיק דירה',
      place: 'UNIT',
      placeId: mine.unitId,
      link: 'UNIT',
      linkId: mine.unitId,
      mark: 'unit',
    });
    const buildingOnly = await file(pool, objects, {
      typeKey: 'p280_building',
      label: 'תיק בניין',
      place: 'BUILDING',
      placeId: mine.buildingId,
      link: 'BUILDING',
      linkId: mine.buildingId,
      mark: 'building',
    });
    const theirs = await file(pool, objects, {
      typeKey: 'p280_other',
      label: 'נספח של אחר',
      place: 'UNIT',
      placeId: other.unitId,
      link: 'TENANCY',
      linkId: other.tenancyId,
      mark: 'other',
    });

    const tenant = await asTenant(app, '052-000-2801', sender, {
      remoteAddress: '10.280.0.1',
    });
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /המסמכים שלי/);
    assert.match(
      home.body,
      new RegExp(`href="/flat/${mine.tenancyId}#documents"`),
    );

    const flat = await tenant.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}`,
    });
    assert.equal(flat.statusCode, 200);
    assert.match(flat.body, /id="documents"/);
    assert.match(flat.body, /חוזה שכירות/);
    assert.match(flat.body, />PDF</);
    assert.match(
      flat.body,
      new RegExp(
        `class="tp-row tp-doc" href="/flat/${mine.tenancyId}/documents/${lease}"`,
      ),
    );
    assert.doesNotMatch(flat.body, /תיק דירה/);
    assert.doesNotMatch(flat.body, /תיק בניין/);
    assert.doesNotMatch(flat.body, /נספח של אחר/);
    assert.equal(flat.body.split('חוזה שכירות').length - 1, 1);

    const opened = await tenant.inject({
      method: 'GET',
      url: `/flat/${mine.tenancyId}/documents/${lease}`,
    });
    assert.equal(opened.statusCode, 200);
    assert.match(String(opened.headers['content-type']), /application\/pdf/);
    assert.match(String(opened.headers['content-disposition']), /attachment/);
    assert.match(opened.body, /^%PDF-1\.4/);

    const audits = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log
        WHERE subject_id = $1 AND outcome = 'ok'
        ORDER BY action`,
      [lease],
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action),
      ['portal.download_document', 'portal.open_document'],
    );

    for (const foreignId of [unitOnly, buildingOnly, theirs]) {
      const missed = await tenant.inject({
        method: 'GET',
        url: `/flat/${mine.tenancyId}/documents/${foreignId}`,
        headers: { host: HOST },
      });
      assert.equal(missed.statusCode, 404);
      assert.match(missed.body, /לא נמצא/);
      assert.doesNotMatch(missed.body, /תיק דירה|תיק בניין|נספח של אחר/);
      const foreignAudits: { rows: { n: number }[] } = await pool.query(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE subject_id = $1
            AND action IN ('portal.open_document', 'portal.download_document')`,
        [foreignId],
      );
      assert.equal(foreignAudits.rows[0]?.n, 0);
    }
  });
});
