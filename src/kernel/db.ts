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
import { Pool, type PoolClient } from 'pg';
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

/**
 * A pool or a client, which is all any query in this system needs to know. Every module states this
 * type for itself and declines to import another module's (`src/evidence/internal/types.ts` says
 * why); the kernel's copy is the one `inTransaction` below is written against, and it is the same
 * two words.
 */
export type Queryable = Pool | PoolClient;

/**
 * One unit of work, on one connection, inside one transaction. **Lifted to the kernel at slice 6.3.**
 *
 * It was written at 4.3 in `src/evidence/internal/promote.ts`, copied byte-for-byte into
 * `src/evidence/internal/lease.ts` at 4.6, and written a third time inline in
 * `src/estate/internal/routes.ts` at 6.2 — which is the line slice 6.2 drew for itself: **a third
 * writer moves it down here.** Three copies of a `BEGIN`/`ROLLBACK` pair is three places for the
 * `.catch(() => {})` on the rollback to be missing, and that one is not decoration: a rollback that
 * throws inside a `catch` replaces the error the caller needed to see with the error the recovery
 * hit.
 *
 * **A `PoolClient` passes straight through**, so a caller already inside a transaction composes
 * rather than dead-locks itself on a second connection, and a test driving a rolled-back client sees
 * its own writes. The discrimination is the shape and not an `instanceof`: `pg` exports the client
 * as a type here, and a `Pool` has `connect` while a `PoolClient` has both `connect` and `release`.
 */
export async function inTransaction<T>(
  db: Queryable,
  work: (db: Queryable) => Promise<T>,
): Promise<T> {
  const pool = asPool(db);
  if (!pool) {
    return work(db);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function asPool(db: Queryable): Pool | null {
  if ('connect' in db && !('release' in db)) {
    return db as Pool;
  }
  return null;
}
