// The fixture entry point -- `npm run seed` locally, and a Cloud Run job from this same image when
// an environment needs the week-1 demo data in it. Slice 1.11.
//
// **Deliberately wired into no workflow.** deploy.yml and release.yml do not call this and must not:
// a fixture that seeds itself on every deploy puts mock buildings into production the next time a
// `v*` tag is cut. Staging is seeded by hand, once, and the import is idempotent so a second run
// costs nothing (src/estate/internal/importer.ts).
//
// Shaped like src/migrate.ts, for the same reasons: no fallback connection string, and loud about
// what it did rather than silent about nothing going wrong.
import { importEstate } from './estate/contract.ts';
import { shohamPlan } from './estate/fixtures/shoham.ts';
import { createPool } from './kernel/db.ts';

const pool = createPool();

try {
  const client = await pool.connect();
  try {
    // One transaction for the whole plan. A half-seeded building is not a state worth reasoning
    // about, and the plan is one screen's worth of rows.
    await client.query('BEGIN');
    const report = await importEstate(client, shohamPlan());
    await client.query('COMMIT');
    for (const [table, count] of Object.entries(report)) {
      console.log(
        `seed: ${table} — ${count.before} → ${count.after} (created ${count.created})`,
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  // The message and not the error object: a pg failure carries the connection parameters, and
  // SPEC.md's rule is that internals reach a log no more readily than they reach the wire.
  console.error(
    `seed failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
