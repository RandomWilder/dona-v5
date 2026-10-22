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
  PORTAL_CHALLENGE_COOKIE,
  PORTAL_FORM_COOKIE,
  PORTAL_SESSION_COOKIE,
} from '../../src/portal/contract.ts';
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
  // Slice 5.4: documents name their uploader. The FK refuses deleting an operator who filed
  // paper; tests drop the pointer, not the document — the document is the suite's other cleanup.
  await pool.query(
    `UPDATE document SET uploaded_by = NULL WHERE uploaded_by IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM office_retrieval_thread WHERE staff_account_id IN
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

/** The tenant host. The same name the process uses when TENANT_HOST is unset. */
const TENANT_HOST = 'tenant.localhost';

export interface TenantSession {
  cookie: string;
  csrf: string;
  token: string;
}

function cookiePairs(header: unknown): string[] {
  if (Array.isArray(header)) return header.map(String);
  if (header === undefined || header === null) return [];
  return [String(header)];
}

function pairNamed(header: unknown, name: string): string | null {
  for (const value of cookiePairs(header)) {
    const pair = value.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

function hiddenCsrf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error('portal page has no csrf field');
  }
  return value;
}

function hiddenValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  return match?.[1] ?? '';
}

/**
 * Signs in through the portal's real code flow and returns the application as that tenant.
 *
 * The sender is the one the app was built with. The helper reads the code the sender recorded;
 * it does not mint a session beside the flow.
 */
export async function asTenant(
  app: Injectable,
  phone: string,
  sender: { sent: Array<{ code: string }> },
  options?: { remoteAddress?: string },
): Promise<Injectable & TenantSession> {
  const remoteAddress = options?.remoteAddress;
  const page = await app.inject({
    method: 'GET',
    url: '/',
    headers: { host: TENANT_HOST },
    remoteAddress,
  });
  if (page.statusCode !== 200) {
    throw new Error(`portal sign-in page was ${page.statusCode}`);
  }
  const before = sender.sent.length;
  const sent = await app.inject({
    method: 'POST',
    url: '/sign-in',
    headers: {
      host: TENANT_HOST,
      cookie: pairNamed(page.headers['set-cookie'], PORTAL_FORM_COOKIE) ?? '',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `phone=${encodeURIComponent(phone)}&csrf=${hiddenCsrf(page.body)}`,
    remoteAddress,
  });
  if (sent.statusCode !== 303) {
    throw new Error(`portal code was not sent (${sent.statusCode})`);
  }
  const code = sender.sent[before]?.code;
  if (code === undefined) {
    throw new Error('portal code sender recorded nothing');
  }
  const challenge =
    pairNamed(sent.headers['set-cookie'], PORTAL_CHALLENGE_COOKIE) ?? '';
  const codePage = await app.inject({
    method: 'GET',
    url: '/sign-in/code',
    headers: { host: TENANT_HOST, cookie: challenge },
    remoteAddress,
  });
  const verified = await app.inject({
    method: 'POST',
    url: '/sign-in/code',
    headers: {
      host: TENANT_HOST,
      cookie: challenge,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `code=${code}&csrf=${hiddenCsrf(codePage.body)}`,
    remoteAddress,
  });
  if (verified.statusCode !== 303) {
    throw new Error(`portal code was not accepted (${verified.statusCode})`);
  }
  const pair = pairNamed(verified.headers['set-cookie'], PORTAL_SESSION_COOKIE);
  if (pair === null) {
    throw new Error('portal session cookie was not set');
  }
  const token = pair.slice(pair.indexOf('=') + 1);
  const gate = await app.inject({
    method: 'GET',
    url: '/',
    headers: { host: TENANT_HOST, cookie: pair },
    remoteAddress,
  });
  if (gate.statusCode === 303 && gate.headers.location === '/notice') {
    const notice = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { host: TENANT_HOST, cookie: pair },
      remoteAddress,
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/notice',
      headers: {
        host: TENANT_HOST,
        cookie: pair,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `csrf=${hiddenCsrf(notice.body)}&privacy=${hiddenValue(notice.body, 'privacy')}&terms=${hiddenValue(notice.body, 'terms')}`,
      remoteAddress,
    });
    if (accepted.statusCode !== 303) {
      throw new Error(
        `portal notice was not accepted (${accepted.statusCode})`,
      );
    }
  }
  const session: TenantSession = {
    cookie: pair,
    csrf: csrfTokenFor(token),
    token,
  };
  const client = asOperator(app, {
    ...session,
    staffAccountId: '',
    email: '',
  });
  return {
    ...session,
    inject(options) {
      const headers = {
        host: TENANT_HOST,
        ...((options.headers as Record<string, unknown>) ?? {}),
      };
      return client.inject({ ...options, headers, remoteAddress });
    },
  };
}
