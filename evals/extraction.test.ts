import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedDocumentTypes } from '../src/evidence/fixtures/document-types.ts';
import {
  type Contradiction,
  checkRatchet,
  contradictionKey,
  contradictionLine,
  type DeclaredField,
  type ExtractionRatchet,
  type ReadValue,
  scoreDocument,
  scoreExtraction,
} from './extraction.ts';
import type { GroundTruthDocument } from './fixtures/lease-extraction.ts';
import {
  knownConflicts,
  leaseGroundTruth,
} from './fixtures/lease-extraction.ts';

// The scorer's own suite, and it runs in `npm test` rather than in the gate: what is graded here is
// the arithmetic, which needs no key, no database and no document. The gate is the same arithmetic
// pointed at a real reading.
//
// Two of these cases are assertions about the **fixture** and not about the scorer — the four
// arithmetic identities, and the declared/undeclared marks against the seeded catalogue. They live
// here because a fixture that has drifted from the catalogue produces a number that looks fine and
// measures the wrong thing, and this is the cheapest place that can say so.

const declared: DeclaredField[] = [
  { fieldKey: 'rent_amount', isRequired: true },
  { fieldKey: 'tenant_name', isRequired: true },
  { fieldKey: 'guarantor_name', isRequired: false },
  { fieldKey: 'deposit_amount', isRequired: false },
];

function truth(over: Partial<GroundTruthDocument> = {}): GroundTruthDocument {
  return {
    key: 'specimen',
    letting: 'a flat',
    typeKey: 'lease',
    pdfPages: 2,
    frontMatterPages: 0,
    values: [],
    absent: [],
    arithmetic: [],
    hazards: [],
    ...over,
  };
}

function value(fieldKey: string, val: string, declaration = 'declared') {
  return {
    fieldKey,
    value: val,
    printed: null,
    pdfPage: 1,
    printedPage: 1,
    declaration: declaration as 'declared' | 'undeclared',
  };
}

function read(fieldKey: string, val: string): ReadValue {
  return { fieldKey, value: val, page: 1, confidence: null };
}

const noRatchet: ExtractionRatchet = {
  requiredAtLeast: null,
  optionalAtLeast: null,
  contradictionsAtMost: null,
};

describe('scoring one document against the hand reading', () => {
  it('scores an exact reading as everything matched, in two groups', () => {
    const score = scoreDocument(
      truth({
        values: [
          value('rent_amount', '9300'),
          value('deposit_amount', '19870'),
        ],
      }),
      declared,
      [read('rent_amount', '9300'), read('deposit_amount', '19870')],
    );
    assert.deepEqual(
      score.values.map((one) => [one.fieldKey, one.group, one.verdict]),
      [
        ['rent_amount', 'required', 'matched'],
        ['deposit_amount', 'optional', 'matched'],
      ],
    );
    assert.equal(score.failures.length, 0);
  });

  // The whole point of the two numbers: a missed optional field must not move the required one.
  it('never blends the two, so a missed optional leaves required alone', () => {
    const score = scoreExtraction(
      [
        {
          truth: truth({
            values: [
              value('rent_amount', '9300'),
              value('guarantor_name', 'יונתן עטקין'),
            ],
          }),
          read: [read('rent_amount', '9300')],
        },
      ],
      declared,
    );
    assert.deepEqual(score.required, { matched: 1, total: 1 });
    assert.deepEqual(score.optional, { matched: 0, total: 1 });
  });

  // SPEC-evidence.md: *a missing required field is a result, not an error*, in arithmetic.
  it('credits an absence the document earns, as a correct answer and not a miss', () => {
    const score = scoreDocument(
      truth({
        absent: [{ fieldKey: 'guarantor_name', reason: 'no guarantor exists' }],
      }),
      declared,
      [],
    );
    assert.deepEqual(
      score.values.map((one) => [one.fieldKey, one.group, one.verdict]),
      [['guarantor_name', 'optional', 'credited']],
    );
    assert.equal(score.failures.length, 0);
  });

  it('fails a guarantor invented where the fixture credits an absence', () => {
    const score = scoreDocument(
      truth({
        absent: [{ fieldKey: 'guarantor_name', reason: 'no guarantor exists' }],
      }),
      declared,
      [read('guarantor_name', 'מישהו')],
    );
    assert.deepEqual(
      score.values.map((one) => one.verdict),
      ['missed', 'invented'],
    );
    assert.equal(score.contradictions.length, 1);
    assert.equal(score.contradictions[0]?.fieldKey, 'guarantor_name');
  });

  // A reading the paper does not support is a different defect from a reading that stopped short,
  // and reading them as one hides which.
  it('fails a value that disagrees with the fixture, and still counts the miss', () => {
    const score = scoreDocument(
      truth({ values: [value('rent_amount', '9300')] }),
      declared,
      [read('rent_amount', '8000')],
    );
    assert.deepEqual(
      score.values.map((one) => one.verdict),
      ['missed', 'invented'],
    );
    assert.equal(score.contradictions.length, 1);
    assert.equal(score.contradictions[0]?.value, '8000');
  });

  it('matches two rows under one key as a multiset, and fails the odd one out', () => {
    const both = scoreDocument(
      truth({
        values: [
          value('tenant_name', 'Rami Meir Pinchot'),
          value('tenant_name', 'Ariella Atkin'),
        ],
      }),
      declared,
      [
        read('tenant_name', 'Ariella Atkin'),
        read('tenant_name', 'Rami Meir Pinchot'),
      ],
    );
    assert.deepEqual(
      both.values.map((one) => one.verdict),
      ['matched', 'matched'],
    );

    const half = scoreDocument(
      truth({
        values: [
          value('tenant_name', 'Rami Meir Pinchot'),
          value('tenant_name', 'Ariella Atkin'),
        ],
      }),
      declared,
      [
        read('tenant_name', 'Rami Meir Pinchot'),
        read('tenant_name', 'Somebody Else'),
      ],
    );
    assert.deepEqual(
      half.values.map((one) => one.verdict),
      ['matched', 'missed', 'invented'],
    );
  });

  // The mapping schema restricts field_key to the declared list, so the reader cannot return one of
  // these at all. Counting it as a miss would report a gap in the catalogue as a defect in the
  // reader, which is the one thing a baseline must not do.
  it('counts an undeclared value and scores it by nothing', () => {
    const score = scoreExtraction(
      [
        {
          truth: truth({
            values: [
              value('rent_amount', '9300'),
              value('maintenance_amount', '635', 'undeclared'),
            ],
          }),
          read: [read('rent_amount', '9300')],
        },
      ],
      declared,
    );
    assert.deepEqual(score.required, { matched: 1, total: 1 });
    assert.deepEqual(score.optional, { matched: 0, total: 0 });
    assert.equal(score.notDeclared, 1);
    assert.equal(score.failures.length, 0);
  });

  // A seed row that lands without the fixture moving leaves the two describing different systems,
  // and the number goes on looking fine.
  it('fails when the fixture and the live catalogue disagree about a declaration', () => {
    const score = scoreExtraction(
      [
        {
          truth: truth({
            values: [value('rent_amount', '9300', 'undeclared')],
          }),
          read: [],
        },
      ],
      declared,
    );
    assert.equal(score.failures.length, 1);
    assert.match(score.failures[0] as string, /rent_amount/);
  });
});

describe('the ratchet, which is a floor and a list of known defects', () => {
  const measured = (over: Partial<ExtractionRatchet>): ExtractionRatchet => ({
    ...noRatchet,
    ...over,
  });

  function oneMiss() {
    return scoreExtraction(
      [
        {
          truth: truth({
            values: [
              value('rent_amount', '9300'),
              value('tenant_name', 'Rami Meir Pinchot'),
            ],
          }),
          read: [read('rent_amount', '9300')],
        },
      ],
      declared,
    );
  }

  it('grades nothing while the floors are null, because a floor nobody measured is a guess', () => {
    assert.deepEqual(checkRatchet(oneMiss(), noRatchet), []);
  });

  it('fails a run that has fallen below a floor a baseline recorded', () => {
    // 1 of 2 required is 50%.
    assert.deepEqual(
      checkRatchet(oneMiss(), measured({ requiredAtLeast: 50 })),
      [],
    );
    const below = checkRatchet(oneMiss(), measured({ requiredAtLeast: 81.3 }));
    assert.equal(below.length, 1);
    assert.match(
      below[0] as string,
      /required-field accuracy is 50\.0%.*81\.3/,
    );
  });

  // Five baseline runs over identical words produced eight distinct contradictions, five of them
  // once. A ceiling on the count survives that jitter; an allowlist of which ones does not.
  it('fails a reader that invents more than the ceiling, whatever it invents', () => {
    const two = scoreExtraction(
      [
        {
          truth: truth({
            values: [
              value('rent_amount', '9300'),
              value('deposit_amount', '19870'),
            ],
          }),
          read: [read('rent_amount', '8000'), read('deposit_amount', '1')],
        },
      ],
      declared,
    );
    assert.equal(two.contradictions.length, 2);
    assert.deepEqual(
      checkRatchet(two, measured({ contradictionsAtMost: 2 })),
      [],
    );
    const over = checkRatchet(two, measured({ contradictionsAtMost: 1 }));
    assert.equal(over.length, 1);
    assert.match(
      over[0] as string,
      /returned 2 values.*above the ratchet at 1/,
    );
  });

  // The page and the confidence move between runs of one reader over identical words. A ratchet
  // keyed on the printed sentence would go stale on a third decimal and report a live defect as gone.
  it('keys a contradiction on document, field and value — not on the sentence', () => {
    const one = scoreExtraction(
      [
        {
          truth: truth({ values: [value('rent_amount', '9300')] }),
          read: [
            {
              fieldKey: 'rent_amount',
              value: '8000',
              page: 1,
              confidence: 0.6,
            },
          ],
        },
      ],
      declared,
    );
    const two = scoreExtraction(
      [
        {
          truth: truth({ values: [value('rent_amount', '9300')] }),
          read: [
            {
              fieldKey: 'rent_amount',
              value: '8000',
              page: 9,
              confidence: 0.91,
            },
          ],
        },
      ],
      declared,
    );
    const key = contradictionKey(one.contradictions[0] as Contradiction);
    assert.equal(key, contradictionKey(two.contradictions[0] as Contradiction));
    assert.notEqual(
      contradictionLine(one.contradictions[0] as Contradiction),
      contradictionLine(two.contradictions[0] as Contradiction),
    );
  });
});

describe('the arithmetic the paper asserts about its own numbers', () => {
  it('holds in every identity the fixture records — all four, unconditionally', () => {
    const score = scoreExtraction(
      leaseGroundTruth.map((document) => ({ truth: document, read: [] })),
      // Every key declared, so nothing is skipped for want of a declaration here.
      [
        ...new Set(
          leaseGroundTruth.flatMap((d) => d.values.map((v) => v.fieldKey)),
        ),
      ].map((fieldKey) => ({ fieldKey, isRequired: false })),
    );
    const identities = score.documents.flatMap((one) => one.identities);
    assert.equal(identities.length, 4);
    for (const identity of identities) {
      assert.equal(
        identity.fixture,
        'holds',
        `${identity.documentKey} ${identity.equals}`,
      );
      // Nothing was read, so nothing can be checked against the reading.
      assert.equal(identity.reading, 'not-returned');
    }
  });

  // #131 declared `maintenance_amount`, so the identities are reachable. An empty reading is
  // `not-returned`, not `unreachable` — the instrument is on and the reader was asked.
  it('reports every identity as not-returned once every operand is declared', () => {
    const lease = seedDocumentTypes.find((one) => one.type.typeKey === 'lease');
    assert.ok(lease);
    const live: DeclaredField[] = lease.fields
      .filter((field) => field.effectiveTo === null)
      .map((field) => ({
        fieldKey: field.fieldKey,
        isRequired: field.isRequired,
      }));
    const score = scoreExtraction(
      leaseGroundTruth.map((document) => ({ truth: document, read: [] })),
      live,
    );
    const identities = score.documents.flatMap((one) => one.identities);
    assert.equal(identities.length, 4);
    for (const identity of identities) {
      assert.equal(identity.reading, 'not-returned');
    }
    assert.ok(live.some((one) => one.fieldKey === 'maintenance_amount'));
  });

  it('fails a reading that returns every part and a figure the identity refuses', () => {
    const document = truth({
      values: [
        value('rent_amount', '9300'),
        value('maintenance_amount', '635', 'undeclared'),
        value('deposit_amount', '19870'),
      ],
      arithmetic: [
        {
          operands: ['rent_amount', 'maintenance_amount'],
          multiplier: 2,
          equals: 'deposit_amount',
          product: 19870,
        },
      ],
    });
    const all = [
      ...declared,
      { fieldKey: 'maintenance_amount', isRequired: false },
    ];
    const broken = scoreDocument(document, all, [
      read('rent_amount', '9300'),
      read('maintenance_amount', '635'),
      read('deposit_amount', '18000'),
    ]);
    assert.equal(broken.identities[0]?.reading, 'breaks');
    assert.ok(broken.failures.some((why) => why.includes('deposit_amount')));

    const held = scoreDocument(document, all, [
      read('rent_amount', '9300'),
      read('maintenance_amount', '635'),
      read('deposit_amount', '19870'),
    ]);
    assert.equal(held.identities[0]?.reading, 'holds');
  });
});

describe('what the gate deliberately does not grade', () => {
  // Both specimens print one plot number in the body and another on the plan, identically. There is
  // no right answer to grade, and grading it would penalise a faithful reading.
  it('scores the recorded plot conflict by nothing', () => {
    assert.equal(knownConflicts.length, 1);
    for (const conflict of knownConflicts) {
      assert.ok(!('fieldKey' in conflict));
    }
    const score = scoreExtraction(
      leaseGroundTruth.map((document) => ({ truth: document, read: [] })),
      declared,
    );
    const keys = new Set(
      score.documents.flatMap((d) => d.values.map((v) => v.fieldKey)),
    );
    for (const conflict of knownConflicts) {
      assert.ok(!keys.has(conflict.subject));
    }
  });
});

describe('the fixture and the seeded catalogue', () => {
  it('agree on which of the lease’s field keys are declared', () => {
    const lease = seedDocumentTypes.find((one) => one.type.typeKey === 'lease');
    assert.ok(lease);
    // The declaration in force is the row with an open window; a corrected one closes and a new row
    // opens beside it (R18), so the open rows are what the catalogue says today.
    const current = new Set(
      lease.fields
        .filter((field) => field.effectiveTo === null)
        .map((field) => field.fieldKey),
    );
    for (const document of leaseGroundTruth) {
      for (const one of document.values) {
        assert.equal(
          current.has(one.fieldKey),
          one.declaration === 'declared',
          `${document.key} ${one.fieldKey} is marked ${one.declaration} and the catalogue says otherwise`,
        );
      }
    }
  });
});
