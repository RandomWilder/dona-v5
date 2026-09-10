// **What a suite needs in order to reach a screen, from slice 5.2 onward.**
//
// Every route in this application is behind the session now, so every suite that drives a route
// through `app.inject` has to hold one. The three lines that mint it are the same three lines
// everywhere, and three lines copied into eight suites is how eight suites come to disagree about
// what a signed-in request looks like — one keeps sending the cookie after the guard starts wanting
// the token too, and its assertions quietly become assertions about a redirect.
//
// So it is one helper, in `tests/`, imported by the suites in `src/` that need it. It is not in
// `src/staff/` because it is not part of the application: nothing in a running process ever mints a
// session without Google having said who the person is.
import type { Pool } from 'pg';
import type { Clock } from '../../src/kernel/clock.ts';
import {
  addOperator,
  csrfTokenFor,
  mintSession,
  type Role,
  SESSION_COOKIE,
} from '../../src/staff/contract.ts';

export interface SignedIn {
  /** The `Cookie` header a browser would send. */
  cookie: string;
  /** The value the hidden field carries on this session's forms. */
  csrf: string;
  staffAccountId: string;
  email: string;
  /** The raw session token. Tests that assert about the cookie itself want this. */
  token: string;
}

/**
 * Adds an operator and mints them a session, as if they had signed in with Google.
 *
 * The email is derived from the suite's own domain so `signOut` can clear exactly the rows this
 * suite made, and no suite's cleanup reaches another's.
 */
export async function signIn(
  pool: Pool,
  clock: Clock,
  options: { email: string; role?: Role },
): Promise<SignedIn> {
  const { account } = await addOperator(pool, clock, {
    email: options.email,
    role: options.role ?? 'ADMIN',
  });
  const { token } = await mintSession(pool, clock, account.staffAccountId);
  return {
    cookie: `${SESSION_COOKIE}=${token}`,
    csrf: csrfTokenFor(token),
    staffAccountId: account.staffAccountId,
    email: account.email,
    token,
  };
}

/** Removes every operator and session whose address ends in this suite's domain. */
export async function signOutAll(pool: Pool, domain: string): Promise<void> {
  await pool.query(
    `DELETE FROM staff_session WHERE staff_account_id IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
    `%@${domain}`,
  ]);
}

interface Injectable {
  inject(options: Record<string, unknown>): Promise<{
    statusCode: number;
    headers: Record<string, unknown>;
    body: string;
    // Loose on purpose: every suite that reads it immediately asks for `.code` or `.message`, and
    // a stricter type here would make each of them cast at the call site instead.
    // biome-ignore lint/suspicious/noExplicitAny: the shape is the route's, not this helper's.
    json(): any;
  }>;
}

/**
 * The application, driven as one signed-in operator.
 *
 * Every suite that drove a route before 5.2 drove it as nobody, and the alternative to this wrapper
 * is adding a `cookie` header to thirty `app.inject` calls and a `csrf` to eight payloads — thirty
 * eight chances to add it to thirty seven. What the wrapper adds is exactly what a browser adds:
 * the session cookie on every request, and the hidden field on a urlencoded form post.
 *
 * **It does not touch a multipart body.** The one route with one is the upload, whose token is a
 * part of the stream by design (SPEC-evidence.md), so its suite puts `csrf` in the fields it builds
 * — where a reader can see it, which is the whole reason that route is special.
 */
export function asOperator(app: Injectable, who: SignedIn): Injectable {
  return {
    inject(options) {
      const headers = {
        ...((options.headers as Record<string, unknown>) ?? {}),
        cookie: who.cookie,
      };
      let { payload } = options;
      const urlencoded = String(
        (headers as Record<string, string>)['content-type'] ?? '',
      ).startsWith('application/x-www-form-urlencoded');
      if (
        urlencoded &&
        typeof payload === 'string' &&
        !/\bcsrf=/.test(payload)
      ) {
        payload = `${payload}&csrf=${who.csrf}`;
      }
      return app.inject({ ...options, headers, payload });
    },
  };
}
