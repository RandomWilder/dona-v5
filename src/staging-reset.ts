// Operator reset of staging to an empty system. The rules are in staging-reset-plan.ts.
//
//   npm run staging:reset -- --dry-run   runs `list`: counts per table, writes nothing
//   npm run staging:reset                runs `apply`, then empties the docs bucket
//
// Apply prints one line before and one after, not the tables: infra/run-job.sh reads back the
// job's last fifty log lines, and the table list is what --dry-run is for.

import { createPool } from './kernel/db.ts';
import {
  applyStagingReset,
  parseStagingResetArgs,
  planStagingReset,
  type ResetPlan,
  refuseUnlessStagingDatabase,
} from './staging-reset-plan.ts';

function summary(plan: ResetPlan): string {
  const rows = plan.wipe.reduce((sum, t) => sum + t.rows, 0);
  return `wipe ${plan.wipe.length} tables ${rows} rows · keep ${plan.keep.map((t) => `${t.table} ${t.rows}`).join(', ')}`;
}

function printPlan(heading: string, plan: ResetPlan): void {
  const total = plan.wipe.reduce((sum, t) => sum + t.rows, 0);
  console.log(heading);
  console.log(`  wipe  ${plan.wipe.length} tables  ${total} rows`);
  for (const t of plan.wipe) {
    console.log(`    ${t.table.padEnd(34)} ${t.rows}`);
  }
  console.log(`  keep  ${plan.keep.length} tables`);
  for (const t of plan.keep) {
    console.log(`    ${t.table.padEnd(34)} ${t.rows}`);
  }
}

let pool: ReturnType<typeof createPool> | undefined;
try {
  const { mode } = parseStagingResetArgs(process.argv.slice(2));
  refuseUnlessStagingDatabase(process.env.DATABASE_URL);
  if (process.env.ENV === 'prod') {
    throw new Error('staging reset refuses prod');
  }

  pool = createPool();
  if (mode === 'list') {
    printPlan(
      'staging-reset list — nothing written',
      await planStagingReset(pool),
    );
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log(
        `staging-reset before  ${summary(await planStagingReset(client))}`,
      );
      const after = await applyStagingReset(client);
      await client.query('COMMIT');
      console.log(`staging-reset after   ${summary(after)} — committed`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} catch (error) {
  console.error(
    `staging-reset failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
