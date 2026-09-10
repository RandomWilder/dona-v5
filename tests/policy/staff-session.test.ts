// The staff session's standing constraint: **no column in this database holds a bearer token.**
//
// Slice 5.1. `staff_session` stores `token_hash` and never the token, so reading the table — a
// backup, a support engineer's SELECT, a leaked dump — gives an attacker nothing to ride. That is a
// sentence in SPEC-staff.md and in the migration's comment block, and neither of those is a thing
// the build can fail on. This is.
//
// **Why it lives in tests/policy/ and not beside the module.** docs/pipeline.md §6 is the gate for
// everything no model may decide, and a session token in plaintext is not a code-quality opinion —
// it is the difference between a stolen backup and a stolen console. It is also deterministic and
// checkable in SQL, which is the whole test for whether a constraint belongs here.
//
// **The red-first proof is in the case rather than in somebody's terminal.** docs/pipeline.md §6
// requires a policy case to have been red before it was green, and a case that only ever asserts
// "the real schema is clean" is green on the day it is written and green forever after somebody
// removes the constraint. So this file does what tests/policy/guards.test.ts does: it builds the
// violation itself — a real table with a real bare `token` column, created inside a transaction
// that is rolled back — and asserts the query catches it. The check cannot be defanged later
// without that half going red.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

// A column whose name says "token" must be a hash of one. The escape is not a comment or a
// convention — it is the suffix, so a column that holds the value cannot be named its way past the
// check. LIKE rather than a regex on purpose: this is the shape of a blunt guard, and blunt is what
// makes it unarguable at 2am (docs/pipeline.md §6).
const TOKEN_COLUMNS = `
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND column_name LIKE '%token%'
     AND column_name NOT LIKE '%\\_hash'
   ORDER BY table_name, column_name`;

interface TokenColumn {
  table_name: string;
  column_name: string;
}

async function tokenColumns(db: PoolClient): Promise<TokenColumn[]> {
  const { rows } = await db.query<TokenColumn>(TOKEN_COLUMNS);
  return rows;
}

describe('policy · no column in this database holds a bearer token', () => {
  it('catches a bare token column, which is what makes the next assertion mean something', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    await inRolledBackTransaction(pool, async (tx) => {
      // DDL is transactional in Postgres, so this table exists for the length of this case and is
      // gone whether the case passes, fails or throws. It is created in `public` deliberately: a
      // TEMP table lands in pg_temp_N and would slip past a check scoped to the schema the
      // application actually deploys into, which would make this half of the case a decoration.
      await tx.query('CREATE TABLE session_token_fixture (token text)');
      const found = await tokenColumns(tx);
      assert.deepEqual(found, [
        { table_name: 'session_token_fixture', column_name: 'token' },
      ]);

      // And the suffix is the only way past it. A column that renames itself around the check is
      // the failure mode this asserts is not available.
      await tx.query(
        'CREATE TABLE session_token_fixture_2 (session_token text)',
      );
      const both = await tokenColumns(tx);
      assert.deepEqual(
        both.map((row) => row.column_name),
        ['token', 'session_token'],
      );
    });
  });

  it('finds none in the schema this application deploys', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    await inRolledBackTransaction(pool, async (tx) => {
      const found = await tokenColumns(tx);
      assert.deepEqual(
        found,
        [],
        `a column holds a token in plaintext: ${found
          .map((row) => `${row.table_name}.${row.column_name}`)
          .join(', ')}`,
      );
    });
  });

  it('accepts the hashes the mechanism does keep', async (t) => {
    // staff_session.token_hash is the column this constraint is written around, and a check that
    // also rejected it would be a check nobody could ship. This asserts it exists and is excluded —
    // so the case fails if a later migration renames the hash back to the thing it is a hash of.
    //
    // **It was two columns until slice 5.1b**: staff_invite.token_hash went with the invite when the
    // credential became Google's, and the only bearer value this system still stores is a session's
    // (ADR-0005). The count is what makes that a fact rather than a claim — a later table that
    // starts keeping a token has to come through this case.
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'token_hash'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['staff_session'],
    );
  });
});
