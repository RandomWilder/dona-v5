// POLICY CASE — a turn that finds the record and the paper disagreeing writes nothing but its turn.
//
// #229. When the Unit record says 82 m² and the lease prints 85 m², the office turn shows both and
// names the record's as current. It never chooses between them and never corrects either: the
// record changes only through estate's governed paths, and "flag this for correction" is out of
// scope (#226). Whether a disagreement gets written anywhere is not a judgement a model may make,
// so the case lives here. The only rows the turn may move are its own on the office retrieval
// thread, and the access line scope writes for the parties the record read.
//
// Written red first: with an `UPDATE unit SET area_sqm` added to `runOfficeTurn` after the answer,
// the case failed naming `unit`; with a `disagreement.flagged` audit line added, it failed naming
// that action.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  runOfficeTurn,
} from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import {
  createFakeExtractor,
  type ExtractionRequest,
} from '../../src/kernel/extraction.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-16T09:00:00.000Z');
const PRINTED = 'שטח הדירה המושכרת 85 מ״ר.';

/** Inserts, updates and deletes per table, so far in this transaction. */
async function writesThisTransaction(
  db: PoolClient,
): Promise<Record<string, string>> {
  const { rows } = await db.query<{ relname: string; moved: string }>(
    `SELECT relname, concat_ws(':', n_tup_ins, n_tup_upd, n_tup_del) AS moved
       FROM pg_stat_xact_user_tables`,
  );
  return Object.fromEntries(rows.map((row) => [row.relname, row.moved]));
}

async function fileLease(db: PoolClient, unitId: string): Promise<void> {
  const clock = fixedClock(AT);
  const lease = specimenDocuments.find(
    (document) => document.file === 'lease-standard.md',
  );
  if (!lease) throw new Error('lease-standard.md is not in the corpus');
  await applyDocumentTypeCatalogue(db, seedDocumentTypes);
  const filed = await fileDocument(
    {
      db,
      objects: createMemoryStore(),
      pdf: createFakePdfText([lease.text, PRINTED]),
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      audit: createAuditLog(db, clock),
      clock,
      bucket: 'dona-v5-test-disagreement',
    },
    {
      bytes: Buffer.from(`%PDF-1.4\n% disagreement-${newId()}\n`, 'latin1'),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: unitId },
      tenancyId: null,
    },
  );
  assert.equal(filed.filed, true);
}

/** Answers with both values, citing the record and the page that prints 85. */
const bothValues = createFakeExtractor((request: ExtractionRequest) => {
  const passages = request.input.split('PASSAGES:')[1] ?? '';
  const at = passages
    .split(/\n\n(?=\[\d+\])/)
    .findIndex((one) => one.includes('85 מ״ר'));
  return {
    answers: true,
    text: 'הערך הנוכחי: 82 מ״ר. בחוזה: 85 מ״ר.',
    hit_indexes: [at + 1],
    cites_record: true,
  };
});

describe('policy · a record-and-paper disagreement writes nothing but the turn', () => {
  it('moves only the office thread and scope’s access line', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await seedOccupancy(db, '82', {
          phone: '+972500000082',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        await db.query('UPDATE unit SET area_sqm = 82 WHERE unit_id = $1', [
          unitId,
        ]);
        await fileLease(db, unitId);
        const { account } = await addOperator(db, fixedClock(AT), {
          email: `${newId()}@office.test`,
          role: 'OPERATOR',
        });

        const before = await writesThisTransaction(db);
        const result = await runOfficeTurn(
          {
            db,
            clock: fixedClock(AT),
            extractor: bothValues,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            model: 'fake-office-turn',
          },
          {
            staffAccountId: account.staffAccountId,
            bound: { kind: 'unit', id: unitId },
            question: PRINTED,
          },
        );
        const after = await writesThisTransaction(db);

        assert.equal(result.refused, false);
        assert.equal(result.citations.length, 2, 'both citations kept');
        const moved = Object.keys(after)
          .filter((table) => after[table] !== before[table])
          .sort();
        assert.deepEqual(moved, [
          'audit_log',
          'office_retrieval_thread',
          'office_retrieval_turn',
        ]);
        const { rows } = await db.query<{ action: string }>(
          `SELECT DISTINCT action FROM audit_log
            WHERE actor_id = $1 AND at = $2`,
          [account.staffAccountId, AT],
        );
        assert.deepEqual(
          rows.map((row) => row.action),
          ['scope.resolve_unit_occupants'],
        );
      });
    } finally {
      await pool.end();
    }
  });
});
