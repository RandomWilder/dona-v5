// The one entry point, local and container both. Every value comes from the environment; Cloud Run
// injects PORT and requires a bind on 0.0.0.0. `npm run dev` layers .env.example then .env in front
// of it with --env-file-if-exists, neither of which overrides a variable already set in the shell —
// which is why v3's hand-written .env loader (src/dev.ts) is not lifted.
import { buildApp } from './app.ts';
import { createPool } from './db.ts';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 8080);

const pool = createPool(
  process.env.DATABASE_URL ?? 'postgres://dona:dona@127.0.0.1:5434/dona',
);

// The deploy stamps the commit it built (slice 1.6). Locally the honest answer is that it is a
// working copy, not a release.
const app = buildApp({ pool, version: process.env.VERSION ?? '0.0.0-dev' });

await app.listen({ host, port });
console.log(`dona-v5: http://127.0.0.1:${port}/health`);
