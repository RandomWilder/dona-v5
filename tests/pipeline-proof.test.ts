// DELIBERATELY RED — slice 1.10, leg 1. This file exists to be blocked, and is deleted by the very
// next commit. The claim under test is not about the code: it is that a pull request carrying a
// failing test cannot merge into `main`, for the person who set the protection up as much as for
// anyone else (`enforce_admins: true`, flipped at the end of slice 1.6).
//
// docs/pipeline.md §9's last line — prove the pipeline in both directions on purpose, on the one
// week nothing depends on it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('slice 1.10 — the break leg', () => {
  it('fails on purpose so the gate can be seen refusing a merge', () => {
    assert.equal('red', 'green');
  });
});
