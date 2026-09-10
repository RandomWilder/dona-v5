// The staff routes, driven the way an operator drives them: `app.inject` follows the same redirects
// a browser follows, so what is under test is the whole path — the state cookie, the provider, the
// claim check, the allowlist, the row and the session cookie.
//
// **This suite carries slice 5.1b's acceptance assertions.** An operator on the list signs in
// through Google and holds a session; an address that is not on the list, an address Google has not
// verified, an account with no role, a disabled account, a replayed `state` and a token minted for
// another sign-in are each refused with the same bytes; and the row is bound to the first Google
// account that ever uses it.
//
// The identity provider is the injected port with a fake behind it, so the flow runs with no
// network and no client secret. What is **not** faked is the shape of the claims: the fake answers
// with Google's own claim names, including the tokens this system must refuse.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { GoogleClaims, IdentityProvider } from './contract.ts';
import { addOperator, OAUTH_COOKIE, SESSION_COOKIE } from './contract.ts';

const AT = new Date('2026-10-04T06:00:00.000Z');
const DOMAIN = 'staff-routes.test';
const SUB = '104729103847561092837';

function fakeIdentity(): IdentityProvider & {
  codes: Map<string, GoogleClaims>;
} {
  const codes = new Map<string, GoogleClaims>();
  return {
    codes,
    authorizeUrl({ state, nonce, redirectUri }) {
      const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('redirect_uri', redirectUri);
      return url.toString();
    },
    async exchangeCode({ code }) {
      const claims = codes.get(code);
      if (claims === undefined) {
        throw new Error('the fake was asked for a code it never issued');
      }
      return claims;
    },
    describe: () => 'fake',
  };
}

const cookieNamed = (
  setCookie: string | string[] | undefined,
  name: string,
): string | null => {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  for (const header of headers) {
    const pair = header.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
};

/** Scoped to this suite's own accounts: the database is shared, and a global count is somebody else's fixture. */
async function sessionCount(pool: import('pg').Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM staff_session s
       JOIN staff_account a ON a.staff_account_id = s.staff_account_id
      WHERE a.email LIKE $1`,
    [`%@${DOMAIN}`],
  );
  return Number(rows[0]?.n ?? '0');
}

async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    `DELETE FROM staff_session WHERE staff_account_id IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${DOMAIN}`],
  );
  await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
    `%@${DOMAIN}`,
  ]);
}

/** Starts the redirect and hands back what the browser would now be holding. */
async function start(app: ReturnType<typeof buildApp>): Promise<{
  cookie: string;
  state: string;
  nonce: string;
  redirectUri: string;
}> {
  const answer = await app.inject({ method: 'GET', url: '/staff/auth/start' });
  assert.equal(answer.statusCode, 303);
  const cookie = cookieNamed(answer.headers['set-cookie'], OAUTH_COOKIE);
  assert.notEqual(cookie, null);
  const location = new URL(answer.headers.location as string);
  return {
    cookie: cookie as string,
    state: location.searchParams.get('state') as string,
    nonce: location.searchParams.get('nonce') as string,
    redirectUri: location.searchParams.get('redirect_uri') as string,
  };
}

describe('staff · signing in with Google', () => {
  it('sends an operator to Google and takes the code back for a session', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const identity = fakeIdentity();
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock, identity });
    const email = `yael@${DOMAIN}`;

    // The operator exists because an admin wrote the row. There is no invite, no token and nothing
    // to deliver — the row *is* the authorisation (SPEC-staff.md).
    await addOperator(pool, clock, { email, role: 'ADMIN' });

    // The login screen is a heading and one link. No fields, and no script — the rule that decided
    // the second factor at 5.1 outlives the second factor itself.
    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.equal(login.statusCode, 200);
    assert.match(login.body, /href="\/staff\/auth\/start"/);
    assert.doesNotMatch(login.body, /<input/);
    assert.doesNotMatch(login.body, /<script/);

    const begun = await start(app);
    assert.match(begun.redirectUri, /\/staff\/auth\/callback$/);
    identity.codes.set('code-1', {
      subject: SUB,
      email: `Yael@${DOMAIN}`,
      emailVerified: true,
      hd: null,
      nonce: begun.nonce,
    });

    const back = await app.inject({
      method: 'GET',
      url: `/staff/auth/callback?code=code-1&state=${begun.state}`,
      headers: { cookie: begun.cookie },
    });
    assert.equal(back.statusCode, 303);
    assert.equal(back.headers.location, '/staff');
    const session = cookieNamed(back.headers['set-cookie'], SESSION_COOKIE);
    assert.notEqual(session, null);
    // The one-shot cookie is spent: it is cleared on the way through, so the same redirect cannot
    // be replayed from the browser's history.
    assert.equal(
      cookieNamed(back.headers['set-cookie'], OAUTH_COOKIE),
      `${OAUTH_COOKIE}=`,
    );

    // **The row is bound to the Google account that just used it**, and it was not before.
    const row = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(row.rows[0]?.idp_local_id, SUB);

    const home = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie: session as string },
    });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /ADMIN/);
    assert.match(home.body, /staff\.invite/);

    // Sign-out is a row update, so the same cookie stops working immediately.
    const out = await app.inject({
      method: 'POST',
      url: '/staff/logout',
      headers: { cookie: session as string },
    });
    assert.equal(out.statusCode, 303);
    const afterOut = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie: session as string },
    });
    assert.equal(afterOut.statusCode, 303);
    assert.equal(afterOut.headers.location, '/staff/login');
  });

  it('answers every refusable shape with the same bytes and mints nothing', async (t) => {
    // Six different facts, one answer — otherwise the login screen of a system holding 1,500
    // households is an account-enumeration oracle (SPEC-staff.md). The list is what replaced 5.1's
    // second-factor assertion, so it is the list this suite exists for (ADR-0005).
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const identity = fakeIdentity();
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock, identity });

    await addOperator(pool, clock, {
      email: `roleless@${DOMAIN}`,
      role: 'ADMIN',
    });
    await pool.query('UPDATE staff_account SET role = NULL WHERE email = $1', [
      `roleless@${DOMAIN}`,
    ]);
    await addOperator(pool, clock, {
      email: `disabled@${DOMAIN}`,
      role: 'ADMIN',
    });
    await pool.query(
      'UPDATE staff_account SET disabled_at = $2 WHERE email = $1',
      [`disabled@${DOMAIN}`, clock.now()],
    );
    await addOperator(pool, clock, { email: `bound@${DOMAIN}`, role: 'ADMIN' });
    await pool.query(
      'UPDATE staff_account SET idp_local_id = $2 WHERE email = $1',
      [`bound@${DOMAIN}`, 'a-different-google-account'],
    );
    await addOperator(pool, clock, {
      email: `unverified@${DOMAIN}`,
      role: 'ADMIN',
    });
    await addOperator(pool, clock, { email: `good@${DOMAIN}`, role: 'ADMIN' });

    const attempt = async (
      claims: Partial<GoogleClaims> & { email: string },
      over: { state?: string; cookie?: string } = {},
    ) => {
      const begun = await start(app);
      const code = `code-${claims.email}-${Math.random()}`;
      identity.codes.set(code, {
        subject: SUB,
        emailVerified: true,
        hd: null,
        nonce: begun.nonce,
        ...claims,
      });
      return app.inject({
        method: 'GET',
        url: `/staff/auth/callback?code=${code}&state=${over.state ?? begun.state}`,
        headers:
          over.cookie === '' ? {} : { cookie: over.cookie ?? begun.cookie },
      });
    };

    const answers = [
      // 1 — Google knows this person and this system does not. Not on the list is the whole fence.
      await attempt({ email: `stranger@${DOMAIN}` }),
      // 2 — the row exists and its role was withdrawn.
      await attempt({ email: `roleless@${DOMAIN}` }),
      // 3 — the row has a role and the account is disabled.
      await attempt({ email: `disabled@${DOMAIN}` }),
      // 4 — Google never verified the address the allowlist is written in.
      await attempt({ email: `unverified@${DOMAIN}`, emailVerified: false }),
      // 5 — the address was re-created under a different Google account. Rebinding silently is how
      //     a stranger inherits an operator's role, so it is refused rather than rebound.
      await attempt({ email: `bound@${DOMAIN}` }),
      // 6 — a token minted for a sign-in this browser never started.
      await attempt({ email: `good@${DOMAIN}`, nonce: 'somebody-elses-nonce' }),
      // 7 — the state does not match the cookie, which is a redirect somebody else began.
      await attempt({ email: `good@${DOMAIN}` }, { state: 'not-the-state' }),
      // 8 — no cookie at all: the callback arrived on its own.
      await attempt({ email: `good@${DOMAIN}` }, { cookie: '' }),
    ];

    for (const answer of answers) {
      assert.equal(answer.statusCode, 403);
      assert.equal(
        cookieNamed(answer.headers['set-cookie'], SESSION_COOKIE),
        null,
      );
      assert.equal(answer.body, answers[0]?.body);
    }
    assert.equal(await sessionCount(pool), 0);
  });

  it('refuses a role-less holder of a live session on every guarded route, with one message', async (t) => {
    // A role withdrawn after the session was minted takes effect on the next request, not on the
    // next sign-in — and the refusal is the same one the login screen gives.
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: fakeIdentity(),
    });
    const { account } = await addOperator(pool, clock, {
      email: `live@${DOMAIN}`,
      role: 'ADMIN',
    });
    const { mintSession } = await import('./contract.ts');
    const { token } = await mintSession(pool, clock, account.staffAccountId);
    const cookie = `${SESSION_COOKIE}=${token}`;

    assert.equal(
      (await app.inject({ method: 'GET', url: '/staff', headers: { cookie } }))
        .statusCode,
      200,
    );

    await pool.query(
      'UPDATE staff_account SET role = NULL WHERE staff_account_id = $1',
      [account.staffAccountId],
    );

    const home = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie },
    });
    const operators = await app.inject({
      method: 'POST',
      url: '/staff/operators',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        email: `next@${DOMAIN}`,
        role: 'OPERATOR',
      }).toString(),
    });
    for (const answer of [home, operators]) {
      assert.equal(answer.statusCode, 403);
      assert.deepEqual(JSON.parse(answer.body), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
    }
    assert.equal(home.body, operators.body);
  });

  it('adds an operator, and adding the same address again moves the role rather than making a second person', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: fakeIdentity(),
    });
    const { account } = await addOperator(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const { mintSession } = await import('./contract.ts');
    const { token } = await mintSession(pool, clock, account.staffAccountId);
    const cookie = `${SESSION_COOKIE}=${token}`;

    const add = (email: string, role: string) =>
      app.inject({
        method: 'POST',
        url: '/staff/operators',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({ email, role }).toString(),
      });

    const first = await add(`Amit@${DOMAIN}`, 'VIEWER');
    assert.equal(first.statusCode, 200);
    assert.match(first.body, new RegExp(`amit@${DOMAIN}`));
    // No URL to hand over, because there is nothing to deliver (SPEC-staff.md).
    assert.doesNotMatch(first.body, /\/staff\/invite\//);

    // The same address, a different role: one person, one row, a role that moved. An invited-as
    // `Amit@` and signs-in-as `amit@` that became two rows would be two roles, one of which nobody
    // remembers granting.
    const second = await add(`amit@${DOMAIN}`, 'OPERATOR');
    assert.equal(second.statusCode, 200);
    const rows = await pool.query<{ role: string }>(
      'SELECT role FROM staff_account WHERE email = $1',
      [`amit@${DOMAIN}`],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0]?.role, 'OPERATOR');
  });

  it('sends a caller with no session to the login screen, and serves that screen to anyone', async (t) => {
    // "No session" is not a refusal — it is somebody who has not signed in. The distinction is made
    // at the route and nowhere else, so `requireStaff` stays one answer for one question.
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      identity: fakeIdentity(),
    });

    const home = await app.inject({ method: 'GET', url: '/staff' });
    assert.equal(home.statusCode, 303);
    assert.equal(home.headers.location, '/staff/login');

    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.equal(login.statusCode, 200);
    assert.match(login.headers['content-type'] ?? '', /text\/html/);
    assert.equal(login.headers['cache-control'], 'no-store');
  });

  it('says so when no identity provider is configured, rather than starting a redirect to nowhere', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    // No `identity` in the deps at all — which is what `npm run dev` on a clean clone builds.
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
    });
    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.match(login.body, /שירות הזהויות אינו מוגדר/);
    assert.doesNotMatch(login.body, /href="\/staff\/auth\/start"/);
  });
});
