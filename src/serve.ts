// The one entry point, local and container both. Every value comes from the environment; Cloud Run
// injects PORT and requires a bind on 0.0.0.0. `npm run dev` layers .env.example then .env in front
// of it with --env-file-if-exists, neither of which overrides a variable already set in the shell —
// which is why v3's hand-written .env loader (src/dev.ts) is not lifted.
import { buildApp, DEFAULT_TENANT_HOST } from './app.ts';
import { startCallBrief } from './calls/contract.ts';
import {
  codeSenderFromEnv,
  createGraphReader,
  createSorter,
  emergencyMatch,
  graphMailboxFrom,
  receiveIncoming,
  SORTER_PROMPT_VERSION,
  scannerFromEnv,
  sendOutlookReply,
  startOutlookPolling,
  watchWhatsapp,
  whatsappFrom,
} from './channel/contract.ts';
import { zonedClock } from './kernel/clock.ts';
import {
  createSettings,
  readClockSettings,
  readEmbeddingSettings,
  readSorterSettings,
} from './kernel/config.ts';
import { createPool } from './kernel/db.ts';
import { createConfiguredEmbedder } from './kernel/embeddings.ts';
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
// Cloud Run sets K_SERVICE. That is the only place the 32 MiB HTTP/1 cap exists, and the only
// place this process speaks cleartext HTTP/2 to get out from under it. A laptop has no such cap.
const http2 = Boolean(process.env.K_SERVICE);
const sorterOn = (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;
const outlook = graphMailboxFrom(process.env);
const whatsapp = whatsappFrom(process.env);

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
const scanner = scannerFromEnv(process.env);
const ocr = createConfiguredOcr();
const extractor = createConfiguredExtractor();
// Who signs in (slice 5.1, Google from 5.1b). Same shape as the store and the readers above, and
// for the sharper reason: a deployed revision that signs nobody in must be visibly different from
// one that does, and `identity: unconfigured` on staging is as wrong as a `-dev` version string —
// readable on the boot line rather than discovered by an operator failing to log in.
const identity = createConfiguredIdentity();

// **Which day the office is having (slice 7.2b).** A `config_settings` row, read here because this
// is where the pool exists before the app does, and because a zone ICU does not know must fail the
// boot rather than a tenant read hours later — `zonedClock` raises `invalid` on one. Absent row
// means `Asia/Jerusalem`; a second country is then a row and not a release. Said out loud on the
// boot line for the same reason `docs: memory` is: a revision running on the wrong zone answers
// "who lives here" about the wrong day for three hours a night, and that must be readable rather
// than discovered.
const settings = createSettings(pool);
const clock = zonedClock((await readClockSettings(settings)).zone);
const embedder = createConfiguredEmbedder(
  await readEmbeddingSettings(settings),
);
const work = createWorkRunner(pool);
work.start();
const sorter = sorterOn
  ? createSorter({
      extractor,
      model: async () => (await readSorterSettings(settings)).model,
    })
  : undefined;
if (whatsapp) await watchWhatsapp(pool, clock);
if (outlook) {
  startOutlookPolling({
    db: pool,
    clock,
    reader: createGraphReader(outlook),
    deliver: async (message) => {
      await receiveIncoming(
        pool,
        clock,
        {
          sorter: sorter ?? {
            async sort() {
              throw new Error('sorter unconfigured');
            },
            async translate() {
              return { bodyHe: null };
            },
          },
          matchesEmergency: emergencyMatch(pool),
          objects,
          scanner,
          replyOnEmail: (reply) => sendOutlookReply(outlook, reply),
          onCallIdentified: (callId) =>
            startCallBrief({ db: pool, clock, extractor, embedder }, callId),
        },
        message,
      );
    },
    onError(error) {
      console.error(
        'outlook: read failed',
        error instanceof Error ? error.message : 'unknown',
      );
    },
  });
}

// The deploy stamps the commit it built (slice 1.6). Locally the honest answer is that it is a
// working copy, not a release.
// The store, the reader and the bucket name reach the app from here and nowhere deeper — the same
// rule the pool and the clock follow. Slice 3.3, which is the first slice with a route that writes.
const codeSender = codeSenderFromEnv(process.env, (line) => {
  console.log(line);
});
function portalCodeLabel(): string {
  if (codeSender.channels.length === 0) return 'unconfigured';
  const template = (process.env.PORTAL_WHATSAPP_TEMPLATE ?? '').trim();
  const username = (process.env.INFORU_USERNAME ?? '').trim();
  if (template === '' && username === '') return 'log';
  return codeSender.channels.join('+');
}
const app = buildApp({
  pool,
  clock,
  version: process.env.VERSION ?? '0.0.0-dev',
  objects,
  pdf: createPdfjsText(),
  ocr,
  extractor,
  embedder,
  work,
  bucket: configuredBucket(),
  identity,
  // Google matches the redirect URI character for character, so a deployment says its own origin
  // rather than letting a proxy header decide it.
  staffBaseUrl: process.env.STAFF_BASE_URL,
  tenantHost: process.env.TENANT_HOST ?? DEFAULT_TENANT_HOST,
  codeSender,
  scanner,
  staffHostedDomain: configuredHostedDomain(),
  devMockups: (process.env.VERSION ?? '0.0.0-dev').endsWith('-dev'),
  http2,
  sorter,
  graphReply: outlook ? (reply) => sendOutlookReply(outlook, reply) : undefined,
});

await app.listen({ host, port });
console.log(`dona-v5: http://127.0.0.1:${port}/health`);
console.log(`http: ${http2 ? 'h2c' : 'h1'}`);
console.log(`docs: ${objects.describe()}`);
console.log(`ocr: ${ocr.describe()}`);
console.log(`extract: ${extractor.describe()}`);
console.log(
  `sorter: ${
    sorterOn
      ? `${(await readSorterSettings(settings)).model} · ${SORTER_PROMPT_VERSION}`
      : 'unconfigured'
  }`,
);
console.log(`embed: ${embedder.describe()}`);
console.log(`identity: ${identity.describe()}`);
console.log(`tenant host: ${process.env.TENANT_HOST ?? DEFAULT_TENANT_HOST}`);
console.log(`portal codes: ${portalCodeLabel()}`);
console.log(`scanner: ${scanner ? 'dev' : 'unconfigured'}`);
console.log(`clock: ${clock.zone}`);
console.log(`outlook: ${outlook ? 'configured' : 'unconfigured'}`);
console.log(`whatsapp: ${whatsapp ? 'configured' : 'unconfigured'}`);
