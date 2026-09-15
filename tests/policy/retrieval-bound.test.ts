// POLICY CASE — every passage search names a retrieval bound.
//
// #112. Search over Passages is deterministic about *which documents are in
// the bag*. A missing bound is a whole-store search by omission, and a tenant
// stance on a Building or portfolio bound is a neighbour's contract riding an
// office-wide bag. Neither is something a model may decide, so the case lives
// here rather than in evals.
//
// Written red first against `searchPassages` as it stood at #104: stance
// required, bound absent. The source assertions failed (no `RetrievalBound`);
// the command assertions failed (undefined bound was accepted; tenant +
// Building / portfolio returned hits).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
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
import { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import {
  inRolledBackTransaction,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import { policyPool } from './support.ts';

const SEARCH_TS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'evidence',
  'internal',
  'search.ts',
);

const BUCKET = 'dona-v5-test-retrieval-bound';
const AT = new Date('2026-09-16T09:00:00.000Z');
const PORTFOLIO = { kind: 'portfolio' } as const;

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

describe('policy · passage search names a retrieval bound', () => {
  it('requires the bound the way it already requires the stance', async () => {
    const source = await readFile(SEARCH_TS, 'utf8');
    assert.match(source, /bound: RetrievalBound/);
    assert.doesNotMatch(source, /bound\?:/);
    assert.doesNotMatch(source, /bound\s*=\s*\{/);
  });

  it('refuses a search that omits the bound', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await assert.rejects(
          () =>
            searchPassages(
              db,
              createFakeEmbedder(embeddingColumnDimensions),
              'כמה דמי שכירות?',
              'administrator',
              undefined as never,
            ),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            /retrieval bound/.test(error.message),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a Building or portfolio bound asked with tenant stance', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const embedder = createFakeEmbedder(embeddingColumnDimensions);
        const building = { kind: 'building', id: newId() } as never;
        await assert.rejects(
          () => searchPassages(db, embedder, 'שאלה', 'tenant', building),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_allowed',
        );
        await assert.rejects(
          () => searchPassages(db, embedder, 'שאלה', 'tenant', PORTFOLIO),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_allowed',
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("does not return another Unit's Passage from a Unit bound", async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const home = newId();
        const neighbour = newId();
        const answering = 'דמי השכירות החודשיים הם 4,520 ש״ח — יחידת השכן';
        const wired = {
          ...deps(db),
          pdf: createFakePdfText([specimen('lease-standard.md'), answering]),
        };
        const theirs = await fileDocument(wired, {
          bytes: Buffer.from(`%PDF-1.4\n% neighbour-${neighbour}\n`, 'latin1'),
          typeKey: 'lease',
          place: { kind: 'UNIT', id: neighbour },
          tenancyId: null,
        });
        assert.equal(theirs.filed, true);
        if (!theirs.filed) return;
        await fileDocument(
          {
            ...wired,
            pdf: createFakePdfText([
              specimen('lease-standard.md'),
              'דף אחר בבית',
            ]),
          },
          {
            bytes: Buffer.from(`%PDF-1.4\n% home-${home}\n`, 'latin1'),
            typeKey: 'lease',
            place: { kind: 'UNIT', id: home },
            tenancyId: null,
          },
        );
        const hits = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          answering,
          'administrator',
          { kind: 'unit', id: home },
        );
        assert.equal(
          hits.some((hit) => hit.documentId === theirs.documentId),
          false,
          "the neighbour Unit's answering Passage must not be in the bag",
        );
      });
    } finally {
      await pool.end();
    }
  });
});
