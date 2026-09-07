// Slice 4.1's sweep of already-filed unverified documents.
//
//   npm run ocr:sweep
//
// Same standing practice as docs-probe: run on staging as a Cloud Run job from
// the serving image, as app-staging, so the processor, the bucket and the
// database are the ones the revision uses. A local run without
// DOCUMENT_AI_PROCESSOR prints NOT RUN rather than reporting a sweep of zero —
// zero is a measured count, and an unconfigured reader is not a measurement.
import { sweepUnverified } from './evidence/contract.ts';
import { createAuditLog } from './kernel/audit.ts';
import { systemClock } from './kernel/clock.ts';
import { createSettings, readOcrSettings } from './kernel/config.ts';
import { createPool } from './kernel/db.ts';
import { configuredBucket, createConfiguredStore } from './kernel/objects.ts';
import { createConfiguredOcr } from './kernel/ocr.ts';
import { createPdfjsText } from './kernel/pdf.ts';

const ocr = createConfiguredOcr();
console.log(`ocr:sweep — ocr ${ocr.describe()}`);
console.log(`  docs ${createConfiguredStore().describe()}`);

if (ocr.describe() === 'unconfigured') {
  console.log(
    '  NOT RUN — no DOCUMENT_AI_PROCESSOR. Zero would mean the backlog was empty;',
  );
  console.log(
    '        an unconfigured reader is not a measurement of that backlog.',
  );
  process.exit(0);
}

const pool = createPool();
try {
  const { processorVersion } = await readOcrSettings(createSettings(pool));
  const report = await sweepUnverified({
    db: pool,
    objects: createConfiguredStore(),
    pdf: createPdfjsText(),
    ocr,
    ocrVersion: processorVersion,
    audit: createAuditLog(pool),
    clock: systemClock,
    bucket: configuredBucket(),
  });
  console.log(`  examined  ${report.examined}`);
  console.log(`  verified  ${report.verified}`);
  console.log(`  unchanged ${report.unchanged}`);
  console.log(`  failed    ${report.failed}`);
} finally {
  await pool.end();
}
