import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  hasIdentifierRun,
  IDENTIFIER_MASK,
  maskIdentifierRuns,
} from './identifier.ts';
import { newId } from './ids.ts';

// The four shapes an unanchored `\d{9}` fires on, and every one of them is already rendered by a
// screen this pattern is about to be run over: a UUID in a form action, a file hash in the overlay's
// facts list, a base64 data URI carrying the page image, an ISO date on a lease card.
describe('the identifier shape', () => {
  it('finds a ת.ז. however a person typed it', () => {
    assert.ok(hasIdentifierRun('312345678'));
    assert.ok(hasIdentifierRun('312-345-678'));
    assert.ok(hasIdentifierRun('312 345 678'));
    assert.ok(hasIdentifierRun('ת.ז. 312345678'));
    assert.ok(hasIdentifierRun('<dd>312345678</dd>'));
  });

  it('does not fire on a UUID, which is what week 5 and 6.5 each got wrong once', () => {
    assert.equal(
      hasIdentifierRun('11111111-1111-4111-8111-111111111111'),
      false,
    );
    for (let i = 0; i < 2000; i++) {
      assert.equal(hasIdentifierRun(newId()), false);
    }
  });

  it('does not fire on a file hash, a data URI or an ISO date', () => {
    // A 64-character hex digest carries a bare nine-digit run about four times in five, which is
    // why this loop is a loop: one sample would pass on a bad pattern most of the time.
    for (let i = 0; i < 2000; i++) {
      const digest = createHash('sha256').update(String(i)).digest('hex');
      assert.equal(hasIdentifierRun(digest), false, digest);
    }
    const bytes = new Uint8Array(600);
    for (let i = 0; i < 200; i++) {
      webcrypto.getRandomValues(bytes);
      const uri = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
      assert.equal(hasIdentifierRun(uri), false, uri);
    }
    assert.equal(hasIdentifierRun('2026-09-20'), false);
    assert.equal(hasIdentifierRun('X-Goog-Expires=900'), false);
    assert.equal(hasIdentifierRun('gs://dona-v5-staging-docs/unit/12A'), false);
  });

  it('does not fire on a longer run, which is not an identifier either', () => {
    assert.equal(hasIdentifierRun('1234567890123'), false);
  });

  it('masks a printed run and leaves the rest of the line', () => {
    assert.equal(
      maskIdentifierRuns('ת.ז. 312345678 של השוכר'),
      `ת.ז. ${IDENTIFIER_MASK} של השוכר`,
    );
    assert.equal(maskIdentifierRuns('דמי שכירות 4,520'), 'דמי שכירות 4,520');
  });
});
