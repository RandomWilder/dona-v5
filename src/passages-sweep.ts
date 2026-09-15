// Ticket #105's sweep of filed documents that have no passages.
//
//   npm run passages:sweep
//
// Same standing practice as ocr:sweep: run on staging as a Cloud Run job from
// the serving image, as app-staging, so the embedder, the bucket and the
// database are the ones the revision uses. A local run without OPENAI_API_KEY
// prints NOT RUN rather than reporting a sweep of zero — zero is a measured
// count, and an unconfigured embedder is not a measurement of that backlog.
import { sweepMissingPassages } from './evidence/contract.ts';
import {
  createSettings,
  readEmbeddingSettings,
  readOcrSettings,
} from './kernel/config.ts';
import { createPool } from './kernel/db.ts';
import { createConfiguredEmbedder } from './kernel/embeddings.ts';
import { configuredBucket, createConfiguredStore } from './kernel/objects.ts';
import { createConfiguredOcr } from './kernel/ocr.ts';
import { createPdfjsText } from './kernel/pdf.ts';

const ocr = createConfiguredOcr();
const pool = createPool();
try {
  const settings = createSettings(pool);
  const embedder = createConfiguredEmbedder(
    await readEmbeddingSettings(settings),
  );
  console.log(`passages:sweep — embedder ${embedder.describe()}`);
  console.log(`  docs ${createConfiguredStore().describe()}`);
  console.log(`  ocr ${ocr.describe()}`);

  if (embedder.describe() === 'unconfigured') {
    console.log(
      '  NOT RUN — no OPENAI_API_KEY. Zero would mean the backlog was empty;',
    );
    console.log(
      '        an unconfigured embedder is not a measurement of that backlog.',
    );
    process.exit(0);
  }

  const { processorVersion } = await readOcrSettings(settings);
  const report = await sweepMissingPassages({
    db: pool,
    objects: createConfiguredStore(),
    pdf: createPdfjsText(),
    ocr,
    ocrVersion: processorVersion,
    embedder,
    bucket: configuredBucket(),
  });
  console.log(`  examined  ${report.examined}`);
  console.log(`  written   ${report.written}`);
  console.log(`  unchanged ${report.unchanged}`);
  console.log(`  failed    ${report.failed}`);
} finally {
  await pool.end();
}
