// The document-type catalogue's entry point — `npm run seed:doctypes` locally, and a Cloud Run job
// from this same image when an environment needs the catalogue in it. Slice 3.1.
//
// **Deliberately wired into no workflow**, like `src/seed.ts` and `src/seed-register.ts`. deploy.yml
// and release.yml do not call this and must not: a fixture that seeds itself on every deploy is a
// fixture nobody decided to run.
//
// **It is data and not a migration, on purpose.** A8's open half is that a new document type costs a
// seed row and a re-deploy of data. If the nine seed types landed in a backfill migration, adding
// the tenth would be a migration too and the slice's acceptance bar would be false the day it was
// written. This file is what makes it true (SPEC-evidence.md).
import { applyDocumentTypeCatalogue } from './evidence/contract.ts';
import { seedDocumentTypes } from './evidence/fixtures/document-types.ts';
import { createPool } from './kernel/db.ts';

const pool = createPool();

try {
  const client = await pool.connect();
  try {
    // One transaction for the whole catalogue. A half-seeded catalogue is not a state worth
    // reasoning about — a type present with its declarations missing reads as a type that declares
    // nothing, which is a legitimate state a partial failure must not be able to fake.
    await client.query('BEGIN');
    const report = await applyDocumentTypeCatalogue(client, seedDocumentTypes);
    await client.query('COMMIT');
    for (const [table, count] of Object.entries(report)) {
      console.log(
        `seed:doctypes: ${table} — created ${count.created}, updated ${count.updated}`,
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
    `seed:doctypes failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
