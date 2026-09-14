// The money vocabulary, and the one predicate that reads it. Slice 7.2.
//
// **Why this file exists at all.** `0011_evidence.sql` says it in as many words: "No MONEY member …
// no amount is ever a column on a business record." That is foundation rule 2 — *money never
// touches the agent* — and until slice 7.2 it was enforced by the fact that the field list was
// source code. `src/evidence/fixtures/document-types.ts` says "not one of them is a money field"
// three times, and it could say it, because adding one meant a commit somebody reviewed.
//
// Slice 7.2 opens the declaration to an ADMIN at run time. The moment they may declare a field they
// may declare `rent_amount` as `NUMBER` — `value_type` has no MONEY member, but `NUMBER` is one
// keystroke away from being an amount with no currency and no rounding policy, which is exactly the
// thing rule 2 refuses. So the protection the source file was providing moves here.
//
// **One list, two readers.** `declareDocumentTypeField` refuses against it and
// `tests/policy/money-field.test.ts` proves it against the same constant. A guard whose test
// carries its own copy of the vocabulary is a guard that goes green after somebody shortens the
// real one.
//
// **It is blunt and it over-matches, on purpose** (docs/pipeline.md §6: cheap, blunt, impossible to
// argue with at 2am). `דמי` is inside `הדמיה` and inside `קדמי`, and a field label containing either
// is refused. That is the right trade: a refusal is a conversation with an administrator who can
// rename, and a money field that got in is a rule nobody can enforce afterwards.
//
// **This guard is not on `upsertDocumentTypeField`.** The seed is the deploy-and-a-diff path, and
// that is the price `src/staff/internal/roles.ts` says an irreversible widening should cost —
// a migration, a `value_type` member, a review. Putting the vocabulary under the seed would make
// the rule stronger than it is written, and would leave the `value_type` CHECK a second lock on a
// door with no key.

/**
 * Latin money words, matched **token-wise** against a `field_key`.
 *
 * `field_key` is snake_case by the route's own validation, so the tokens are exact and `fee` cannot
 * fire on `feedback`. A key is not free text and does not need the substring rule below.
 */
export const MONEY_KEY_TOKENS = [
  'amount',
  'rent',
  'deposit',
  'price',
  'fee',
  'payment',
  'sum',
  'balance',
] as const;

/**
 * Hebrew money words, matched as **substrings** against either field.
 *
 * Hebrew attaches its prefixes — `ה`, `ל`, `ב`, `ו`, `מ` all bind to the next word — so a token
 * split on whitespace would miss `הפיקדון` and `ולתשלום`. The over-match this buys is the price of
 * the prefix, and it is the same trade `verify.ts`'s `normalise` takes for verification terms.
 */
export const MONEY_LABEL_TERMS = [
  'שכר דירה',
  'סכום',
  'פיקדון',
  'תשלום',
  'דמי',
  'מחיר',
  'עלות',
  'ערבון',
] as const;

/** Where a declaration named money, or null. The name is what the refusal prints. */
export interface MoneyMatch {
  /** `field_key` or `label_he` — the field the administrator has to change. */
  field: 'field_key' | 'label_he';
  term: string;
}

/**
 * Whether a declaration names money, and where.
 *
 * Both of the declaration's human-readable parts are checked against both lists: an administrator
 * who calls it `extra_1` and labels it `סכום הפיקדון` has declared a money field, and one who calls
 * it `rent_amount` and labels it `נתון נוסף` has too.
 */
export function namesMoney(declaration: {
  fieldKey: string;
  labelHe: string;
}): MoneyMatch | null {
  const key = declaration.fieldKey.toLowerCase();
  const tokens = new Set(key.split(/[^a-z0-9]+/).filter((part) => part !== ''));
  for (const token of MONEY_KEY_TOKENS) {
    if (tokens.has(token)) return { field: 'field_key', term: token };
  }
  for (const term of MONEY_LABEL_TERMS) {
    if (declaration.labelHe.includes(term)) {
      return { field: 'label_he', term };
    }
    // A Hebrew label is the ordinary case and a Hebrew *key* is not possible — the route constrains
    // `field_key` to ASCII — but the key is checked anyway, because the constraint lives on the
    // route and this function is the thing the policy suite asserts against.
    if (declaration.fieldKey.includes(term)) {
      return { field: 'field_key', term };
    }
  }
  for (const token of MONEY_KEY_TOKENS) {
    if (declaration.labelHe.toLowerCase().includes(token)) {
      return { field: 'label_he', term: token };
    }
  }
  return null;
}

/** The refusal's sentence. One place, so the screen, the log and the test all read the same words. */
export function moneyRefusal(match: MoneyMatch): string {
  return (
    `a declaration may not name money — ${match.field} carries "${match.term}". ` +
    'Foundation rule 2: no tenant-facing price and no balance, ever. There is no MONEY value type, ' +
    'and adding one is a migration, a diff and a review — never a form.'
  );
}
