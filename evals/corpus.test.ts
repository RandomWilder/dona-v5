// The half of the corpus that can be proved without a key.
//
// `npm run evals` grades against the real provider, and nothing here replaces
// that. What these cases pin is the wiring underneath it -- the TEMP table, the
// insert, and that the order a search returns is pgvector's own -- against a
// real database with the kernel's deterministic fake embedder. Without them the
// first run of this file would be in CI, on a PR, against a paid endpoint.
//
// Skips without a database locally and fails under REQUIRE_POSTGRES=1, which is
// the `gate` job (src/kernel/pg-support.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeEmbedder } from '../src/kernel/embeddings.ts';
import { migratedPoolOrNull, skipReason } from '../src/kernel/pg-support.ts';
import { buildCorpus, groundingCutoff } from './corpus.ts';
import { specimenClauses } from './fixtures/specimen-clauses.ts';

// The width the real column is created at, so the fake stands where the real
// embedder stands rather than in a smaller space.
const fake = createFakeEmbedder(1536);

// A passage's own text embeds to its own vector exactly, so this question has
// one right answer and the assertions below are about ordering, not semantics.
const ownRepairs = specimenClauses.find((one) => one.ref === 'חוזה §7.2');

describe('the golden-set corpus', () => {
  it('indexes every passage and ranks by pgvector, not by insertion order', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const corpus = await buildCorpus(pool, fake);
    try {
      assert.equal(corpus.chunks, specimenClauses.length);
      assert.equal(corpus.describe, 'fake@1536');

      const hits = await corpus.search(ownRepairs!.body);
      assert.equal(hits.length, 8, 'the search window is eight');
      assert.equal(hits[0]?.clauseRef, ownRepairs!.ref);
      assert.ok(
        (hits[0]?.distance ?? 1) < 1e-6,
        'a passage searched by its own text is at distance zero',
      );
      const distances = hits.map((hit) => hit.distance);
      assert.deepEqual(
        distances,
        [...distances].sort((a, b) => a - b),
        'hits come back nearest first',
      );
    } finally {
      await corpus.close();
      await pool.end();
    }
  });

  it('refuses a question no passage is near, and never hands back its near-misses', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const corpus = await buildCorpus(pool, fake);
    try {
      const own = await corpus.ground({ message: ownRepairs!.body });
      assert.equal(own.source, 'lease');
      assert.equal(own.escalate, false);
      assert.equal(own.hits[0]?.ref, ownRepairs!.ref);

      // Under the fake embedder every unrelated string is far from everything,
      // which is exactly the shape a refusal has to handle.
      const nothing = await corpus.ground({
        message: 'מי זכה בגביע המדינה בכדורגל?',
      });
      assert.equal(nothing.source, 'none');
      assert.equal(nothing.escalate, true);
      assert.deepEqual(nothing.hits, [], 'a refusal cites nothing');

      const hits = await corpus.search('מי זכה בגביע המדינה בכדורגל?');
      assert.ok(
        (hits[0]?.distance ?? 0) > groundingCutoff,
        `the refusal must be the cutoff's doing: nearest was ${hits[0]?.distance}`,
      );
    } finally {
      await corpus.close();
      await pool.end();
    }
  });
});
