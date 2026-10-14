// The terms-profile catalogue's entry point — `npm run seed:terms-profiles` locally, and a Cloud Run
// job from this same image when an environment needs it:
//
//   ./infra/run-job.sh staging seed-terms-profiles src/seed-terms-profiles.ts
//
// One profile: the default a lease draft is written under (`DEFAULT_TERMS_PROFILE`). Until #232 the
// only writer was the register importer, so the 12 Oct staging reset, which emptied the table,
// left staging with no way to write a lease draft and no command that could put the row back.
//
// **Deliberately wired into no workflow**, like `src/seed-obligation-types.ts`. `upsertTermsProfile`
// keys on the name, so a second run is a no-op that reports "existing".

import { DEFAULT_TERMS_PROFILE } from './evidence/contract.ts';
import { createPool } from './kernel/db.ts';
import { upsertTermsProfile } from './tenancy/contract.ts';

const pool = createPool();

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await upsertTermsProfile(client, DEFAULT_TERMS_PROFILE);
    await client.query('COMMIT');
    console.log(
      `seed:terms-profiles: ${DEFAULT_TERMS_PROFILE} — ${result.inserted ? 'created' : 'existing'}`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    `seed:terms-profiles failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
