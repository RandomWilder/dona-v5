// POLICY — an emergency term is a deterministic match, and no model is consulted.
//
// SPEC-calls.md: a Hebrew term inside a longer word matches, because a prefix
// is not a word boundary, and a term in another language matches the same way.
// Foundation rule 5. #185.
//
// Written red first. The first run had no match to call.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emergencyTermMatches } from '../../src/calls/contract.ts';

const TERMS = ['שריפה', 'gas'] as const;

describe('policy · an emergency term matches with no model', () => {
  it('matches a Hebrew term inside a longer word, and a term in another language', () => {
    assert.equal(emergencyTermMatches('יש השריפה בדירה', TERMS), true);
    assert.equal(
      emergencyTermMatches('There is a GAS leak in the kitchen', TERMS),
      true,
    );
    assert.equal(emergencyTermMatches('נזילה במטבח', TERMS), false);
  });
});
