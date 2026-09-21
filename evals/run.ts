import { systemClock, today } from '../src/kernel/clock.ts';
import {
  createSettings,
  readExtractionSettings,
} from '../src/kernel/config.ts';
import { createConfiguredExtractor } from '../src/kernel/extraction.ts';
import { migratedPoolOrNull } from '../src/kernel/pg-support.ts';
import { buildCorpus, type Corpus, embeddingsConfigured } from './corpus.ts';
import {
  formatExtractionReport,
  runExtractionGoldenSet,
} from './extraction.ts';
import { formatReport, loadCases, runCases } from './runner.ts';
import { officeTurnSubject, placeholderSubject } from './subject.ts';

// CI entry point (`npm run evals`). Non-zero exit blocks the merge, exactly
// like a failing test -- docs/pipeline.md §5.

const cases = await loadCases();
const wantsCorpus = cases.some(
  (golden) => golden.retrieval || golden.grounding || golden.expect,
);

const keyed = embeddingsConfigured();

// The same argument REQUIRE_POSTGRES makes, for the other half of what a
// retrieval case needs. Without a key the corpus cases skip, which is right on
// a clean clone and a lie in CI: the gate would pass by grading nothing.
//
// Behavioural cases now grade the office turn, which needs the same embedder
// (to rank this turn's Passages) and the answering model.
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
//
// **Both halves want it now**, and the extraction half wants it for a different
// reason: not to index a corpus but to read the catalogue, because which field
// keys are declared today is a row and never a constant (A8). So the condition
// is either half wanting it, and not the corpus alone (ticket #127).
let pool = null;
try {
  pool = keyed ? await migratedPoolOrNull() : null;
} catch (error) {
  console.error(
    `the golden set could not reach a database: ${
      error instanceof Error ? error.message : 'unknown'
    }`,
  );
  process.exit(1);
}

const extraction = pool
  ? await readExtractionSettings(createSettings(pool))
  : null;

// **The extraction golden set. Ticket #127, and the first number this module has for how well it
// reads.** It wants what the corpus cases want — a key and a database — plus a capture of each
// specimen, which is never in this repository. Absent any of the three it says which and grades
// nothing: an unread specimen is not a measured zero (`ocr:sweep`'s argument).
//
// **Before the corpus is built, and that ordering is deliberate.** This half needs the answering
// model and not the embedder, and building the corpus is where an embedding call can throw the
// whole run away — which is exactly what a rejected key did the first time this was measured. Two
// independent halves should not be able to take each other down, and the half that costs one call
// per specimen goes first.
let extractionFailed = 0;
if (extraction && pool) {
  const run = await runExtractionGoldenSet({
    db: pool,
    extractor: createConfiguredExtractor(),
    model: extraction.model,
    reasoningEffort: extraction.reasoningEffort,
    on: today(systemClock),
  });
  console.log(
    `extraction: model ${extraction.model} · reasoning ${extraction.reasoningEffort ?? 'unset'}`,
  );
  for (const why of run.skipped) {
    console.log(`  ○ ${why}`);
  }
  if (run.score) {
    console.log(formatExtractionReport(run.score, run.ratchet));
    extractionFailed = run.failures.length;
  }
} else {
  console.log(
    'extraction: not run — the golden set needs OPENAI_API_KEY and a database.',
  );
}

let corpus: Corpus | null = null;
if (pool) {
  corpus = await buildCorpus(pool);
  console.log(
    `corpus: ${corpus.chunks} passages indexed · embedder ${corpus.describe}`,
  );
}

const report = await runCases(cases, {
  answer:
    corpus && extraction
      ? officeTurnSubject({
          corpus,
          extractor: createConfiguredExtractor(),
          model: extraction.model,
          reasoningEffort: extraction.reasoningEffort,
        })
      : placeholderSubject,
  retrieve: corpus?.retrieve,
  ground: corpus?.ground,
});
console.log(formatReport(report));
await corpus?.close();
await pool?.end();
// Both halves block the merge, and each says which it was. An extraction failure is a value the
// reader invented, an identity the paper refuses, or accuracy below the ratchet — never a miss on
// its own, which moves a percentage and nothing else.
if (report.failed > 0 || extractionFailed > 0) process.exitCode = 1;
