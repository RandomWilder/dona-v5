import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  documentTypeFields,
  type MappedFinding,
  type MeasuredWord,
  mapFieldsFromWords,
  parseMeasuredWords,
  type Queryable,
} from '../src/evidence/contract.ts';
import { KernelError } from '../src/kernel/errors.ts';
import type { Extractor } from '../src/kernel/extraction.ts';
import type {
  ArithmeticCheck,
  GroundTruthDocument,
} from './fixtures/lease-extraction.ts';
import { leaseGroundTruth } from './fixtures/lease-extraction.ts';

// The extraction golden set. Ticket #127, SPEC-evidence.md *The reading is scored before it is
// improved*.
//
// **The output is a number, not an improvement.** Nothing here touches the reader. It runs the
// mapper exactly as it stands, over the two specimen leases, and compares every value it returns
// against `fixtures/lease-extraction.ts` — the hand reading of those same pages. Until this existed,
// every claim about how well this system reads a lease was an argument from the shape of the code.
//
// Three things are encoded in arithmetic here rather than in prose, because prose does not fail a
// build:
//
//   1. **Required and optional accuracy are two numbers and never one.** A miss on `guarantor_name`
//      and a miss on `rent_amount` are not the same failure, and a single percentage hides which of
//      the two you are looking at.
//   2. **A credited absence scores as right.** The second specimen names no guarantor at all, so
//      returning zero of them is the correct answer. A scorer that penalised a correct nothing would
//      tune the reader toward inventing values — the exact failure this module's doctrine, *a
//      missing required field is a result, not an error*, exists to prevent.
//   3. **A value the fixture does not carry fails the gate**, where a value it carries and the
//      reader missed only moves a percentage. Stopping short and making something up are different
//      defects and a single accuracy number cannot tell them apart.

/** One value the reader returned, as the store would hold it. Captured, never the raw span. */
export interface ReadValue {
  fieldKey: string;
  value: string;
  page: number;
  /**
   * What the measuring engine believed about the words this was read from, when it said anything.
   *
   * The ticket's line is *a value returned with a confident citation that disagrees with the fixture
   * is a failure*, and the grading here is stricter than that: every value that survives capture has
   * a citation, and all of them are graded. The number is carried so a failure line can print it —
   * a contradiction read off words the processor was unsure of is a different conversation from one
   * read off words it was certain about, and the person reading the failure needs to know which.
   */
  confidence: number | null;
}

/** One declaration in force today, read from `document_type_field` and never from the fixture. */
export interface DeclaredField {
  fieldKey: string;
  isRequired: boolean;
}

/**
 * Which accuracy a value counts toward.
 *
 * `not-declared` is the third group and it is scored by nothing: the mapping schema restricts
 * `field_key` to the declared list, so the reader cannot return a key the catalogue has not asked
 * for. Folding those into either percentage would report a gap in the catalogue as a defect in the
 * reader. The group shrinks as track B's seed rows land, which is why it is counted rather than
 * dropped. #131 emptied `maintenance_amount` from it; `gush` and `helka` stay.
 */
export type ScoreGroup = 'required' | 'optional' | 'not-declared';

export type Verdict =
  /** The fixture's value came back exactly. */
  | 'matched'
  /** The fixture carries it and the reader did not return it. A number, not a failure. */
  | 'missed'
  /** The fixture credits an absence and the reader returned nothing. Correct. */
  | 'credited'
  /** The reader returned something the fixture does not carry for this key. A failure. */
  | 'invented'
  /** The catalogue does not declare this key, so nothing was asked for and nothing is graded. */
  | 'not-declared';

export interface ValueScore {
  documentKey: string;
  fieldKey: string;
  group: ScoreGroup;
  /** What the paper says, or null on a credited absence and on an invented value. */
  expected: string | null;
  /** What the reader returned, or null on a miss and on a credited absence. */
  got: string | null;
  verdict: Verdict;
}

export interface IdentityScore {
  documentKey: string;
  equals: string;
  /** `(rent_amount + maintenance_amount) × 2 = deposit_amount`, for a failure line. */
  expression: string;
  /** Whether the hand reading satisfies its own identity. A fixture edit that breaks one is a bug. */
  fixture: 'holds' | 'breaks';
  /**
   * Whether the reader's own figures satisfy it.
   *
   * **`unreachable` is for an operand the catalogue does not declare.** Until #131 that was every
   * identity, because all four multiply `maintenance_amount`. Reporting that as `not-returned` —
   * the word for a reader that was asked and stayed silent — would read as a reader's miss rather
   * than as an instrument that is switched off. The identities are reachable now that the seed
   * rows landed; `unreachable` stays in the union for the next undeclared operand.
   */
  reading: 'holds' | 'breaks' | 'not-returned' | 'unreachable';
}

/**
 * One value the reader returned that the paper does not support.
 *
 * **Identified by document, key and value — never by the sentence that reports it.** The sentence
 * carries the page and the processor's confidence because a person reading a failure needs them, and
 * both of those move between runs of the same reader on the same words. A ratchet that recorded the
 * sentence would go stale the first time a confidence shifted in the third decimal, and would report
 * a defect as fixed while it was still happening.
 */
export interface Contradiction {
  documentKey: string;
  fieldKey: string;
  value: string;
  page: number;
  confidence: number | null;
}

/** The stable identity of a contradiction, and what the ratchet records. */
export function contradictionKey(one: {
  documentKey: string;
  fieldKey: string;
  value: string;
}): string {
  return `${one.documentKey}: ${one.fieldKey}=${one.value}`;
}

export function contradictionLine(one: Contradiction): string {
  return (
    `${contradictionKey(one)} (page ${one.page}` +
    `${one.confidence === null ? '' : `, confidence ${one.confidence.toFixed(2)}`}` +
    `) is cited and the fixture does not carry it`
  );
}

export interface DocumentScore {
  key: string;
  values: ValueScore[];
  identities: IdentityScore[];
  contradictions: Contradiction[];
  /** Everything that fails outright: the contradictions above, and any broken identity. */
  failures: string[];
}

export interface Accuracy {
  matched: number;
  total: number;
}

export interface ExtractionScore {
  documents: DocumentScore[];
  required: Accuracy;
  optional: Accuracy;
  /** Fixture values the catalogue does not declare. Counted, never scored. */
  notDeclared: number;
  contradictions: Contradiction[];
  /** Broken identities and a fixture that disagrees with the catalogue. Never a miss. */
  failures: string[];
}

/** A floor the reader may not fall below, set from a measured baseline. Null until one is taken. */
export interface ExtractionRatchet {
  requiredAtLeast: number | null;
  optionalAtLeast: number | null;
  /**
   * **How many values the reader may return that the paper does not support.**
   *
   * The ticket asks that a value disagreeing with the fixture fail the gate, and the first design
   * here was the obvious reading of that: name the ones the baseline found and fail anything new.
   * **Measurement killed it.** Five runs of one reader over identical words produced eight distinct
   * contradictions, five of which appeared exactly once — the model is not deterministic at
   * `reasoning: none`, and an allowlist keyed on which contradiction would have been red on almost
   * every run while telling nobody anything.
   *
   * A ceiling on the count survives that and still holds the line the ticket cares about: a change
   * that makes the reader invent more than it invents today fails, whichever values it invents. It
   * is set to the **worst** of the baseline runs, not the average, because a floor that half the runs
   * fall through is a coin flip rather than a gate — `evals/measure.ts` makes this argument about
   * rank and it is the same argument.
   *
   * Every contradiction is still printed in full, every run. None of them is acceptable and the
   * ceiling is not a budget to spend; it is the number that has to come down.
   */
  contradictionsAtMost: number | null;
  note?: string;
  measured?: string;
}

function groupOf(
  fieldKey: string,
  declared: ReadonlyMap<string, DeclaredField>,
): ScoreGroup {
  const declaration = declared.get(fieldKey);
  if (!declaration) return 'not-declared';
  return declaration.isRequired ? 'required' : 'optional';
}

/**
 * Score one specimen.
 *
 * Values are matched as a **multiset** per field key, because a lease is signed by more than one
 * person and `tenant_name` legitimately comes back twice. Matching by key alone would let one
 * correct name cover for a second one that is wrong.
 */
export function scoreDocument(
  truth: GroundTruthDocument,
  declaredFields: readonly DeclaredField[],
  read: readonly ReadValue[],
): DocumentScore {
  const declared = new Map(
    declaredFields.map((field) => [field.fieldKey, field]),
  );
  const values: ValueScore[] = [];
  const failures: string[] = [];
  const contradictions: Contradiction[] = [];

  const scored = (
    fieldKey: string,
    group: ScoreGroup,
    verdict: Verdict,
    over: { expected?: string | null; got?: string | null } = {},
  ): void => {
    values.push({
      documentKey: truth.key,
      fieldKey,
      group,
      expected: over.expected ?? null,
      got: over.got ?? null,
      verdict,
    });
  };

  // One sentence for a value the paper does not support, wherever it was found — a surplus under a
  // key the fixture carries, one under a key it says nothing about, or one where it credits an
  // absence. Three routes to the same defect, and a reader of the failure should not have to notice
  // that they were three.
  const contradicts = (fieldKey: string, one: ReadValue): void => {
    contradictions.push({
      documentKey: truth.key,
      fieldKey,
      value: one.value,
      page: one.page,
      confidence: one.confidence,
    });
  };

  // In fixture order, then the credited absences, so a report reads down the page the way the
  // fixture is written.
  const keys: string[] = [];
  for (const one of [...truth.values, ...truth.absent]) {
    if (!keys.includes(one.fieldKey)) keys.push(one.fieldKey);
  }

  for (const fieldKey of keys) {
    const group = groupOf(fieldKey, declared);
    const expected = truth.values
      .filter((one) => one.fieldKey === fieldKey)
      .map((one) => one.value);
    const credited = truth.absent.some((one) => one.fieldKey === fieldKey);
    const got = read.filter((one) => one.fieldKey === fieldKey);

    if (group === 'not-declared') {
      for (const value of expected) {
        scored(fieldKey, group, 'not-declared', { expected: value });
      }
      // A key the catalogue does not declare cannot be returned by a mapping schema that enumerates
      // the declared keys. If one comes back anyway the schema is not doing what it says.
      for (const one of got) {
        contradicts(fieldKey, one);
      }
      continue;
    }

    const remaining = [...got];
    for (const value of expected) {
      const at = remaining.findIndex((one) => one.value === value);
      if (at >= 0) {
        remaining.splice(at, 1);
        scored(fieldKey, group, 'matched', { expected: value, got: value });
      } else {
        scored(fieldKey, group, 'missed', { expected: value });
      }
    }

    if (credited) {
      // A credited absence answered with a value is two facts: the correct nothing was not returned,
      // and something the paper does not support was. It is scored as the first and fails as the
      // second, and the surplus loop below is what says so — so the value rides along here rather
      // than being dropped, or the miss would print as a bare dash and read like an ordinary miss.
      scored(fieldKey, group, got.length === 0 ? 'credited' : 'missed', {
        got: got.map((one) => one.value).join(', ') || null,
      });
    }

    for (const surplus of remaining) {
      scored(fieldKey, group, 'invented', { got: surplus.value });
      contradicts(fieldKey, surplus);
    }
  }

  // A value the reader returned for a key the fixture says nothing about at all — neither a value
  // nor a credited absence. The same failure as a surplus, found a different way.
  for (const one of read) {
    if (!keys.includes(one.fieldKey)) {
      scored(one.fieldKey, groupOf(one.fieldKey, declared), 'invented', {
        got: one.value,
      });
      contradicts(one.fieldKey, one);
    }
  }

  const identities = truth.arithmetic.map((check) =>
    scoreIdentity(truth, check, declared, read, failures),
  );

  return { key: truth.key, values, identities, contradictions, failures };
}

function expressionOf(check: ArithmeticCheck): string {
  return `(${check.operands.join(' + ')}) × ${check.multiplier} = ${check.equals}`;
}

function onlyNumber(
  values: readonly { fieldKey: string; value: string }[],
  fieldKey: string,
): number | null {
  const found = values.filter((one) => one.fieldKey === fieldKey);
  // Exactly one, on `asBareNumber`'s argument: two candidates and picking between them would be the
  // scorer deciding a term of the contract.
  if (found.length !== 1) return null;
  const parsed = Number((found[0] as { value: string }).value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreIdentity(
  truth: GroundTruthDocument,
  check: ArithmeticCheck,
  declared: ReadonlyMap<string, DeclaredField>,
  read: readonly ReadValue[],
  failures: string[],
): IdentityScore {
  const expression = expressionOf(check);
  // Every part has to be a key the reader could return before the reading side of this check means
  // anything. See `IdentityScore.reading`.
  const reachable = [...check.operands, check.equals].every((key) =>
    declared.has(key),
  );

  const handOperands = check.operands.map((key) =>
    onlyNumber(truth.values, key),
  );
  const handEquals = onlyNumber(truth.values, check.equals);
  const handHolds =
    handOperands.every((one) => one !== null) &&
    handEquals !== null &&
    handOperands.reduce((sum, one) => sum + (one as number), 0) *
      check.multiplier ===
      check.product &&
    handEquals === check.product;
  if (!handHolds) {
    failures.push(
      `${truth.key}: the fixture's own ${expression} does not come to ${check.product}`,
    );
  }

  const readOperands = check.operands.map((key) => onlyNumber(read, key));
  const readEquals = onlyNumber(read, check.equals);
  let reading: IdentityScore['reading'] = reachable
    ? 'not-returned'
    : 'unreachable';
  if (
    reachable &&
    readOperands.every((one) => one !== null) &&
    readEquals !== null
  ) {
    const product =
      readOperands.reduce((sum, one) => sum + (one as number), 0) *
      check.multiplier;
    reading = product === readEquals ? 'holds' : 'breaks';
    if (reading === 'breaks') {
      failures.push(
        `${truth.key}: the reading returns every part of ${expression} and ${check.equals}=${readEquals}, which the identity refuses (${product})`,
      );
    }
  }

  return {
    documentKey: truth.key,
    equals: check.equals,
    expression,
    fixture: handHolds ? 'holds' : 'breaks',
    reading,
  };
}

export interface SpecimenRun {
  truth: GroundTruthDocument;
  read: readonly ReadValue[];
}

/** Every specimen, the two accuracies, and everything that failed outright. */
export function scoreExtraction(
  runs: readonly SpecimenRun[],
  declaredFields: readonly DeclaredField[],
): ExtractionScore {
  const declared = new Map(
    declaredFields.map((field) => [field.fieldKey, field]),
  );
  const documents = runs.map((run) =>
    scoreDocument(run.truth, declaredFields, run.read),
  );
  const failures = documents.flatMap((one) => one.failures);

  // The fixture's `declaration` mark and the live catalogue are two statements about one system, and
  // a seed row that lands without the fixture moving leaves them describing different ones — with
  // the number still looking fine, which is the dangerous part.
  for (const run of runs) {
    for (const one of run.truth.values) {
      const isDeclared = declared.has(one.fieldKey);
      if (isDeclared !== (one.declaration === 'declared')) {
        failures.push(
          `${run.truth.key}: the fixture marks ${one.fieldKey} ${one.declaration} and the catalogue ` +
            `${isDeclared ? 'declares' : 'does not declare'} it`,
        );
      }
    }
  }

  const counted = documents.flatMap((one) => one.values);
  const accuracy = (group: ScoreGroup): Accuracy => {
    // An invented value is a failure and not a denominator: it is already counted as the miss it
    // stands beside, and counting it twice would make one wrong answer cost two.
    const units = counted.filter(
      (one) => one.group === group && one.verdict !== 'invented',
    );
    return {
      matched: units.filter(
        (one) => one.verdict === 'matched' || one.verdict === 'credited',
      ).length,
      total: units.length,
    };
  };

  return {
    documents,
    required: accuracy('required'),
    optional: accuracy('optional'),
    notDeclared: counted.filter((one) => one.verdict === 'not-declared').length,
    contradictions: documents.flatMap((one) => one.contradictions),
    failures: [...new Set(failures)],
  };
}

/** One accuracy as a percentage, or `—` when the group is empty. */
export function percent(accuracy: Accuracy): string {
  if (accuracy.total === 0) return '—';
  return `${((accuracy.matched / accuracy.total) * 100).toFixed(1)}%`;
}

/**
 * Where the reader has fallen below the floor a baseline recorded.
 *
 * The retrieval cases' rule, for the retrieval cases' reason: the floor is what the reader reaches
 * today, so the gate blocks a regression from the first commit while staying green, and the proof
 * that a later change is a fix is that the number goes up. A null floor is a baseline not yet taken
 * and grades nothing — the two accuracies are still printed.
 */
export function checkRatchet(
  score: ExtractionScore,
  ratchet: ExtractionRatchet,
): string[] {
  const failures: string[] = [];
  const check = (
    name: string,
    accuracy: Accuracy,
    floor: number | null,
  ): void => {
    if (floor === null || accuracy.total === 0) return;
    const reached = (accuracy.matched / accuracy.total) * 100;
    if (reached + 1e-9 < floor) {
      failures.push(
        `${name} accuracy is ${percent(accuracy)}, below the ratchet at ${floor}%`,
      );
    }
  };
  check('required-field', score.required, ratchet.requiredAtLeast);
  check('optional-field', score.optional, ratchet.optionalAtLeast);
  if (
    ratchet.contradictionsAtMost !== null &&
    score.contradictions.length > ratchet.contradictionsAtMost
  ) {
    failures.push(
      `the reader returned ${score.contradictions.length} values the fixture does not carry, ` +
        `above the ratchet at ${ratchet.contradictionsAtMost}`,
    );
  }
  return failures;
}

/** One line per verdict, in one place, so the mark and the sentence cannot disagree about a case. */
const VERDICT_LINE: Record<
  Verdict,
  (value: ValueScore) => { mark: string; said: string }
> = {
  matched: (value) => ({ mark: '✔', said: `${value.expected}` }),
  credited: () => ({ mark: '✔', said: 'nothing, correctly' }),
  missed: (value) => ({
    mark: '✘',
    said:
      value.expected === null
        ? `returned ${value.got} where the fixture credits an absence`
        : `${value.expected} — not returned`,
  }),
  invented: (value) => ({
    mark: '✘',
    said: `${value.got} — not in the fixture`,
  }),
  'not-declared': (value) => ({
    mark: '·',
    said: `${value.expected} — not declared, not graded`,
  }),
};

export function formatExtractionReport(
  score: ExtractionScore,
  ratchet: ExtractionRatchet,
): string {
  const lines: string[] = [];
  for (const document of score.documents) {
    lines.push(`  ${document.key}`);
    for (const value of document.values) {
      const { mark, said } = VERDICT_LINE[value.verdict](value);
      lines.push(`    ${mark} ${value.fieldKey}: ${said}`);
    }
    for (const identity of document.identities) {
      const mark =
        identity.fixture === 'holds' && identity.reading !== 'breaks'
          ? identity.reading === 'unreachable'
            ? '·'
            : '✔'
          : '✘';
      lines.push(
        `    ${mark} ${identity.expression} — fixture ${identity.fixture}, reading ${identity.reading}`,
      );
    }
  }
  // Two numbers, on one line each, and never a third that averages them.
  lines.push(
    `extraction: required ${percent(score.required)} (${score.required.matched}/${score.required.total})` +
      `${ratchet.requiredAtLeast === null ? '' : ` · floor ${ratchet.requiredAtLeast}%`}`,
  );
  lines.push(
    `extraction: optional ${percent(score.optional)} (${score.optional.matched}/${score.optional.total})` +
      `${ratchet.optionalAtLeast === null ? '' : ` · floor ${ratchet.optionalAtLeast}%`}`,
  );
  lines.push(
    `extraction: ${score.notDeclared} fixture values the catalogue does not declare, scored by nothing`,
  );
  // **Every contradiction, every run, in full.** The ceiling decides whether the gate goes red; it
  // never decides what gets printed. A report that showed only the ones over the line would be a
  // report in which a value the paper does not support had become unremarkable.
  lines.push(
    `extraction: ${score.contradictions.length} values the fixture does not carry` +
      `${ratchet.contradictionsAtMost === null ? '' : ` · ceiling ${ratchet.contradictionsAtMost}`}`,
  );
  for (const one of score.contradictions) {
    lines.push(`  ~ ${contradictionLine(one)}`);
  }
  // **The verdict is the caller's line and not this one's.** The failures that matter most are the
  // ones that arrive with no score at all — an unreachable model measures nothing and has nothing to
  // format — so printing them here would put the run's verdict in the one place a failed run never
  // reaches. `runExtractionGoldenSet` returns them and `run.ts` prints them, scored or not.
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The specimens themselves, which are never in this repository.
// ---------------------------------------------------------------------------

export const specimenDir = fileURLToPath(
  new URL('specimens/', import.meta.url),
);

export function specimenWordsPath(key: string): string {
  return path.join(specimenDir, `${key}.words.json`);
}

/**
 * The words one specimen was measured into, or null when nobody has captured it here.
 *
 * Null is the honest answer and not an error: a clean clone has no specimen and must stay runnable,
 * exactly as it stays runnable with no `OPENAI_API_KEY`. `npm run specimens:capture` writes these.
 */
export async function loadSpecimenWords(
  key: string,
): Promise<MeasuredWord[] | null> {
  try {
    const raw = await readFile(specimenWordsPath(key), 'utf8');
    return parseMeasuredWords(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Run the mapper over every specimen a capture exists for, and score what comes back.
 *
 * **It calls `mapFieldsFromWords`, which is the reader itself and not a copy of it.** A gate that
 * built its own prompt, its own schema and its own capture rules would report on those rather than
 * on what a filed document gets, and would go on reporting a fine number after the real path broke.
 * Nothing here writes a row: the specimens are not filed documents and this measures rather than
 * files.
 */
export async function runExtractionGoldenSet(deps: {
  db: Queryable;
  extractor: Extractor;
  model: string;
  reasoningEffort?: string;
  /** The day whose declarations are in force, which is a parameter here as everywhere (A8). */
  on: string;
}): Promise<{
  score: ExtractionScore | null;
  ratchet: ExtractionRatchet;
  skipped: string[];
  failures: string[];
}> {
  const ratchet = await loadRatchet();
  const fields = await documentTypeFields(deps.db, 'lease', deps.on);
  const declared: DeclaredField[] = fields.map((field) => ({
    fieldKey: field.fieldKey,
    isRequired: field.isRequired,
  }));

  const runs: SpecimenRun[] = [];
  const skipped: string[] = [];
  for (const truth of leaseGroundTruth) {
    const words = await loadSpecimenWords(truth.key);
    if (!words || words.length === 0) {
      skipped.push(
        `${truth.key} — no capture at ${specimenWordsPath(truth.key)} (npm run specimens:capture)`,
      );
      continue;
    }
    // **A model this run cannot reach is this half failing, and never the run dying.** The other
    // half needs a different provider call and has its own verdict to report; a key the extractor
    // rejects must not decide whether the corpus cases got to run, which is the same independence
    // the ordering above exists for and was worth nothing while this throw was uncaught. It is also
    // what `extractFiledDocument` already does with this exact error on the live path — there it
    // becomes an audit line rather than a 503 — so the gate now treats it as that path does.
    let mapped: MappedFinding[];
    try {
      mapped = await mapFieldsFromWords(deps, { fields, words });
    } catch (error) {
      if (error instanceof KernelError && error.code === 'unavailable') {
        return {
          score: null,
          ratchet,
          skipped,
          // A failure and not a skip: a key was set and a model was asked, so this run intended to
          // measure and did not. Reported in the same breath as which specimen it died on.
          failures: [
            `the extractor could not be reached, so ${truth.key} was not measured: ${error.message}`,
          ],
        };
      }
      throw error;
    }
    runs.push({
      truth,
      read: mapped.map((finding) => ({
        fieldKey: finding.field.fieldKey,
        value: finding.value,
        page: finding.page,
        confidence: finding.confidence,
      })),
    });
  }

  // **`REQUIRE_SPECIMENS=1` turns a skip into a failure**, on exactly the argument the comment above
  // `REQUIRE_EMBEDDINGS` makes: a skip is right on a clean clone and a lie anywhere that meant to
  // measure, because the run goes green having graded nothing.
  //
  // **CI does not set it, and cannot.** The captures hold every word of a signed lease and are
  // therefore permanently outside this repository, so the one place `REQUIRE_*=1` normally lives is
  // the one place this variable can never be set. That is a real limit on this gate and it is
  // written here rather than discovered: the extraction half runs on a machine that holds the
  // documents, and the numbers reach everybody else through the issue and this file's ratchet.
  if (skipped.length > 0 && process.env.REQUIRE_SPECIMENS === '1') {
    return {
      score: null,
      ratchet,
      skipped,
      failures: skipped.map(
        (why) =>
          `REQUIRE_SPECIMENS=1 and a specimen was not measured, not passed: ${why}`,
      ),
    };
  }

  if (runs.length === 0) {
    return { score: null, ratchet, skipped, failures: [] };
  }
  const score = scoreExtraction(runs, declared);
  return {
    score,
    ratchet,
    skipped,
    failures: [...score.failures, ...checkRatchet(score, ratchet)],
  };
}

export const ratchetPath = fileURLToPath(
  new URL('fixtures/extraction-ratchet.json', import.meta.url),
);

export async function loadRatchet(): Promise<ExtractionRatchet> {
  const raw = JSON.parse(await readFile(ratchetPath, 'utf8')) as {
    requiredAtLeast?: unknown;
    optionalAtLeast?: unknown;
    contradictionsAtMost?: unknown;
    note?: unknown;
    measured?: unknown;
  };
  return {
    requiredAtLeast:
      typeof raw.requiredAtLeast === 'number' ? raw.requiredAtLeast : null,
    optionalAtLeast:
      typeof raw.optionalAtLeast === 'number' ? raw.optionalAtLeast : null,
    contradictionsAtMost:
      typeof raw.contradictionsAtMost === 'number'
        ? raw.contradictionsAtMost
        : null,
    note: typeof raw.note === 'string' ? raw.note : undefined,
    measured: typeof raw.measured === 'string' ? raw.measured : undefined,
  };
}
