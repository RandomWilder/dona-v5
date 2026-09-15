import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  CORPUS_DIR,
  specimenClauses,
  specimenDocuments,
  specimenRefs,
} from './specimen-clauses.ts';

// The tier-1 corpus is the substrate every gate runs against, and what `SPEC.md`
// says about it was a comment in a fixture until this file existed: it contains
// no real person. A property asserted in a comment is a property that holds
// until somebody adds a clause on a Tuesday. (It said *no sum of money* too,
// until foundation rule 2 was retired — see the deleted case below.)
//
// The raw files are scanned rather than the parsed clauses, deliberately: a
// phone number in a document's front matter or in the prose above the first
// heading would never be indexed and would still be in the repository.

const corpusPath = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'docs',
  'corpus',
);

function corpusFiles(): { name: string; text: string }[] {
  return readdirSync(corpusPath)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(path.join(corpusPath, name), 'utf8'),
    }));
}

describe('the tier-1 corpus', () => {
  it('is loaded from the files, and every file contributes clauses', () => {
    assert.equal(specimenDocuments.length, 8);
    for (const document of specimenDocuments) {
      assert.ok(
        document.clauses.length > 0,
        `${document.file} indexed no clauses`,
      );
      assert.ok(document.form.length > 0);
      assert.ok(document.follows.length > 0);
    }
    // A loader that read nothing returns an empty corpus, which grades nothing
    // while looking exactly like a green run -- the grep guards' own failure.
    assert.ok(specimenClauses.length > 50, 'the corpus is suspiciously small');
  });

  it('carries both grounding sources, because a refusal needs somewhere to be wrong', () => {
    const sources = new Set(specimenClauses.map((clause) => clause.source));
    assert.deepEqual([...sources].sort(), ['lease', 'policy']);
  });

  it('names every clause exactly once, so a citation is never ambiguous', () => {
    const refs = specimenClauses.map((clause) => clause.ref);
    assert.equal(new Set(refs).size, refs.length);
    for (const ref of Object.values(specimenRefs)) {
      assert.ok(refs.includes(ref), `${ref} is named by a case and is missing`);
    }
  });

  // **The sum-of-money case is deleted** with foundation rule 2
  // (`docs/decisions/ADR-0008-money-is-ordinary-data.md`). It scanned every
  // tier-1 file for ₪, ש"ח, שקל, NIS or a thousands-separated run and failed
  // the build on a match. It cannot stay: the `lease` type now declares a rent
  // and a deposit, and a specimen lease that may not print a rent is a
  // specimen the fields cannot be measured against. The case below is the half
  // of the sentence that was never about money.

  // "Containing no real person" is the sentence `SPEC.md` has carried since
  // 1.1. This is the part of it a machine can check.
  it('holds nothing shaped like a person', () => {
    const identifiers: ReadonlyArray<{ what: string; pattern: RegExp }> = [
      // A national id is nine digits; a mobile is ten. Seven is well below
      // both and above anything a clause legitimately needs.
      { what: 'a long run of digits', pattern: /\d{7,}/ },
      { what: 'an email address', pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
      { what: 'a national id', pattern: /ת\.?[״"]?ז\.?\s*\d/ },
    ];
    for (const { name, text } of corpusFiles()) {
      for (const { what, pattern } of identifiers) {
        const found = pattern.exec(text);
        // `ok` rather than `equal`: a failed `equal` prints the whole match
        // object, and the match object carries the entire file as `input`.
        assert.ok(
          found === null,
          `${CORPUS_DIR}/${name} contains ${what}: ${found?.[0]}`,
        );
      }
    }
  });

  // The ranking ratchet is only worth something if a wrong answer could have
  // won. Six clauses answer "who fixes what" and they disagree with each other
  // on purpose.
  it('keeps near neighbours for the who-fixes-what questions', () => {
    const neighbours = [
      specimenRefs.ownerRepairs,
      specimenRefs.tenantDamage,
      specimenRefs.commonParts,
      'חוזה §7.3',
      'חוזה §7.6',
      'חוזה §11.3',
    ];
    for (const ref of neighbours) {
      assert.ok(
        specimenClauses.some((clause) => clause.ref === ref),
        `${ref} is one of the near neighbours and is missing`,
      );
    }
  });
});
