import { migratedPoolOrNull } from '../src/kernel/pg-support.ts';
import {
  buildCorpus,
  type CorpusHit,
  embeddingsConfigured,
  groundingCutoff,
} from './corpus.ts';
import { specimenRefs } from './fixtures/specimen-clauses.ts';

// The instrument, and not the gate. `npm run evals` decides whether a merge is
// allowed; this prints the numbers that decide what a case should *say*
// (docs/pipeline.md §7).
//
// It answers the two questions a ratchet and a refusal rule are set from:
//
//   1. Where does the answering passage actually come back, and by how much
//      does it beat its nearest competitor? A lead inside the embedder's own
//      run-to-run jitter is a coin flip in CI, not a rank.
//   2. **Does distance separate at all?** Is there any cutoff that admits the
//      answering passage and rejects a question the corpus cannot answer? A
//      refusal rule is a cutoff, so it lives or dies on this number.
//
// Output is markdown, to be read once and pasted into tasks/evidence/.

interface Probe {
  question: string;
  /** The passage that answers it, or null when nothing should. */
  expect: string | null;
}

const probes: Probe[] = [
  // The retrieval case's own question comes first, because an instrument that
  // measures a question the gate does not assert measures the wrong thing.
  {
    question: 'מי מתקן דוד מים שהתקלקל מבלאי?',
    expect: specimenRefs.ownerRepairs,
  },
  {
    question: 'מי אחראי על תיקון דוד המים בדירה?',
    expect: specimenRefs.ownerRepairs,
  },
  {
    question: 'מי משלם על נזק שגרמתי לדלת?',
    expect: specimenRefs.tenantDamage,
  },
  { question: 'מי מתקן תקלה בחדר המדרגות?', expect: specimenRefs.commonParts },
  { question: 'באילו שעות המשרד פתוח?', expect: specimenRefs.officeHours },
  {
    question: 'כיצד מדווחים על תקלה שאינה דחופה?',
    expect: specimenRefs.reportFault,
  },
  // The refusal probes: questions nothing in either corpus answers. A cutoff
  // tuned only on questions that have answers has never been asked to say no.
  { question: 'מי זכה בגביע המדינה בכדורגל?', expect: null },
  { question: 'מה מזג האוויר מחר בתל אביב?', expect: null },
];

if (!embeddingsConfigured()) {
  console.error('OPENAI_API_KEY is not set — there is nothing to measure.');
  process.exit(1);
}

const pool = await migratedPoolOrNull();
if (!pool) {
  console.error('no database — npm run db:up');
  process.exit(1);
}

const corpus = await buildCorpus(pool);
console.log(`# golden-set measurement\n`);
console.log(`corpus: ${corpus.chunks} passages · embedder ${corpus.describe}`);
console.log(`grounding cutoff in force: ${groundingCutoff}\n`);

console.log('| question | expected | rank | distance | lead over next |');
console.log('|---|---|---|---|---|');
for (const probe of probes) {
  const hits = await corpus.search(probe.question);
  const at = hits.findIndex((hit) => hit.clauseRef === probe.expect);
  const top = hits[0];
  const lead = leadOf(hits);
  console.log(
    `| ${probe.question} | ${probe.expect ?? '— (refusal)'} | ` +
      `${probe.expect === null ? `top ${top?.clauseRef ?? '—'}` : at + 1} | ` +
      `${(probe.expect === null ? top?.distance : hits[at]?.distance)?.toFixed(4) ?? '—'} | ` +
      `${lead?.toFixed(4) ?? '—'} |`,
  );
}

console.log(`\n## every result set, in order\n`);
for (const probe of probes) {
  const hits = await corpus.search(probe.question);
  console.log(`**${probe.question}**`);
  for (const [at, hit] of hits.entries()) {
    const admitted = hit.distance <= groundingCutoff ? '' : '  ← beyond cutoff';
    console.log(
      `  ${at + 1}. ${hit.clauseRef} (${hit.source}) ${hit.distance.toFixed(4)}${admitted}`,
    );
  }
  console.log('');
}

await corpus.close();
await pool.end();

/** How far the winner beat the runner-up, which is what makes a rank stable. */
function leadOf(hits: CorpusHit[]): number | undefined {
  const [first, second] = hits;
  if (!first || !second) return undefined;
  return second.distance - first.distance;
}
