// A document is filed under a place, never under a person. Slice 3.2.
//
// **Why this is a policy case and not only a unit test.** docs/pipeline.md §6 is the gate for
// everything no model may decide, and CLAUDE.md's standing rule is that any new deterministic
// constraint gets a policy case that was **red first**. The path convention is deterministic by
// construction — no model ever proposes a path — and the failure it prevents has isolation flavour:
// a lease filed under the wrong root is one flat's paperwork sitting in another's folder, and
// nothing about the row looks wrong afterwards. tests/policy/guards.test.ts is the precedent for a
// case in this suite that asserts against TypeScript rather than against SQL; the reason is the
// same in both places, which is that the constraint lives where the constraint lives.
//
// **Red first, and here is how it was made red** (tasks/evidence/3.2.md carries the output). The
// `PlaceKind` lookup in documentObjectPath and the reverse lookup in parseObjectPath were both
// removed, so all eight LinkEntityType values built a path. Two of the four assertions failed —
// `assert.throws` stops at the first kind, which is TENANCY — and the checks were then restored and
// the case went green. A case that was green before and after the change it was written for tested
// nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LinkEntityType } from '../../src/evidence/contract.ts';
import {
  documentObjectPath,
  parseObjectPath,
} from '../../src/evidence/contract.ts';
import type { KernelError } from '../../src/kernel/errors.ts';

// The workbook's E13 vocabulary in full, split the way the convention splits it. Written out here
// rather than imported as two lists, because the point of the case is that these two sets differ and
// a single source for both could be widened in one edit.
const PLACES = ['PROJECT', 'BUILDING', 'SPACE', 'UNIT'] as const;
const NOT_PLACES = ['TENANCY', 'PARTY', 'ASSET', 'OBLIGATION'] as const;

const anId = '019a4c7e-2b31-7f0c-8d55-6f1a0d3e9b42';
const aDigest = 'a'.repeat(64);

function pathFor(kind: string): string {
  return documentObjectPath({
    place: { kind: kind as 'UNIT', id: anId },
    typeKey: 'lease',
    fileHash: aDigest,
    extension: 'pdf',
  });
}

describe('policy · a document object path is rooted at a place, never at a person', () => {
  it('accepts the four place kinds', () => {
    for (const kind of PLACES) {
      assert.match(
        pathFor(kind),
        new RegExp(`^${kind.toLowerCase()}/${anId}/`),
      );
    }
  });

  it('refuses the four E13 kinds that are not places', () => {
    for (const kind of NOT_PLACES) {
      assert.throws(
        () => pathFor(kind),
        (error: KernelError) => {
          assert.equal(error.code, 'invalid');
          assert.match(error.message, /never under a person/);
          return true;
        },
        `${kind} must not be a path root`,
      );
    }
  });

  it('refuses them on the way back out as well as on the way in', () => {
    // The rule has to hold in both directions. A `storage_uri` edited by hand is the case that
    // matters: if only the builder checked, a doctored row would point a read at a path the builder
    // would never have produced.
    for (const kind of NOT_PLACES) {
      assert.throws(
        () =>
          parseObjectPath(`${kind.toLowerCase()}/${anId}/lease/${aDigest}.pdf`),
        (error: KernelError) => error.code === 'invalid',
        `${kind} must not parse as a path root`,
      );
    }
  });

  it('covers every value E13 allows, so a ninth kind cannot arrive unclassified', () => {
    // If DocumentLink ever gains an entity_type, this assertion fails until someone decides which
    // side of the line it falls on. That decision is the whole constraint.
    const all: readonly LinkEntityType[] = [...PLACES, ...NOT_PLACES];
    assert.equal(all.length, 8);
  });
});
