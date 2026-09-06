// The pending branch, watched rather than trusted.
//
// `pendingUntilSchema` (support.ts) lets a policy case be written before its schema exists and
// disarm itself when the tables land. Its one hazard is stated in slice 2.1's evidence and in
// tasks/todo.md: **a case that stopped reporting pending and also stopped running looks identical
// in a green summary.** The seven isolation cases spent five weeks reporting pending, and the only
// thing that distinguished "asserting" from "quietly skipping" was a human reading diagnostics.
//
// This case makes that mechanical. Every relation the policy suite declares exists as of 2.2, so no
// case may take the pending branch today; if one does, this goes red and names the relation.
//
// The branch itself stays: weeks 5 and 6 write cases against `obligation`, the state machine and the
// responsibility matrix before those tables exist, and it is what lets them be written first.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POLICY_RELATIONS, policyPool, skipReason } from './support.ts';

describe('policy · the suite is asserting, not pending', () => {
  it('has every relation its cases declare', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      const present = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [[...POLICY_RELATIONS]],
      );
      const found = new Set(present.rows.map((row) => row.table_name));
      const missing = POLICY_RELATIONS.filter((name) => !found.has(name));
      assert.deepEqual(
        missing,
        [],
        `still pending on: ${missing.join(', ')} — the cases that touch these are reporting a diagnostic, not asserting`,
      );
    } finally {
      await pool.end();
    }
  });
});
