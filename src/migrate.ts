// The migration entry point — `npm run migrate` locally, and a Cloud Run job from this same image
// in a deployed environment, run before the new revision serves (docs/pipeline.md §5).
//
// Slice 1.6. Until now `kernel/migrate.ts` had no caller outside the test run: the schema existed in
// the repository and nowhere else, and a deployed revision would have answered /health against a
// database with no tables. This file is what makes a deploy a migration.
//
// Deliberately thin, and deliberately loud. What it prints is the only record of what a deploy did
// to the schema — read afterwards in a job log rather than watched live — so it names the files
// rather than reporting that nothing went wrong.
import { createPool } from './kernel/db.ts';
import { migrate } from './kernel/migrate.ts';

// No fallback connection string, the same rule serve.ts follows: createPool refuses a missing
// DATABASE_URL rather than quietly migrating whichever database happens to be on localhost.
const pool = createPool();

try {
  const applied = await migrate(pool);
  if (applied.length === 0) {
    console.log('migrate: nothing to apply — schema is current');
  } else {
    console.log(`migrate: applied ${applied.length}`);
    for (const filename of applied) {
      console.log(`  ${filename}`);
    }
  }
} catch (error) {
  // The message, not the error object: a pg failure carries the connection parameters, and SPEC.md's
  // rule is that internals reach a log no more readily than they reach the wire. Which file failed
  // is not in the message and does not need to be — every file before it is recorded in
  // schema_migrations, so the failure is the first one that is not.
  console.error(
    `migrate failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
