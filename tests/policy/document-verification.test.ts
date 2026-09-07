// The right slot with the wrong file. Slice 3.3, and it is the whole of that slice's acceptance bar:
// uploading an ארנונה bill into the lease slot is caught before it is filed.
//
// **Why this is a policy case and not only a unit test.** docs/pipeline.md §6 is the gate for
// everything no model may decide, and type here is *declared, not detected* (SPEC-flows.md invariant
// 6) — there is no classifier, so the check that a declaration matches the bytes is deterministic by
// construction and stays that way. tests/policy/document-path.test.ts is the precedent for a case in
// this suite that asserts against TypeScript rather than SQL, and the reason is the same in both
// places: the constraint is tested where the constraint lives.
//
// **The terms come off the catalogue, never out of this file.** `verification_terms` is a column on
// `document_type` (slice 3.1) and the seed is `src/evidence/fixtures/document-types.ts`, so a type
// added as a row arrives with its own guard and joins this matrix without an edit here — A8's open
// half holding for the first thing that consumes the catalogue. The fixture is read rather than the
// database for the reason document-path.test.ts needs no database either: the seed is the same data,
// and `src/evidence/schema.test.ts` is where it is proved to be what Postgres holds.
//
// **The documents are the tier-1 specimens**, which is what the slice's Verify step asks for. They
// are Hebrew text authored to the published forms' structure (docs/corpus/README.md); the path that
// turns a real PDF into text is `src/kernel/pdf.ts`'s and is tested there, and what this case is
// about is the decision taken over the text, in both directions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { verifyDeclaredType } from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';

// Which specimen is a document of which seeded type. Written out rather than derived, because the
// pairing is the fact under test: a file and a type key are two independent statements and the guard
// exists to catch the case where they disagree.
const SPECIMEN_TYPES: Record<string, string> = {
  'lease-standard.md': 'lease',
  'arnona-bill.md': 'arnona',
  'handover-protocol.md': 'handover_protocol',
  'bank-guarantee.md': 'bank_guarantee',
  'insurance-certificate.md': 'insurance',
};

// The operator's own service procedure. It follows no published form and is not a filed document —
// it is the global knowledge base, which is what `clause_source: policy` says.
const NOT_A_FILED_DOCUMENT = 'service-policy.md';

// Seeded types the tier-1 corpus has no specimen for yet. Named so that the coverage case below can
// tell "no specimen written" from "specimen written and nobody classified it".
const NO_SPECIMEN_YET = [
  'lease_amendment',
  'termination_notice',
  'id',
  'inspection_certificate',
];

const termsFor = (typeKey: string): string[] => {
  const seed = seedDocumentTypes.find(
    (entry) => entry.type.typeKey === typeKey,
  );
  assert.ok(seed, `${typeKey} is not a seeded document type`);
  const terms = seed.type.verificationTerms;
  assert.ok(terms && terms.length > 0, `${typeKey} declares no marker terms`);
  return terms;
};

const textOf = (file: string): string => {
  const specimen = specimenDocuments.find((entry) => entry.file === file);
  assert.ok(specimen, `${file} is not in the tier-1 corpus`);
  return specimen.text;
};

describe('policy · a declared type is checked against the file before it is filed', () => {
  it('accepts every specimen in its own slot', () => {
    for (const [file, typeKey] of Object.entries(SPECIMEN_TYPES)) {
      const result = verifyDeclaredType(textOf(file), termsFor(typeKey));
      assert.equal(result.verdict, 'verified', `${file} as ${typeKey}`);
      assert.deepEqual(result.missingTerms, []);
    }
  });

  it('refuses an ארנונה bill declared as a lease', () => {
    // The slice's acceptance bar, named on its own rather than only as one cell of the matrix
    // below: this is the sentence tasks/todo.md was written with.
    const result = verifyDeclaredType(
      textOf('arnona-bill.md'),
      termsFor('lease'),
    );
    assert.equal(result.verdict, 'refused');
    assert.ok(
      result.missingTerms.length > 0,
      'a refusal names what was missing, or an operator cannot act on it',
    );
  });

  it('refuses a lease declared as an ארנונה bill — the other direction', () => {
    // Both directions, because the failure that matters is a *pairing* and a guard that only ever
    // caught one order would pass a whole class of misfiling. The lease does say ארנונה, in the
    // clause about who pays the utilities, which is why one matching term can never be enough.
    const result = verifyDeclaredType(
      textOf('lease-standard.md'),
      termsFor('arnona'),
    );
    assert.equal(result.verdict, 'refused');
    assert.ok(result.missingTerms.length > 0);
  });

  it('refuses every specimen in every slot that is not its own', () => {
    for (const [file, own] of Object.entries(SPECIMEN_TYPES)) {
      for (const typeKey of Object.values(SPECIMEN_TYPES)) {
        if (typeKey === own) continue;
        const result = verifyDeclaredType(textOf(file), termsFor(typeKey));
        assert.equal(result.verdict, 'refused', `${file} as ${typeKey}`);
      }
    }
  });

  it('files a document it cannot read rather than refusing it, and says so', () => {
    // A scan and a photograph carry no text layer, and OCR is slice 4.1's. Refusing them would
    // refuse most real leases; filing them silently would make `verified` mean nothing. The third
    // verdict is what keeps both honest, and it is the one the audit line records.
    for (const text of ['', '   \n  ', null]) {
      const result = verifyDeclaredType(text, termsFor('lease'));
      assert.equal(result.verdict, 'unverified');
      assert.deepEqual(result.missingTerms, []);
    }
  });

  it('treats a type with no declared terms as unguarded, never as unfileable', () => {
    // `verification_terms` is nullable on purpose (SPEC-evidence.md): a type nobody has written
    // marker terms for is one this check has nothing to say about, and a guard that refused it
    // would make the catalogue's open half closed again.
    for (const terms of [null, []]) {
      const result = verifyDeclaredType(textOf('lease-standard.md'), terms);
      assert.equal(result.verdict, 'unguarded');
    }
  });

  it('covers every seeded type and every specimen, so neither can arrive unclassified', () => {
    // document-path.test.ts's last case, for the same reason: a tenth document type or a sixth
    // specimen fails here until somebody decides which slot it belongs in. That decision is the
    // constraint.
    const classified = [...Object.values(SPECIMEN_TYPES), ...NO_SPECIMEN_YET];
    for (const seed of seedDocumentTypes) {
      assert.ok(
        classified.includes(seed.type.typeKey),
        `${seed.type.typeKey} is seeded and is in neither list`,
      );
    }
    assert.equal(classified.length, seedDocumentTypes.length);

    for (const specimen of specimenDocuments) {
      assert.ok(
        specimen.file === NOT_A_FILED_DOCUMENT ||
          specimen.file in SPECIMEN_TYPES,
        `${specimen.file} is in the corpus and is not classified`,
      );
    }
  });
});
