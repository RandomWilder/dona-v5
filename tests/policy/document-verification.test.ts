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
  'lease-amendment.md': 'lease_amendment',
  'arnona-bill.md': 'arnona',
  'handover-protocol.md': 'handover_protocol',
  'building-handover-protocol.md': 'building_handover_protocol',
  'bank-guarantee.md': 'bank_guarantee',
  'insurance-certificate.md': 'insurance',
};

// The operator's own service procedure. It follows no published form and is not a filed document —
// it is the global knowledge base, which is what `clause_source: policy` says.
const NOT_A_FILED_DOCUMENT = 'service-policy.md';

// Seeded types the tier-1 corpus has no specimen for yet. Named so that the coverage case below can
// tell "no specimen written" from "specimen written and nobody classified it".
// **The one ordered pair the printed language cannot separate, found at 7.1 by the specimen that
// made it visible.** A נספח is not a foreign document in the lease slot — it is the *same* lease's
// paper, and it recites the document it amends by construction: the standard annex is headed
// `נספח לחוזה שכירות`, names המושכר and is about תקופת השכירות, which is the whole of the lease's
// declaration. No choice of marker terms refuses it, because the guard can say *must contain* and
// has no way to say *must not*, and an annex's vocabulary is a superset of its lease's.
//
// So it is written here as a measured exception rather than tuned away. Two things make that
// honest: the pair is asserted below in both directions — the annex verifies as a lease and a lease
// is still refused as an annex — and the exception is one named pair, so a *third* specimen
// verifying in the lease slot fails the matrix exactly as before. Separating lease from annex needs
// negation in the term language or the extracted values, and neither is this guard's job.
const LEASE_PAPER_SUPERSET: ReadonlyArray<readonly [string, string]> = [
  ['lease-amendment.md', 'lease'],
];

const NO_SPECIMEN_YET = ['termination_notice', 'id', 'inspection_certificate'];

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
        if (
          LEASE_PAPER_SUPERSET.some(
            ([specimen, slot]) => specimen === file && slot === typeKey,
          )
        ) {
          continue;
        }
        const result = verifyDeclaredType(textOf(file), termsFor(typeKey));
        assert.equal(result.verdict, 'refused', `${file} as ${typeKey}`);
      }
    }
  });

  it('cannot refuse a lease its own annex, and the exception is one named pair', () => {
    // The exception above, asserted rather than assumed. A hole in a matrix that nobody measures
    // stops being a decision and becomes a gap, so both directions are stated here as facts.
    for (const [file, slot] of LEASE_PAPER_SUPERSET) {
      const result = verifyDeclaredType(textOf(file), termsFor(slot));
      assert.equal(
        result.verdict,
        'verified',
        `${file} no longer verifies as ${slot}; the exception has outlived its reason`,
      );
    }
    // And the direction that must not go: a lease is not an annex, and the annex declaration is
    // what refuses it. This is the half that would have been lost if the pair had been excused in
    // both directions.
    assert.equal(
      verifyDeclaredType(
        textOf('lease-standard.md'),
        termsFor('lease_amendment'),
      ).verdict,
      'refused',
    );
    // The declaration this slice corrected. `['נספח', 'לחוזה השכירות']` verified the bank guarantee
    // — `נספח` is every annex there is, and `לחוזה השכירות` matched the guarantee's
    // `של חוזה השכירות` once the whitespace came out. Both halves are held here, on the specimen
    // that proved it, so the old declaration cannot come back as a settings edit nobody measured.
    assert.equal(
      verifyDeclaredType(
        textOf('bank-guarantee.md'),
        termsFor('lease_amendment'),
      ).verdict,
      'refused',
    );
    assert.equal(
      verifyDeclaredType(textOf('bank-guarantee.md'), ['נספח', 'לחוזה השכירות'])
        .verdict,
      'verified',
    );
  });

  it('measures the title-only lease declaration the director asked about, and refuses it', () => {
    // **The director's comment on `mockups/document-intake.html`, answered with a number.** The
    // proposal was to add `הסכם שכירות` — already declared since 6.8, as a spelling of the title
    // requirement — or to *replace* the two body terms with the title alone. The replacement is
    // what this case measures, against every specimen in the corpus.
    //
    // The result: on this corpus the candidate and the live declaration are **indistinguishable**.
    // Both verify `lease-standard.md` and `lease-amendment.md` and refuse the other six. So the
    // corpus does not argue for the replacement, and 6.8's argument — that the body terms are what
    // separate a lease from a document that merely cites one — survives untested rather than
    // refuted: `termination_notice` is the type it is aimed at and has no specimen yet. Two terms
    // that cost nothing measurable and guard a type nobody has written a specimen for stay.
    const candidate = ['חוזה שכירות|הסכם שכירות'];
    const verdicts = (terms: readonly string[]): string[] =>
      specimenDocuments
        .filter(
          (entry) =>
            verifyDeclaredType(entry.text, terms).verdict === 'verified',
        )
        .map((entry) => entry.file)
        .sort();

    assert.deepEqual(verdicts(candidate), [
      'lease-amendment.md',
      'lease-standard.md',
    ]);
    assert.deepEqual(verdicts(candidate), verdicts(termsFor('lease')));
  });

  it('accepts a requirement written in either of its declared spellings', () => {
    // **Slice 6.8.** A requirement may carry more than one spelling, separated by `|`, because a
    // standard Israeli lease is headed either חוזה שכירות or הסכם שכירות and calls the flat either
    // המושכר or הדירה. The week-6 demo's paper used the second of each and was refused: correct
    // behaviour, wrong calibration.
    //
    // The document here is built out of the catalogue's own declarations rather than taken from the
    // corpus, and that is the point — what is under test is the *declaration*, not a form. Every
    // seeded type is walked and every spelling of every requirement is exercised, so a type that
    // declares an alternative nobody's guard honours fails here. The corpus keeps its own job in
    // the matrix above: a widened type that started matching a foreign specimen fails there.
    for (const seed of seedDocumentTypes) {
      const terms = seed.type.verificationTerms ?? [];
      const widest = Math.max(
        0,
        ...terms.map((term) => term.split('|').length),
      );
      for (let spelling = 0; spelling < widest; spelling += 1) {
        const text = terms
          .map((term) => {
            const spellings = term.split('|');
            return spellings[Math.min(spelling, spellings.length - 1)];
          })
          .join(' ובנוסף ');
        const result = verifyDeclaredType(text, terms);
        assert.equal(
          result.verdict,
          'verified',
          `${seed.type.typeKey}, spelling ${spelling + 1}: ${result.missingTerms.join(', ')}`,
        );
      }
    }
  });

  it('still requires every requirement, whichever spelling satisfied the others', () => {
    // The half that is not a loosening. `|` widens one requirement; it does not make any-term
    // filing lawful. A lease that is headed הסכם שכירות and says הדירה and never names a term of
    // letting is still not a lease as far as the guard is concerned, and the missing requirement
    // is named as printed so the screen can show both spellings of it.
    const result = verifyDeclaredType(
      'הסכם שכירות שנחתם בין הצדדים בדבר הדירה שברחוב נרקיס 45',
      termsFor('lease'),
    );
    assert.equal(result.verdict, 'refused');
    assert.deepEqual(result.missingTerms, ['תקופת השכירות']);
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
