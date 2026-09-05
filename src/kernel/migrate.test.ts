import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from './migrate.ts';
import { migratedPoolOrNull, skipReason } from './pg-support.ts';

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

describe('numbered migrations', () => {
  it('applies in order, records files, and is safe to run twice', async (t) => {
    // v3's copy of this suite connected through a private `connectOrNull()` that skipped whenever
    // the database was unreachable — **including under REQUIRE_POSTGRES=1**. Slice 1.4 caught it by
    // pointing DATABASE_URL at a closed port with the flag set and watching this case report
    // `ok ... # SKIP`. That is the exact failure docs/pipeline.md §7 names: the one suite that
    // proves the schema applies at all, going green in CI having applied nothing.
    //
    // pg-support.ts is the single place that decision belongs. It also migrates the pool it hands
    // back, so the two calls below are the second and third runs rather than the first and second —
    // which makes the idempotency assertion stronger, not weaker.
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await migrate(pool);
      await migrate(pool);
      const applied = await pool.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations ORDER BY filename',
      );
      // Every numbered file on disk, applied exactly once, in order — asserted against the
      // directory so adding a migration never edits this test.
      const onDisk = (await readdir(migrationsDir))
        .filter((name) => /^\d+_.*\.sql$/.test(name))
        .sort();
      assert.deepEqual(
        applied.rows.map((row) => row.filename),
        onDisk,
      );
      assert.ok(onDisk.length >= 2);
      const vector = await pool.query(
        "SELECT extname FROM pg_extension WHERE extname = 'vector'",
      );
      assert.equal(vector.rowCount, 1);
    } finally {
      await pool.end();
    }
  });

  it('reports which files it applied, and reports nothing on a second run', async (t) => {
    // Slice 1.6. `migrate()` used to return void, which is enough inside a test run and not enough
    // for a deploy: `src/migrate.ts` writes the only record anyone reads afterwards, and a runner
    // that reports "no error" cannot tell three migrations applied from a connection to the wrong
    // database where everything was already there.
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      // A private schema, so this case gets a virgin ledger without disturbing the suites running
      // beside it — node --test runs files in parallel and every one of them migrates. Both the
      // migrations' tables and `schema_migrations` land in `migrate_probe` because it is first on
      // the search path; `public` stays on the path only so the `vector` extension's type resolves.
      await pool.query('DROP SCHEMA IF EXISTS migrate_probe CASCADE');
      await pool.query('CREATE SCHEMA migrate_probe');
      const probe = new Pool({
        connectionString: pool.options.connectionString,
        options: '-c search_path=migrate_probe,public',
        connectionTimeoutMillis: 1500,
        allowExitOnIdle: true,
      });
      try {
        const onDisk = (await readdir(migrationsDir))
          .filter((name) => /^\d+_.*\.sql$/.test(name))
          .sort();
        assert.deepEqual(await migrate(probe), onDisk);
        assert.deepEqual(await migrate(probe), []);
      } finally {
        await probe.end();
        await pool.query('DROP SCHEMA IF EXISTS migrate_probe CASCADE');
      }
    } finally {
      await pool.end();
    }
  });
});
