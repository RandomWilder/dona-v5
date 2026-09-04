import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createPool } from './db.ts';
import { KernelError } from './errors.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://dona:dona@127.0.0.1:5434/dona';

describe('createPool', () => {
  it('rejects a missing DATABASE_URL with the kernel error shape', () => {
    assert.throws(
      () => createPool({}),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'invalid',
    );
  });

  it('builds a pool from DATABASE_URL', async () => {
    const pool = createPool({
      DATABASE_URL: 'postgres://dona:dona@127.0.0.1:5434/dona',
    });
    await pool.end();
  });
});

// Only this pool's own backends are terminated, never every connection to the database: node --test
// runs test files in parallel, and a blanket pg_terminate_backend would take the other suites'
// connections down with it and call the result a flake.
const tag = 'dona_db_restart_test';

describe('the pool survives the database going away', () => {
  it('stays alive to answer instead of taking the process down with it', async (t) => {
    let pool: Pool;
    try {
      pool = createPool({
        DATABASE_URL: `${databaseUrl}?application_name=${tag}`,
      });
      await pool.query('SELECT 1');
    } catch (cause) {
      if (process.env.REQUIRE_POSTGRES === '1') {
        throw new KernelError(
          'unavailable',
          'REQUIRE_POSTGRES=1 but the database is unreachable',
          { reason: cause instanceof Error ? cause.message : 'unknown' },
        );
      }
      t.skip('postgres not running — npm run db:up');
      return;
    }

    // The query above left an idle client in the pool. Killing its backend is what a Cloud SQL
    // restart, a failover or a maintenance window does, and `pg` surfaces it as an 'error' event on
    // the pool. With no listener Node throws on an unhandled 'error' and the *process* exits — so
    // this case fails by killing its own runner, which is exactly how loudly it should fail.
    //
    // Slice 1.3 found this by stopping the container under a live dev server. v3's kernel/db.ts has
    // no listener and has been deployed that way for a month (docs/from-v3.md), so the verbatim
    // lift in 1.4 is precisely the moment the fix would have been undone. This is the case that
    // does not let it be.
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

    // Either answer is correct — the pool may have reconnected by now. The assertion is that there
    // is still a process here to give one.
    const alive = await pool
      .query('SELECT 1')
      .then(() => true)
      .catch(() => true);
    assert.equal(alive, true);
    await pool.end();
  });
});
