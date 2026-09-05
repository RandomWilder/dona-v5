// Slice 1.6, deliberately red, pushed directly to `main` and reverted in the next commit.
//
// The acceptance criterion for this slice is that a red commit cannot reach staging *even by a
// direct push to main* — the branch protection is not what proves that, because an admin can push
// past it and because protection says nothing about deployment. What proves it is the wiring:
// deploy.yml fires on `workflow_run` after CI *concludes*, and its job is gated on
// `conclusion == 'success'`, so a failing gate leaves the previous revision serving.
//
// This file is that test's input. It is not a test of anything in this system.
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('deliberately fails, so CI goes red on main', () => {
  assert.equal('red', 'green');
});
