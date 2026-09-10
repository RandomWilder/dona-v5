// The CSRF token. **Slice 5.2**, the slice that gave the write routes a token worth having.
//
// 5.1 deliberately built no half of one: a CSRF token defends a session's authority, and until the
// screens went behind a session an anonymous caller could post directly, so a token would have
// defended nothing while looking like protection. `SameSite=Lax` on the session cookie was stated
// as the real defence in the meantime, and it still is -- this is the second of two now, not the
// first of one.
//
// **The token is derived, never stored.** It is a SHA-256 of the session token the request already
// carries. The alternative -- a random per-session value in a column -- would need somewhere to
// live, and the only somewhere available is `staff_session`, which is the one table in this system
// forbidden to hold a token: `tests/policy/staff-session.test.ts` fails the build on any column
// whose name contains `token` and does not end `_hash`. Deriving keeps that policy case green by
// construction rather than by anybody remembering it, and leaves no second secret to rotate.
//
// **What makes it safe is the same thing that makes the session safe.** The cookie is `HttpOnly`,
// so a cross-origin page cannot read the token to derive this value; a page on this origin can
// derive it, and a page on this origin could post without it anyway.
//
// **The prefix is not decoration.** Hashing the bare session token would make the CSRF value equal
// to `token_hash` -- the column in the database. Anyone who could read one row would then hold a
// valid CSRF token for that session, which turns a database read into half of a forged write. The
// domain separator is what keeps the two derivations from ever landing on the same value.
import { createHash } from 'node:crypto';
import { sameValue } from '../../kernel/compare.ts';
import { KernelError } from '../../kernel/errors.ts';
import { CSRF_FIELD } from '../../kernel/ui/page.ts';

// The field's name and the input that carries it belong to the page layer, which is where four
// modules' forms already share a shell. What is this module's is the value and the comparison.
export { CSRF_FIELD };

const DOMAIN = 'csrf:';

/** The value a screen embeds, derived from the session token the browser already holds. */
export function csrfTokenFor(sessionToken: string): string {
  return createHash('sha256')
    .update(DOMAIN + sessionToken, 'utf8')
    .digest('hex');
}

/**
 * Refuses unless the supplied value is the one this session's token derives. Absent, wrong shape,
 * and minted-for-another-session all reach the same refusal, because they are the same fact: this
 * request did not come from a page this session was served.
 */
export function verifyCsrf(sessionToken: string, supplied: unknown): void {
  if (
    typeof supplied !== 'string' ||
    !sameValue(csrfTokenFor(sessionToken), supplied)
  ) {
    throw new KernelError('not_allowed', 'not_allowed');
  }
}
