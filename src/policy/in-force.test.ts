// #251. The in-force predicate, at the dates a later version starts.
// Expected values are the spec's half-open interval, not a recomputation.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';

const OLD_FROM = '2024-01-01';
const NEW_FROM = '2026-04-01';
const DAY_BEFORE = '2026-03-31';

async function inForce(
  from: string,
  to: string | null,
  on: string,
): Promise<boolean> {
  const pool = await migratedPoolOrNull();
  if (!pool) return false;
  try {
    const result = await pool.query<{ in_force: boolean }>(
      `SELECT policy_document_in_force($1::date, $2::date, $3::date) AS in_force`,
      [from, to, on],
    );
    return result.rows[0]?.in_force === true;
  } finally {
    await pool.end();
  }
}

describe('policy document in force', () => {
  it('the day before a new version starts, the old one is in force and the new one is not', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await pool.end();
    assert.equal(await inForce(OLD_FROM, NEW_FROM, DAY_BEFORE), true);
    assert.equal(await inForce(NEW_FROM, null, DAY_BEFORE), false);
  });

  it('on the day the new version starts, it is in force and the old one is not', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await pool.end();
    assert.equal(await inForce(OLD_FROM, NEW_FROM, NEW_FROM), false);
    assert.equal(await inForce(NEW_FROM, null, NEW_FROM), true);
  });

  it('a version with no effective-to stays in force after its effective-from', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await pool.end();
    assert.equal(await inForce('2020-06-01', null, '2020-06-01'), true);
    assert.equal(await inForce('2020-06-01', null, '2026-10-17'), true);
    assert.equal(await inForce('2020-06-01', null, '2020-05-31'), false);
  });
});
