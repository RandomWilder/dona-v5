// Pool construction, with the one thing a long-running service cannot do without.
//
// A `pg` Pool emits 'error' on an idle client whose backend goes away — a Cloud SQL restart, a
// failover, a maintenance window, `docker compose stop db`. Node throws on an unhandled 'error'
// event, so without a listener the process *exits* rather than degrading: /health's 503 branch
// never runs, because there is nothing left to serve it. Found in slice 1.3 by stopping the
// container while the dev server was up.
//
// **v3 has no listener either** (src/kernel/db.ts, docs/from-v3.md Tier 1). Slice 1.4 lifts that
// file verbatim and deletes this one, and must carry this handler across with it.
import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 1500 });
  pool.on('error', (error) => {
    // The message only. The error object carries the full connection parameters, and SPEC.md's
    // rule is that internals never reach a log any more than they reach the wire.
    console.error(`pg pool: idle client dropped — ${error.message}`);
  });
  return pool;
}
