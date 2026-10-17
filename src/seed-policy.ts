// The Policy library's sections. `npm run seed:policy`, and also `npm run seed`.
//
// A section is a row. The two that exist today are State law and Company policy.
// Wired into no deploy workflow: a catalogue that seeds itself on every release
// is a catalogue nobody decided to run.
import { createPool } from './kernel/db.ts';
import { applyPolicySections, policySections } from './policy/contract.ts';

const pool = createPool();

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await applyPolicySections(client, policySections);
    await client.query('COMMIT');
    console.log(
      `seed:policy: policy_section — created ${report.created}, updated ${report.updated}`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    `seed:policy failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
