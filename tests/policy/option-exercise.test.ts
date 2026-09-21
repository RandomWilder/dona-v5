// POLICY CASE — an option exercise is not a turnover.
//
// #135. The Tenancy bound #124 drew exists so a previous household's paper
// cannot be reached from a current letting. Modelling an extension as a
// second tenancy row would give this household's own earlier paper the shape
// of somebody else's. The command must keep the letting's identity and leave
// the tenant's bag unchanged.
//
// Written red first against `exerciseOption` as it stood before #135: there
// was no command (the import failed), and a second-row model would have
// dropped the original Tenancy link from the bag.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  type IntakeDeps,
  searchPassages,
} from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import {
  inRolledBackTransaction,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import { exerciseOption } from '../../src/tenancy/contract.ts';
import { policyPool } from './support.ts';

const BUCKET = 'dona-v5-test-option-exercise';
const AT = new Date('2026-09-21T09:00:00.000Z');
const PAGE = 'דמי השכירות החודשיים הם 4,520 ש״ח';
const INITIAL_END = '2028-08-31';
const OPTION_END = '2031-08-31';

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

function deps(db: IntakeDeps['db']): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText([specimen('lease-standard.md')]),
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
  };
}

describe('policy · an option exercise is not a turnover', () => {
  it('keeps the letting and the same paper in the tenant bag', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await seedUnit(db);
        const tenancyId = await seedLetting(db, unitId);
        const documentId = await fileLeaseOnTenancy(db, unitId, tenancyId);
        const before = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          PAGE,
          'tenant',
          { kind: 'tenancy', id: tenancyId },
        );
        assert.equal(
          before.some((hit) => hit.documentId === documentId),
          true,
          "this household's lease must be in the bag before the exercise",
        );

        await exerciseOption(db, fixedClock(AT), {
          tenancyId,
          actor: 'ops@example.test',
        });

        const rows = await db.query<{ tenancy_id: string; n: string }>(
          `SELECT tenancy_id, count(*) OVER ()::text AS n
             FROM tenancy WHERE unit_id = $1`,
          [unitId],
        );
        assert.equal(rows.rows[0]?.n, '1');
        assert.equal(rows.rows[0]?.tenancy_id, tenancyId);

        const after = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          PAGE,
          'tenant',
          { kind: 'tenancy', id: tenancyId },
        );
        assert.equal(
          after.some((hit) => hit.documentId === documentId),
          true,
          'an extension is not a turnover: the same paper stays in the bag',
        );
      });
    } finally {
      await pool.end();
    }
  });
});

async function seedUnit(db: IntakeDeps['db']): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
    [
      buildingId,
      'option-exercise-test',
      `Option ${unitId}`,
      'Shoham',
      '2023-01-01',
      '2028-01-01',
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

async function seedLetting(
  db: IntakeDeps['db'],
  unitId: string,
): Promise<string> {
  const profileId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `option-exercise-${tenancyId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, option_end_date)
     VALUES ($1, $2, '2026-09-01', $3, 'ACTIVE', $4, $5)`,
    [tenancyId, unitId, INITIAL_END, profileId, OPTION_END],
  );
  return tenancyId;
}

async function fileLeaseOnTenancy(
  db: IntakeDeps['db'],
  unitId: string,
  tenancyId: string,
): Promise<string> {
  const filed = await fileDocument(
    {
      ...deps(db),
      pdf: createFakePdfText([specimen('lease-standard.md'), PAGE]),
    },
    {
      bytes: Buffer.from(`%PDF-1.4\n% tenancy-${tenancyId}\n`, 'latin1'),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: unitId },
      tenancyId,
    },
  );
  assert.equal(filed.filed, true);
  if (!filed.filed) throw new Error('expected a filed document');
  return filed.documentId;
}
