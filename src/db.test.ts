import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { buildApp } from './app.ts';
import { createPool } from './db.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://dona:dona@127.0.0.1:5434/dona';

// Only this pool's own backends are terminated, never every connection to the database: node --test
// runs test files in parallel, and a blanket pg_terminate_backend would take src/app.test.ts's
// connections down with it and call the result a flake.
const tag = 'dona_db_restart_test';

describe('the pool survives the database going away', () => {
  it('reports 503 instead of taking the process down with it', async (t) => {
    let pool: Pool;
    try {
      pool = createPool(`${databaseUrl}?application_name=${tag}`);
      await pool.query('SELECT 1');
    } catch (cause) {
      if (process.env.REQUIRE_POSTGRES === '1') {
        throw new Error(
          `REQUIRE_POSTGRES=1 but ${databaseUrl} is unreachable: ${String(cause)}`,
        );
      }
      t.skip('postgres not running — npm run db:up');
      return;
    }

    // The query above left an idle client in the pool. Killing its backend is what a Cloud SQL
    // restart, a failover or a maintenance window does, and `pg` surfaces it as an 'error' event on
    // the pool. With no listener Node throws on an unhandled 'error' and the *process* exits — so
    // this case fails by killing its own runner, which is exactly how loudly it should fail. v3
    // has no listener either (docs/from-v3.md), so the kernel lift in 1.4 must not undo this.
    const killer = new Pool({
      connectionString: databaseUrl,
      allowExitOnIdle: true,
    });
    await killer.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1',
      [tag],
    );
    await killer.end();
    await delay(250);

    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      // Either answer is correct — the pool may have reconnected by now. The assertion is that the
      // process is still alive to answer at all.
      const response = await app.inject({ method: 'GET', url: '/health' });
      strictEqual(
        [200, 503].includes(response.statusCode),
        true,
        `got ${response.statusCode}`,
      );
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
