// Search over the passage store. Ticket #104: a required stance, hits that carry
// the document, page, text, type and anchored flat, identifiers masked only on
// the tenant read. Distances order the list and are never asserted on.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  listDocumentPassages,
  type RetrievalBound,
  searchPassages,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const BUCKET = 'dona-v5-test-search';
const AT = new Date('2026-09-15T09:00:00.000Z');
const RENT = '4,520';
const PORTFOLIO: RetrievalBound = { kind: 'portfolio' };

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

function deps(db: PoolClient, text: string[]): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText(text),
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
  };
}

async function fileLease(
  db: PoolClient,
  extraPages: string[],
  unitId = newId(),
): Promise<{ documentId: string; unitId: string }> {
  await applyDocumentTypeCatalogue(db, seedDocumentTypes);
  const pages = [specimen('lease-standard.md'), ...extraPages];
  const result = await fileDocument(deps(db, pages), {
    bytes: pdfBytes(`search-${newId()}`),
    typeKey: 'lease',
    place: { kind: 'UNIT', id: unitId },
    tenancyId: null,
  });
  assert.equal(result.filed, true);
  if (!result.filed) throw new Error('expected a filed document');
  return { documentId: result.documentId, unitId };
}

describe('evidence · search over passages', () => {
  it('returns the document, page, text, type and anchored flat', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const page = `דמי השכירות ${RENT} ש״ח`;
        const { documentId, unitId } = await fileLease(db, [page]);
        const embedder = createFakeEmbedder(embeddingColumnDimensions);
        const hits = await searchPassages(
          db,
          embedder,
          page,
          'administrator',
          PORTFOLIO,
        );
        const hit = hits.find((row) => row.documentId === documentId);
        assert.ok(hit, 'the filed document is in the result');
        assert.equal(hit.page, 2);
        assert.equal(hit.text, page);
        assert.equal(hit.documentType, 'lease');
        assert.equal(hit.unitId, unitId);
        assert.equal('distance' in hit, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('returns a printed rent with its document and page', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const page = `דמי השכירות החודשיים הם ${RENT} ש״ח`;
        const { documentId } = await fileLease(db, [page]);
        const hits = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          page,
          'administrator',
          PORTFOLIO,
        );
        assert.equal(hits[0]?.documentId, documentId);
        assert.equal(hits[0]?.page, 2);
        assert.match(hits[0]?.text ?? '', new RegExp(RENT));
      });
    } finally {
      await pool.end();
    }
  });

  it('masks identifiers for the tenant and leaves the stored passage as printed', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const identifier = '312345678';
        const page = `ת.ז. ${identifier}`;
        const { documentId, unitId } = await fileLease(db, [page]);
        const embedder = createFakeEmbedder(embeddingColumnDimensions);
        const bound: RetrievalBound = { kind: 'unit', id: unitId };
        const admin = await searchPassages(
          db,
          embedder,
          page,
          'administrator',
          bound,
        );
        const tenant = await searchPassages(
          db,
          embedder,
          page,
          'tenant',
          bound,
        );
        const adminHit = admin.find((row) => row.documentId === documentId);
        const tenantHit = tenant.find((row) => row.documentId === documentId);
        assert.equal(adminHit?.text, page);
        assert.equal(tenantHit?.text.includes(identifier), false);
        assert.match(tenantHit?.text ?? '', /ת\.ז\./);
        const stored = await listDocumentPassages(db, documentId);
        assert.equal(stored[1]?.body, page);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not write a disclosure line for either stance', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const page = `ת.ז. 312345678`;
        const { documentId, unitId } = await fileLease(db, [page]);
        const bound: RetrievalBound = { kind: 'unit', id: unitId };
        await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          page,
          'administrator',
          bound,
        );
        await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          page,
          'tenant',
          bound,
        );
        const afterSearch = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'evidence.read_identifier'
              AND inputs->>'documentId' = $1`,
          [documentId],
        );
        assert.equal(afterSearch.rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });

  it("a Unit bound omits a neighbour Unit's nearer Passage", async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const answering = `דמי השכירות החודשיים הם ${RENT} ש״ח — יחידת השכן`;
        const home = await fileLease(db, ['דף אחר בבית']);
        const neighbour = await fileLease(db, [answering]);
        const hits = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          answering,
          'administrator',
          { kind: 'unit', id: home.unitId },
        );
        assert.equal(
          hits.some((hit) => hit.documentId === neighbour.documentId),
          false,
        );
        assert.equal(
          hits.some((hit) => hit.documentId === home.documentId),
          true,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('a Unit bound includes a Passage linked only through a Tenancy of that Unit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedListedUnit(db);
        const tenancyId = await seedListedTenancy(db, unitId);
        const page = `דמי השכירות ${RENT} ש״ח`;
        const { documentId } = await fileLease(db, [page], unitId);
        await db.query(
          `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
           VALUES ($1, 'TENANCY', $2, 'EVIDENCE')
           ON CONFLICT (document_id, entity_type, entity_id) DO NOTHING`,
          [documentId, tenancyId],
        );
        await db.query(
          `DELETE FROM document_link
            WHERE document_id = $1 AND entity_type = 'UNIT'`,
          [documentId],
        );
        const hits = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          page,
          'administrator',
          { kind: 'unit', id: unitId },
        );
        const hit = hits.find((row) => row.documentId === documentId);
        assert.ok(hit, 'the Tenancy-linked Passage is in the Unit bound');
        assert.equal(hit.unitId, unitId);
      });
    } finally {
      await pool.end();
    }
  });
});

async function seedListedUnit(db: PoolClient): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
    [
      buildingId,
      'bound-test',
      `Bound ${unitId}`,
      'Shoham',
      '2026-01-01',
      '2027-01-01',
    ],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, '1'],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '1', 3.5, true, 'READY')`,
    [unitId],
  );
  return unitId;
}

async function seedListedTenancy(
  db: PoolClient,
  unitId: string,
): Promise<string> {
  const profileId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, 'bound-test'],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
    [tenancyId, unitId, '2026-01-01', '2027-01-01', profileId],
  );
  return tenancyId;
}
