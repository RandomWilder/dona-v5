// The obligation-type catalogue's entry point — `npm run seed:obligation-types` locally, and a
// Cloud Run job from this same image when an environment needs the catalogue in it. Slice 5.7.
//
// **Deliberately wired into no workflow**, like `src/seed-doctypes.ts`. A fixture that seeds
// itself on every deploy is a fixture nobody decided to run.
import { createPool } from './kernel/db.ts';
import { applyObligationTypeCatalogue } from './tenancy/contract.ts';
import { seedObligationTypes } from './tenancy/fixtures/obligation-types.ts';

const pool = createPool();

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await applyObligationTypeCatalogue(
      client,
      seedObligationTypes,
    );
    await client.query('COMMIT');
    console.log(
      `seed:obligation-types: types — created ${report.types.created}, updated ${report.types.updated}`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    `seed:obligation-types failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
