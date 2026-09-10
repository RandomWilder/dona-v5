// The one entry point, local and container both. Every value comes from the environment; Cloud Run
// injects PORT and requires a bind on 0.0.0.0. `npm run dev` layers .env.example then .env in front
// of it with --env-file-if-exists, neither of which overrides a variable already set in the shell —
// which is why v3's hand-written .env loader (src/dev.ts) is not lifted.
import { buildApp } from './app.ts';
import { createPool } from './kernel/db.ts';
import { createConfiguredExtractor } from './kernel/extraction.ts';
import { configuredBucket, createConfiguredStore } from './kernel/objects.ts';
import { createConfiguredOcr } from './kernel/ocr.ts';
import { createPdfjsText } from './kernel/pdf.ts';
import { createWorkRunner } from './kernel/work.ts';
import {
  configuredHostedDomain,
  createConfiguredIdentity,
} from './staff/contract.ts';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 8080);

// No localhost fallback: createPool refuses a missing DATABASE_URL (kernel/db.ts). A production
// service that quietly falls back to a developer's database is worse than one that will not boot.
const pool = createPool();

// Which object store is running, said out loud (slice 3.2). SPEC-kernel.md has claimed this since
// the 1.4 lift and nothing did it: `deploy.yml` injects DOCS_BUCKET and no code in this repository
// read it, so a revision quietly serving off the memory store looked exactly like one serving off
// the bucket. An absent bucket is still not an error — locally there is none and `npm run dev` must
// start — but `docs: memory` on a deployed revision is now visible, and is as wrong as a `-dev`
// version string.
const objects = createConfiguredStore();
const ocr = createConfiguredOcr();
const extractor = createConfiguredExtractor();
// Who signs in (slice 5.1, Google from 5.1b). Same shape as the store and the readers above, and
// for the sharper reason: a deployed revision that signs nobody in must be visibly different from
// one that does, and `identity: unconfigured` on staging is as wrong as a `-dev` version string —
// readable on the boot line rather than discovered by an operator failing to log in.
const identity = createConfiguredIdentity();
const work = createWorkRunner(pool);
work.start();

// The deploy stamps the commit it built (slice 1.6). Locally the honest answer is that it is a
// working copy, not a release.
// The store, the reader and the bucket name reach the app from here and nowhere deeper — the same
// rule the pool and the clock follow. Slice 3.3, which is the first slice with a route that writes.
const app = buildApp({
  pool,
  version: process.env.VERSION ?? '0.0.0-dev',
  objects,
  pdf: createPdfjsText(),
  ocr,
  extractor,
  work,
  bucket: configuredBucket(),
  identity,
  // Google matches the redirect URI character for character, so a deployment says its own origin
  // rather than letting a proxy header decide it.
  staffBaseUrl: process.env.STAFF_BASE_URL,
  staffHostedDomain: configuredHostedDomain(),
});

await app.listen({ host, port });
console.log(`dona-v5: http://127.0.0.1:${port}/health`);
console.log(`docs: ${objects.describe()}`);
console.log(`ocr: ${ocr.describe()}`);
console.log(`extract: ${extractor.describe()}`);
console.log(`identity: ${identity.describe()}`);
