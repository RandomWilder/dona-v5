// A generated register straight into an environment -- `npm run seed:register -- <units> [seed]`,
// and a Cloud Run job from this same image when staging needs volume in it. Slice 2.6.
//
// **Deliberately wired into no workflow**, for src/seed.ts's and src/import-register.ts's reason:
// deploy.yml and release.yml do not call this and must not. Loading data is a thing somebody runs on
// purpose, having chosen what to load.
//
// It generates in memory and hands the text to the same `importRegister`, so the only thing it
// skips against `npm run import:register` is the file. That is what keeps a 600KB CSV out of the
// image while leaving one path through the importer rather than two.
//
// **Fixture data, and nothing else, may reach an environment this way.** The people do not exist and
// the identifiers are in a block reserved for this generator. A real register goes through
// `import:register` with a file somebody chose (2.5).
import { createPool } from './kernel/db.ts';
import { importRegister } from './register/contract.ts';
import { generateRegister } from './register/fixtures/generate.ts';

const units = Number(process.argv[2] ?? 1500);
const seed = process.argv[3] ? Number(process.argv[3]) : undefined;

if (!Number.isInteger(units) || units < 1) {
  console.error('usage: npm run seed:register -- <units> [seed]');
  process.exit(1);
}

const pool = createPool();

try {
  const today = new Date().toISOString().slice(0, 10);
  const { csv, summary } = generateRegister({ units, today, seed });
  const client = await pool.connect();
  try {
    // One transaction for the whole file, a savepoint per row inside it: a rejected row is rolled
    // back to its savepoint and the rest still commits (src/register/internal/importer.ts).
    await client.query('BEGIN');
    const started = Date.now();
    const report = await importRegister(client, csv);
    const elapsed = Date.now() - started;
    await client.query('COMMIT');

    console.log(`seed:register — ${today}, seed ${seed ?? 2026}`);
    for (const [name, value] of Object.entries(summary)) {
      console.log(`seed:register: ${name} — ${value}`);
    }
    for (const [table, count] of Object.entries(report.counts)) {
      console.log(
        `seed:register: ${table} — created ${count.created}, updated ${count.updated}`,
      );
    }
    // The number 2.6 exists to take, printed where the import happens rather than reconstructed
    // afterwards from a shell's `time`.
    console.log(
      `seed:register: ${report.accepted} of ${report.lines} rows in ${elapsed}ms` +
        ` (${(elapsed / Math.max(report.lines, 1)).toFixed(2)}ms/row), ${report.rejects.length} rejected`,
    );
    for (const reject of report.rejects) {
      console.log(`  line ${reject.line}: ${reject.reason}`);
    }
    // A generated register that loses rows is a defect in the generator, so it is not a warning.
    if (report.rejects.length > 0) process.exitCode = 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    `seed:register failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
