// The register importer's entry point -- `npm run import:register -- <file>` locally, and a Cloud
// Run job from this same image when an environment needs a register in it. Slice 2.4.
//
// **Deliberately wired into no workflow**, for src/seed.ts's reason and one of its own: deploy.yml
// and release.yml do not call this and must not, and the file it is pointed at will one day be a
// register of real people. An import is a thing somebody runs on purpose, having chosen the file.
//
// Shaped like src/seed.ts and src/migrate.ts: no fallback connection string, one transaction, and
// loud about what it did rather than silent about nothing going wrong.
import { readFile } from 'node:fs/promises';
import { createPool } from './kernel/db.ts';
import { importRegister } from './register/contract.ts';

const path = process.argv[2];
if (!path) {
  console.error(
    'usage: npm run import:register -- <file.csv>\n' +
      'the format is SPEC-register.md; src/register/fixtures/register.csv is an example of it',
  );
  process.exit(1);
}

const pool = createPool();

try {
  const text = await readFile(path, 'utf8');
  const client = await pool.connect();
  try {
    // One transaction for the whole file, with a savepoint per row inside it. A rejected row is
    // rolled back to its savepoint and the rest of the file still commits -- which is the whole
    // difference between a report and a failure (src/register/internal/importer.ts).
    await client.query('BEGIN');
    const report = await importRegister(client, text);
    await client.query('COMMIT');

    for (const [table, count] of Object.entries(report.counts)) {
      console.log(
        `import: ${table} — created ${count.created}, updated ${count.updated}`,
      );
    }
    console.log(
      `import: ${report.accepted} of ${report.lines} rows accepted, ${report.rejects.length} rejected`,
    );
    // The line number and the rule, which is what somebody fixing a register needs, and never the
    // value, which is what a log must not hold (SPEC.md, PII never in logs).
    for (const reject of report.rejects) {
      console.log(
        `  line ${reject.line}: ${reject.reason}${reject.sqlstate ? ` [${reject.sqlstate}]` : ''}`,
      );
    }
    // A file whose rows were all rejected is not a successful import, and a script that exits 0 on
    // one is a script nothing can be automated around.
    if (report.accepted === 0 && report.lines > 0) process.exitCode = 1;
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
    `import failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
