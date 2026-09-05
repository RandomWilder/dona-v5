import { Pool, type PoolClient } from 'pg';
import { KernelError } from './errors.ts';
import { migrate } from './migrate.ts';

// Named to avoid node --test's `test-*` collection pattern: this is a helper,
// not a suite.
const defaultUrl = 'postgres://dona:dona@127.0.0.1:5434/dona';

export async function migratedPoolOrNull(): Promise<Pool | null> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? defaultUrl,
    connectionTimeoutMillis: 1500,
    allowExitOnIdle: true,
  });
  try {
    await pool.query('SELECT 1');
  } catch (cause) {
    await pool.end();
    // Locally an absent database means "skip the durability suite". In CI that
    // would be a gate that lies: every durability test would pass by not
    // running. REQUIRE_POSTGRES=1 turns the skip back into a failure.
    if (process.env.REQUIRE_POSTGRES === '1') {
      throw new KernelError(
        'unavailable',
        'REQUIRE_POSTGRES=1 but the database is unreachable',
        { reason: cause instanceof Error ? cause.message : 'unknown' },
      );
    }
    return null;
  }
  await migrate(pool);
  return pool;
}

export const skipReason = 'postgres not running — npm run db:up';

// Every suite that writes fixtures against the shared database seeds inside a transaction and rolls
// it back, so no fixture outlives the case that wrote it and no case can start passing because of a
// row another one left behind. The rollback is in a finally: a case that throws still leaves the
// database as it found it.
//
// It lives beside migratedPoolOrNull() because that is already the seam a suite reaches for when it
// needs a real database, and because there must be exactly one copy of this: it landed in
// tests/policy/support.ts at slice 1.7 and moved here at 1.9, when src/estate/ became the second
// caller.
export async function inRolledBackTransaction(
  pool: Pool,
  body: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await body(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
