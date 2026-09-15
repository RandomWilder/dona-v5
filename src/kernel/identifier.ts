// One spelling of *what an identifier looks like*, read by both of slice 6.6's guards and by
// #104's tenant-stance mask on a retrieval read. A second spelling of it is a second thing to
// keep in step, which is the reason `OCCUPANCY_VIEW` is a constant and not a literal in two queries.
//
// **This is a shape test, and a shape test is only ever a guard.** Nothing in this system decides
// that a *value* is an identifier by looking at it — `IDENTIFIER_FIELD_KEYS` in
// `src/evidence/internal/extract.ts` is the named set, because a field key is governed data and a
// nine-digit run is a coincidence waiting to happen. What a shape test is good for is the opposite
// direction: asserting that a response, or a rendered page, carries **no** run that could be one.
// A false positive there is a slice reading its own fixture and looking again, which is cheap; a
// false negative is a ת.ז. on a screen, which is not.
//
// **The lookarounds are the whole design.** Week 5 closed on a duplicated `/05\d/` that read the
// CSRF token's own hex and failed 4 runs in 20, and 6.5 found the same defect a second time in a
// query asking `inputs ~ '[0-9]{6}'` that was matching UUIDs. An unanchored `\d{9}` fires on a
// UUID (`11111111-1111-…`), on a 64-character file hash roughly four times in five, and inside a
// base64 data URI. Requiring the run to be bounded by something that is neither a digit, a letter
// nor a hyphen costs nothing real — an Israeli ת.ז. printed on a page is surrounded by spaces,
// punctuation or Hebrew — and takes all four of those false positives off the table.
//
// An Israeli ת.ז. is nine digits. The optional separators are what `312-345-678` needs, and 6.5
// proved a person types them: its second lease was keyed through exactly that.
export const IDENTIFIER_RUN =
  /(?<![0-9A-Za-z-])[0-9]{3}[- ]?[0-9]{3}[- ]?[0-9]{3}(?![0-9A-Za-z-])/;

/** The same run the field ledger prints when a ת.ז. is withheld. */
export const IDENTIFIER_MASK = '•••••••••';

/** Whether this text carries a run that could be an identifier. */
export function hasIdentifierRun(text: string): boolean {
  return IDENTIFIER_RUN.test(text);
}

/** Read-time masking. Does not decide that a value *is* an identifier — only that it looks like one. */
export function maskIdentifierRuns(text: string): string {
  return text.replaceAll(
    new RegExp(IDENTIFIER_RUN.source, `${IDENTIFIER_RUN.flags}g`),
    IDENTIFIER_MASK,
  );
}
