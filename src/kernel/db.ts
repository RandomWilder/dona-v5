// Pool construction. Lifted from v3 (docs/from-v3.md Tier 1) with one addition, which is the one
// place in this slice where "verbatim" would have been the wrong answer.
//
// **The 'error' listener.** A `pg` Pool emits 'error' on an idle client whose backend goes away — a
// Cloud SQL restart, a failover, a maintenance window, `docker compose stop db`. Node throws on an
// unhandled 'error' event, so a pool without a listener takes the *process* down: /health's 503
// branch never runs, because there is nothing left to serve it. v3 has no listener anywhere in its
// repository and has been deployed that way; slice 1.3 found it by stopping the container under a
// live dev server, and this lift is the moment the fix would have been silently undone.
// `db.test.ts` terminates its own backends to prove it did not.
import { Pool } from 'pg';
import { KernelError } from './errors.ts';

export function createPool(
  env: Record<string, string | undefined> = process.env,
): Pool {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new KernelError('invalid', 'DATABASE_URL is required');
  }
  const pool = new Pool({
    connectionString,
    allowExitOnIdle: true,
    // Bounded so a database that is down becomes a 503 while someone is still looking. Without it
    // a connection attempt waits on the OS, and infra/smoke.sh times out instead of reading an
    // answer the endpoint was built to give (slice 1.3).
    connectionTimeoutMillis: 1500,
  });
  pool.on('error', (error) => {
    // The message only. The error object carries the full connection parameters, and SPEC.md's
    // rule is that internals reach a log no more readily than they reach the wire.
    console.error(`pg pool: idle client dropped — ${error.message}`);
  });
  return pool;
}
