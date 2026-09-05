import { migratedPoolOrNull } from '../src/kernel/pg-support.ts';
import { buildCorpus, type Corpus, embeddingsConfigured } from './corpus.ts';
import { formatReport, loadCases, runCases } from './runner.ts';
import { placeholderSubject } from './subject.ts';

// CI entry point (`npm run evals`). Non-zero exit blocks the merge, exactly
// like a failing test -- docs/pipeline.md §5.

const cases = await loadCases();
const wantsCorpus = cases.some(
  (golden) => golden.retrieval || golden.grounding,
);

const keyed = embeddingsConfigured();

// The same argument REQUIRE_POSTGRES makes, for the other half of what a
// retrieval case needs. Without a key the corpus cases skip, which is right on
// a clean clone and a lie in CI: the gate would pass by grading nothing.
//
// Checked before the pool is opened, so the loud exit does not leave one behind.
if (wantsCorpus && !keyed && process.env.REQUIRE_EMBEDDINGS === '1') {
  console.error(
    'REQUIRE_EMBEDDINGS=1 but OPENAI_API_KEY is not set — ' +
      'the corpus cases would have been skipped, not passed.',
  );
  process.exit(1);
}

// REQUIRE_POSTGRES is honoured inside this call, as the durability suite's is:
// no database locally means skip, and `=1` means fail. Reported as one line
// rather than as a stack, because the message is the finding.
let pool = null;
try {
  pool = wantsCorpus && keyed ? await migratedPoolOrNull() : null;
} catch (error) {
  console.error(
    `the golden set could not reach a database: ${
      error instanceof Error ? error.message : 'unknown'
    }`,
  );
  process.exit(1);
}

let corpus: Corpus | null = null;
if (pool) {
  corpus = await buildCorpus(pool);
  console.log(
    `corpus: ${corpus.chunks} passages indexed · embedder ${corpus.describe}`,
  );
}

const report = await runCases(cases, {
  answer: placeholderSubject,
  retrieve: corpus?.retrieve,
  ground: corpus?.ground,
});
console.log(formatReport(report));
await corpus?.close();
await pool?.end();
if (report.failed > 0) process.exitCode = 1;
