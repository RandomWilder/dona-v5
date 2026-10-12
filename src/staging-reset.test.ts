// The staging reset's refusals and its keep list. The truncate itself is never run here: the test
// database is shared by every suite running in parallel, and emptying it under them is the one thing
// a test of this script must not do. What is checked against the real schema is read-only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import {
  countTables,
  KEEP_TABLES,
  parseStagingResetArgs,
  partitionTables,
  refuseUnlessStagingDatabase,
} from './staging-reset-plan.ts';

describe('staging reset — where it may run', () => {
  it('refuses prod', () => {
    assert.throws(
      () =>
        refuseUnlessStagingDatabase(
          'postgresql://u:p@/dona?host=/cloudsql/dona-v5:me-west1:dona-prod',
        ),
      /refuses prod/,
    );
  });

  it('refuses a URL it does not recognise, and a missing one', () => {
    assert.throws(
      () =>
        refuseUnlessStagingDatabase('postgres://u:p@db.example.com:5432/dona'),
      /only against/,
    );
    assert.throws(() => refuseUnlessStagingDatabase(undefined), /not set/);
  });

  it('runs against staging and the local database', () => {
    refuseUnlessStagingDatabase(
      'postgresql://u:p@/dona?host=/cloudsql/dona-v5:me-west1:dona-staging',
    );
    refuseUnlessStagingDatabase('postgres://dona:dona@127.0.0.1:5434/dona');
  });

  it('takes list or apply and nothing else', () => {
    assert.deepEqual(parseStagingResetArgs(['list']), { mode: 'list' });
    assert.deepEqual(parseStagingResetArgs(['apply']), { mode: 'apply' });
    assert.throws(() => parseStagingResetArgs([]), /usage/);
    assert.throws(
      () => parseStagingResetArgs(['apply', '--building', 'x']),
      /usage/,
    );
  });
});

describe('staging reset — what goes', () => {
  it('wipes a table it has never heard of', () => {
    const all = [...KEEP_TABLES, 'table_added_next_month'].map((table) => ({
      table,
      rows: 1,
    }));
    const plan = partitionTables(all);
    assert.deepEqual(
      plan.wipe.map((t) => t.table),
      ['table_added_next_month'],
    );
  });

  it('refuses when a kept table has gone from the schema', () => {
    const all = KEEP_TABLES.filter((t) => t !== 'staff_account').map(
      (table) => ({ table, rows: 0 }),
    );
    assert.throws(
      () => partitionTables(all),
      /missing from the schema: staff_account/,
    );
  });

  it('agrees with the migrated schema, and the data tables are on the wipe side', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    try {
      const plan = partitionTables(await countTables(pool));
      const wiped = plan.wipe.map((x) => x.table);
      for (const table of [
        'building',
        'unit',
        'party',
        'tenancy',
        'document',
        'service_call',
        'audit_log',
        'staff_session',
      ]) {
        assert.ok(wiped.includes(table), `${table} should be wiped`);
      }
      assert.equal(plan.keep.length, KEEP_TABLES.length);
    } finally {
      await pool.end();
    }
  });
});
