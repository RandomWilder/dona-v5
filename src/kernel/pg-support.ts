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

// The append-only tables refuse a DELETE, so a suite that cleans up its own letting has to switch
// the guard off. Two suites doing that at once raced: one switched the trigger back on while the
// other was half way through its deletes, and the delete raised. Every such cleanup now holds one
// advisory lock from the moment it switches a guard off until it has switched it back on, so they
// queue behind each other. The switch itself stays a short statement of its own: holding the
// table's ACCESS EXCLUSIVE lock across the whole cleanup deadlocked against requests in other
// suites. The body gets the connection that holds the lock, so a helper it calls must use that.
const GUARDS_OFF_LOCK = 0x646f6e61;

export async function withGuardsOff(
  pool: Pool,
  guards: ReadonlyArray<readonly [table: string, trigger: string]>,
  body: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [GUARDS_OFF_LOCK]);
    try {
      for (const [table, trigger] of guards) {
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      await body(client);
    } finally {
      for (const [table, trigger] of guards) {
        await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
      await client.query('SELECT pg_advisory_unlock($1)', [GUARDS_OFF_LOCK]);
    }
  } finally {
    client.release();
  }
}

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
    // Shared with every other rolled-back case, exclusive against withGuardsOff: a case that
    // asserts an append-only guard refuses never runs while another suite's cleanup has it off.
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [
      GUARDS_OFF_LOCK,
    ]);
    await body(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
