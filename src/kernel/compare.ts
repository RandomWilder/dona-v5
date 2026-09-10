// Comparing two secrets. **Slice 5.2**, which is the slice that gave this a second caller.
//
// `sameValue` lived in `src/staff/internal/routes.ts` from 5.1, where it compared the OAuth `state`
// and the Google `sub`. 5.2 needs the same comparison for the CSRF token, and the choice at that
// moment is the one `src/kernel/ui/forms.ts` faced at 5.1: copy four lines into a second file, or
// move them here. Four lines are exactly the size of thing that gets copied and then diverges --
// one copy keeps the length check, the other decides `timingSafeEqual` already does it, and the
// second copy throws on unequal lengths instead of returning false.
//
// **The length check is not redundant.** `timingSafeEqual` throws when its arguments differ in
// length, which would turn a wrong-length token into a 500 rather than a refusal. Comparing lengths
// first leaks the length of the secret and nothing else, and the length of these secrets is not a
// secret: they are all fixed-width outputs of the same two functions.
import { timingSafeEqual } from 'node:crypto';

/** Constant time, because comparing a secret with `===` leaks its prefix one request at a time. */
export function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
