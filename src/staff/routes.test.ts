// The staff routes, driven the way an operator drives them: `app.inject` posts the same
// `application/x-www-form-urlencoded` bodies the HTML forms post, so what is under test is the whole
// path — the parser, the provider, the refusal, the row and the cookie.
//
// **This suite carries three of slice 5.1's four acceptance assertions.** A named operator signs in
// with a second factor and holds a session; an account with no role is refused with `not_allowed`
// and no other detail, byte for byte, on every route; and an account with no second factor cannot
// sign in at all. The fourth — that no token value exists anywhere in the database — is
// `src/staff/sessions.test.ts` and `tests/policy/staff-session.test.ts`.
//
// The identity provider is the injected port with a fake behind it, so the flow runs with no
// network and no API key. What is **not** faked is the shape of the provider's answers: the fake
// returns the two shapes Identity Platform actually returns, including the one that carries an ID
// token with no second factor in it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import type { IdentityProvider, SignInResult } from './contract.ts';
import { IdentityRefusal, SESSION_COOKIE } from './contract.ts';

const AT = new Date('2026-10-04T06:00:00.000Z');
const GOOD_CODE = '123456';
const DOMAIN = 'staff-routes.test';

interface FakeUser {
  localId: string;
  password: string;
  totp: boolean;
}

function fakeIdentity(): IdentityProvider & { users: Map<string, FakeUser> } {
  const users = new Map<string, FakeUser>();
  let next = 0;
  const token = (localId: string, secondFactor: string | null) =>
    `${localId}|${secondFactor ?? ''}`;
  const claimsOf = (idToken: string) => {
    const [localId, secondFactor] = idToken.split('|');
    return { localId: localId ?? '', secondFactor: secondFactor || null };
  };
  return {
    users,
    async signInWithPassword(email, password): Promise<SignInResult> {
      const user = users.get(email);
      if (!user || user.password !== password) {
        throw new IdentityRefusal('INVALID_LOGIN_CREDENTIALS', 400);
      }
      if (user.totp) {
        return {
          kind: 'mfa_required',
          pendingCredential: `pending:${user.localId}`,
          enrollmentId: 'enrol-1',
        };
      }
      // The shape a password-only account produces, and the one the route must refuse.
      return {
        kind: 'signed_in',
        localId: user.localId,
        secondFactor: null,
        idToken: token(user.localId, null),
      };
    },
    async finalizeMfaSignIn(pendingCredential, _enrollmentId, code) {
      if (code !== GOOD_CODE) throw new IdentityRefusal('INVALID_CODE', 400);
      const localId = pendingCredential.replace('pending:', '');
      return {
        kind: 'signed_in',
        localId,
        secondFactor: 'totp',
        idToken: token(localId, 'totp'),
      };
    },
    async createAccount(email, password) {
      next += 1;
      const localId = `uid-${next}`;
      users.set(email, { localId, password, totp: false });
      return { localId };
    },
    async startTotpEnrollment() {
      return { sessionInfo: 'sess-1', sharedSecretKey: 'JBSWY3DPEHPK3PXP' };
    },
    async finalizeTotpEnrollment(idToken, _sessionInfo, code) {
      if (code !== GOOD_CODE) throw new IdentityRefusal('INVALID_CODE', 400);
      const { localId } = claimsOf(idToken);
      for (const user of users.values()) {
        if (user.localId === localId) user.totp = true;
      }
    },
    describe: () => 'fake',
  };
}

const form = (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  payload: new URLSearchParams(fields).toString(),
});

function cookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie)
    ? (setCookie[0] ?? '')
    : (setCookie ?? '');
  return header.split(';')[0] ?? '';
}

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
  await pool.query('DELETE FROM staff_invite WHERE email LIKE $1', [
    `%@${DOMAIN}`,
  ]);
  await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
    `%@${DOMAIN}`,
  ]);
}

describe('staff · sign-in, end to end', () => {
  it('invites an operator, enrols a second factor, and signs them in', async (t) => {
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

    // The first operator exists because somebody with database access issued an invite — there is
    // no seeded credential, which is slice 1.5's argument honoured rather than reversed.
    const { createInvite } = await import('./contract.ts');
    const { token } = await createInvite(pool, clock, { email, role: 'ADMIN' });

    const invitePage = await app.inject({
      method: 'GET',
      url: `/staff/invite/${token}`,
    });
    assert.equal(invitePage.statusCode, 200);
    assert.match(invitePage.body, /ADMIN/);

    const accepted = await app.inject({
      method: 'POST',
      url: `/staff/invite/${token}`,
      ...form({ password: 'a-long-enough-password' }),
    });
    assert.equal(accepted.statusCode, 200);
    // The screen shows the secret and the URI as text, and no QR and no script (SPEC-staff.md).
    assert.match(accepted.body, /JBSWY3DPEHPK3PXP/);
    assert.match(accepted.body, /otpauth:\/\/totp\//);
    assert.doesNotMatch(accepted.body, /<script/);

    // **The row exists and has no role yet.** That is "enforced, not offered" read from the other
    // end: an account that never enrolled a second factor never acquires a role.
    const before = await pool.query<{ role: string | null }>(
      'SELECT role FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(before.rows[0]?.role, null);

    const enrolled = await app.inject({
      method: 'POST',
      url: `/staff/invite/${token}/enrol`,
      ...form({ session_info: 'sess-1', id_token: 'uid-1|', code: GOOD_CODE }),
    });
    assert.equal(enrolled.statusCode, 200);
    const after = await pool.query<{ role: string | null }>(
      'SELECT role FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(after.rows[0]?.role, 'ADMIN');

    // Sign in. The password step alone gets a second-factor form and no cookie.
    const password = await app.inject({
      method: 'POST',
      url: '/staff/login',
      ...form({ email, password: 'a-long-enough-password' }),
    });
    assert.equal(password.statusCode, 200);
    assert.equal(password.headers['set-cookie'], undefined);
    assert.match(password.body, /name="pending"/);

    const verified = await app.inject({
      method: 'POST',
      url: '/staff/login/verify',
      ...form({
        pending: 'pending:uid-1',
        enrollment: 'enrol-1',
        code: GOOD_CODE,
      }),
    });
    assert.equal(verified.statusCode, 303);
    assert.equal(verified.headers.location, '/staff');
    const cookie = cookieFrom(verified.headers['set-cookie']);
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));

    const home = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie },
    });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /ADMIN/);
    assert.match(home.body, /staff\.invite/);

    // Sign-out is a row update, so the same cookie stops working immediately.
    const out = await app.inject({
      method: 'POST',
      url: '/staff/logout',
      headers: { cookie },
    });
    assert.equal(out.statusCode, 303);
    const afterOut = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie },
    });
    assert.equal(afterOut.statusCode, 303);
    assert.equal(afterOut.headers.location, '/staff/login');
  });

  it('refuses an account with no second factor, however good its password is', async (t) => {
    // Identity Platform's project config says mfa.state = MANDATORY. **This is the half with a test
    // behind it**: an ID token that arrives straight out of the password step means the account
    // has no second factor, and the route refuses it (SPEC-staff.md).
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
    const email = `no-factor@${DOMAIN}`;
    await identity.createAccount(email, 'a-long-enough-password');
    await pool.query(
      `INSERT INTO staff_account (staff_account_id, idp_local_id, email, role, created_at)
       VALUES ($1, $2, $3, 'ADMIN', $4)`,
      ['11111111-1111-4111-8111-111111111111', 'uid-1', email, clock.now()],
    );

    const answer = await app.inject({
      method: 'POST',
      url: '/staff/login',
      ...form({ email, password: 'a-long-enough-password' }),
    });
    assert.equal(answer.statusCode, 403);
    assert.equal(answer.headers['set-cookie'], undefined);
    assert.equal(await sessionCount(pool), 0);
  });

  it('answers every role-less shape with the same bytes', async (t) => {
    // No row for the uid, a row whose role is null, and a row that is disabled. Three different
    // facts, one answer — otherwise the login screen of a system holding 1,500 households is an
    // account-enumeration oracle (SPEC-staff.md).
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

    const signIn = async (localId: string) =>
      app.inject({
        method: 'POST',
        url: '/staff/login/verify',
        ...form({
          pending: `pending:${localId}`,
          enrollment: 'enrol-1',
          code: GOOD_CODE,
        }),
      });

    // 1 — the provider knows the account and this system does not.
    const unknown = await signIn('uid-unknown');

    // 2 — the row exists and its role was never assigned.
    await pool.query(
      `INSERT INTO staff_account (staff_account_id, idp_local_id, email, role, created_at)
       VALUES ($1, $2, $3, NULL, $4)`,
      [
        '22222222-2222-4222-8222-222222222222',
        'uid-roleless',
        `roleless@${DOMAIN}`,
        clock.now(),
      ],
    );
    const roleless = await signIn('uid-roleless');

    // 3 — the row has a role and the account is disabled.
    await pool.query(
      `INSERT INTO staff_account (staff_account_id, idp_local_id, email, role, disabled_at, created_at)
       VALUES ($1, $2, $3, 'ADMIN', $4, $4)`,
      [
        '33333333-3333-4333-8333-333333333333',
        'uid-disabled',
        `disabled@${DOMAIN}`,
        clock.now(),
      ],
    );
    const disabled = await signIn('uid-disabled');

    for (const answer of [unknown, roleless, disabled]) {
      assert.equal(answer.statusCode, 403);
      assert.equal(answer.headers['set-cookie'], undefined);
    }
    assert.equal(unknown.body, roleless.body);
    assert.equal(roleless.body, disabled.body);
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

    const identity = fakeIdentity();
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock, identity });
    const accountId = '44444444-4444-4444-8444-444444444444';
    await pool.query(
      `INSERT INTO staff_account (staff_account_id, idp_local_id, email, role, created_at)
       VALUES ($1, 'uid-live', $2, 'ADMIN', $3)`,
      [accountId, `live@${DOMAIN}`, clock.now()],
    );
    const { mintSession } = await import('./contract.ts');
    const { token } = await mintSession(pool, clock, accountId);
    const cookie = `${SESSION_COOKIE}=${token}`;

    assert.equal(
      (await app.inject({ method: 'GET', url: '/staff', headers: { cookie } }))
        .statusCode,
      200,
    );

    await pool.query(
      'UPDATE staff_account SET role = NULL WHERE staff_account_id = $1',
      [accountId],
    );

    const home = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie },
    });
    const invites = await app.inject({
      method: 'POST',
      url: '/staff/invites',
      ...form({ email: `next@${DOMAIN}`, role: 'OPERATOR' }, { cookie }),
    });
    for (const answer of [home, invites]) {
      assert.equal(answer.statusCode, 403);
      assert.deepEqual(JSON.parse(answer.body), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
    }
    assert.equal(home.body, invites.body);
  });

  it('refuses a wrong second-factor code without saying so', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    const identity = fakeIdentity();
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      identity,
    });
    const answer = await app.inject({
      method: 'POST',
      url: '/staff/login/verify',
      ...form({
        pending: 'pending:uid-1',
        enrollment: 'enrol-1',
        code: '000000',
      }),
    });
    assert.equal(answer.statusCode, 403);
    assert.equal(answer.headers['set-cookie'], undefined);
    assert.doesNotMatch(answer.body, /INVALID_CODE/);
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

  it('says so when no identity provider is configured, rather than answering a real password', async (t) => {
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
  });
});
