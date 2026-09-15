// The cheap guard at the door. Slice 3.3, and SPEC-evidence.md, "Filing a document — flow A1".
//
// Type is **declared, not detected** (SPEC-flows.md invariant 6): the administrator already knows
// what they are holding, so classification — the riskiest ingestion step — does not exist in this
// system. What is left is the error that actually happens on a Tuesday morning: the right slot with
// the wrong file. An ארנונה bill dropped into the lease slot is caught here, before anything is
// written and before the object is put.
//
// **The terms come off the catalogue row and never out of this file.** `verification_terms` is a
// column on `document_type` (slice 3.1, added for this at 3.0), so a type added as a seed row

// arrives with its own guard. A `Record<TypeKey, string[]>` here would make A8 true of the catalogue
// and false of the first thing that consumes it — every new type shipping unguarded until the next
// release.
import { type PdfPage, pageLines } from '../../kernel/pdf.ts';

export type VerificationVerdict =
  // Every declared term is in the text.
  | 'verified'
  // At least one is not. The upload is refused and nothing is written.
  | 'refused'
  // There is no text to read: a photograph, or a scan with no text layer. OCR is slice 4.1's.
  | 'unverified'
  // The type declares no marker terms. Nullable on purpose: unguarded, never unfileable.
  | 'unguarded';

export interface Verification {
  verdict: VerificationVerdict;
  /**
   * What was looked for and not found — empty unless the verdict is `refused`.
   *
   * A refusal an operator cannot act on is a refusal they will work around. These are the form's own
   * printed words and never anything the document itself says, so they are safe to render and safe
   * to put on the audit line; the document's text is neither and appears in neither.
   *
   * **A requirement is named as declared, spellings and all** (6.8) — `המושכר|הדירה` is one missing
   * thing and not two, and the screen is what decides how to print the alternatives. Splitting it
   * here would tell an operator that two words are missing when either would have done.
   */
  missingTerms: string[];
  /**
   * What was looked for **and found** — the other half of the same sentence. **Slice 7.1.**
   *
   * A lease declares three requirements and the screen printed the ones that failed, so a refusal
   * that had checked three named two. The person reading it cannot tell a declaration that is wrong
   * from a file that is wrong without seeing the whole of what was asked: *the title was found, the
   * term of letting was not* is actionable, *the term of letting was not found* is a puzzle. The
   * director's comment on `mockups/document-intake.html` is what found this, and it found it here
   * rather than in the declaration it was aimed at.
   *
   * Empty on every verdict where nothing was checked (`unverified`, `unguarded`) and on those only,
   * exactly as `missingTerms` is. Together with `missingTerms` it is a partition of the declared
   * requirements, named as declared — spellings and all, for the reason above.
   */
  matchedTerms: string[];
}

/**
 * The text of one document, as the guard reads it.
 *
 * `src/kernel/pdf.ts` hands back positioned items rather than a string, because a citation has to be
 * traceable to a place on a page (week 4). This flattens them, which is all a term check needs and
 * deliberately all it gets: the geometry is 4.1's and 4.2's, and a guard that reasoned about layout
 * would be a second, weaker extractor standing beside the real one.
 *
 * **It flattens to lines and not to one string, from slice 6.8.** A line break is not layout: it is
 * the reader's own statement about where one field stopped, and on a form that is what ends a value.
 * This function put a newline only *between pages*, so A12's address reader — written against
 * exactly that clause, and careful to preserve newlines — never received one, and a scanned address
 * with no full stop after the town read the city as everything printed after it. `pageLines` is the
 * fold and `endsLine` is the reader's flag; nothing here decides where a line ends.
 *
 * The guard above is unaffected either way: `normalise` removes all whitespace before matching.
 */
export function pageText(page: PdfPage): string {
  return pageLines(page)
    .map((line) => line.map((item) => item.text).join(' '))
    .join('\n');
}

export function documentText(pages: readonly PdfPage[]): string {
  return pages.map((page) => pageText(page)).join('\n');
}

/**
 * Whitespace removed, not collapsed, and the reason is the substrate rather than tidiness.
 *
 * A PDF's text arrives as runs, and a run boundary lands wherever the font changed or the line
 * wrapped — `המושכר` is one word to a reader and can be two items to a parser, and `אישור קיום
 * ביטוחים` wraps between words on a page that is 80 characters wide. Matching over text with every
 * space taken out catches both, at the price of also matching a term that spans a word boundary in
 * the text. That trade is taken deliberately and in the direction the guard can afford: this is the
 * cheap check for a misfiled slot, the content cross-check that asserts the *address* on the
 * document against the unit it was filed against needs extraction and is week 4's, and a guard that
 * refused a correct document because a line wrapped would be worked around within a week.
 *
 * Niqqud, cantillation marks and the bidirectional controls a copy-paste leaves behind are stripped
 * for the same reason: they are invisible to the person who wrote the term.
 */
function normalise(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * One requirement's spellings. Slice 6.8.
 *
 * A `verification_terms` element is one requirement, and `|` separates the spellings that satisfy
 * it. It is a delimiter inside the existing `text[]` rather than a second column, so a type still
 * arrives as a seed row and the settings editor — one requirement per line — is unchanged.
 */
const SPELLING = '|';

/**
 * Does this file look like the type it was declared as?
 *
 * **Every declared requirement must be met.** The terms are the fixed printed language of the form —
 * the phrasing on every copy regardless of who signed it — so requiring all of them has no threshold
 * to tune and no weather in it. One matching requirement is not enough, and the corpus is where that
 * is visible rather than arguable: the standard lease says ארנונה in the clause about who pays the
 * utilities, so an any-term rule would file a lease into the ארנונה slot without a murmur.
 *
 * **A requirement may have more than one spelling, and any of them meets it (6.8).** That is not the
 * any-term rule arriving by the back door: it widens *one* requirement across the words a form uses
 * for the same thing — חוזה שכירות or הסכם שכירות, המושכר or הדירה — and leaves the rule that every
 * requirement must be met exactly where it was. The week-6 demo is what wrote this: a lease printed
 * with the second of each vocabulary was refused four times, which was correct behaviour against a
 * declaration calibrated to one specimen. The guard against a type widened until it matches anything
 * is `tests/policy/document-verification.test.ts`, where every tier-1 specimen must still be refused
 * in every slot that is not its own.
 *
 * A false refusal is a seed row somebody edits (A8, no migration and no release). A false accept is
 * a document in the wrong flat's folder that nothing else this week would catch.
 */
export function verifyDeclaredType(
  text: string | null,
  terms: readonly string[] | null,
): Verification {
  if (!terms || terms.length === 0) {
    return { verdict: 'unguarded', missingTerms: [], matchedTerms: [] };
  }
  const haystack = text === null ? '' : normalise(text);
  if (haystack === '') {
    return { verdict: 'unverified', missingTerms: [], matchedTerms: [] };
  }
  const found = (term: string): boolean =>
    term
      .split(SPELLING)
      .some((spelling) => haystack.includes(normalise(spelling)));
  const missingTerms = terms.filter((term) => !found(term));
  const matchedTerms = terms.filter(found);
  return {
    verdict: missingTerms.length === 0 ? 'verified' : 'refused',
    missingTerms,
    matchedTerms,
  };
}
