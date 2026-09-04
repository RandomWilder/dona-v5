import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { buildApp } from './app.ts';

// app.inject drives the route without binding a socket, so the suite never races a port.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://dona:dona@127.0.0.1:5434/dona';

// Locally an absent database means "skip". In CI that is a gate that lies: the job goes green
// having asserted nothing about the database. REQUIRE_POSTGRES=1 turns the skip back into a
// failure (docs/pipeline.md §7). Four lines rather than a helper, because src/kernel/pg-support.ts
// arrives in slice 1.4 with migratedPoolOrNull() and supersedes this (carried in tasks/todo.md 1.4).
async function reachablePoolOrNull(): Promise<Pool | null> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1500,
    allowExitOnIdle: true,
  });
  try {
    await pool.query('SELECT 1');
    return pool;
  } catch (cause) {
    await pool.end();
    if (process.env.REQUIRE_POSTGRES === '1') {
      throw new Error(
        `REQUIRE_POSTGRES=1 but ${databaseUrl} is unreachable: ${String(cause)}`,
      );
    }
    return null;
  }
}

describe('/health', () => {
  it('reports ok:true and db:up against a real database', async (t) => {
    const pool = await reachablePoolOrNull();
    if (!pool) {
      t.skip('postgres not running — npm run db:up');
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      strictEqual(response.statusCode, 200);
      const body = response.json();
      // Both halves of the slice's acceptance bar: a process that is up is not the same claim as
      // a process that can reach its database.
      strictEqual(body.ok, true);
      strictEqual(body.db, 'up');
      strictEqual(body.version, '9.9.9-test');
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('degrades to 503 in the SPEC.md error shape when the database is down', async () => {
    const deadPool = new Pool({
      connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
      connectionTimeoutMillis: 500,
      allowExitOnIdle: true,
    });
    const app = buildApp({ pool: deadPool, version: '9.9.9-test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      strictEqual(response.statusCode, 503);
      const body = response.json();
      strictEqual(body.ok, false);
      strictEqual(body.code, 'unavailable');
      strictEqual(body.message, 'database unreachable');
      // The connection string is in the caught error. It must not be on the wire.
      strictEqual(/59999|postgres:\/\//.test(response.body), false);
    } finally {
      await app.close();
      await deadPool.end();
    }
  });
});
