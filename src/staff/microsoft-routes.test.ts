// Microsoft sign-in, driven the way an operator drives it. The provider is faked at its port, the
// database is real, and what is asserted is the status, the cookie, the page and the row (#262).
//
// The Google tests in routes.test.ts are not modified. A refusal here is compared to a Google
// refusal produced in this file, so the bytes have to match without that file changing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import {
  addOperator,
  type GoogleClaims,
  type IdentityProvider,
  type MicrosoftClaims,
  type MicrosoftProvider,
  OAUTH_COOKIE,
  SESSION_COOKIE,
} from './contract.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');
const TENANT = '11111111-1111-1111-1111-111111111111';
const DOMAIN = 'dona.co.il';
const PREFIX = 'ms262-';
const OBJECT_ID = '33333333-3333-3333-3333-333333333333';
const GOOGLE_SUB = '104729103847561092837';
const CONSUMERS = '9188040d-6c67-4c5b-b112-36a304b66dad';

function issuer(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/v2.0`;
}

function fakeMicrosoft(): MicrosoftProvider & {
  codes: Map<string, MicrosoftClaims>;
} {
  const codes = new Map<string, MicrosoftClaims>();
  return {
    codes,
    authorizeUrl({ state, nonce, redirectUri }) {
      const url = new URL(
        `${issuer(TENANT).replace(/\/v2\.0$/, '')}/oauth2/v2.0/authorize`,
      );
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
    expected: () => ({ tenantId: TENANT, domain: DOMAIN }),
  };
}

function fakeGoogle(): IdentityProvider & { codes: Map<string, GoogleClaims> } {
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

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log WHERE actor_id IN
       (SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM staff_session WHERE staff_account_id IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
    `${PREFIX}%`,
  ]);
}

type App = ReturnType<typeof buildApp>;

async function begin(
  app: App,
  url: string,
): Promise<{
  cookie: string;
  state: string;
  nonce: string;
  redirectUri: string;
}> {
  const answer = await app.inject({ method: 'GET', url });
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

describe('staff · signing in with Microsoft', () => {
  it('binds a listed address on the first sign-in and lands on the staff home with that role', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const microsoft = fakeMicrosoft();
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      microsoft,
    });
    const email = `${PREFIX}yael@${DOMAIN}`;
    await addOperator(pool, clock, { email, role: 'OPERATOR' });

    const begun = await begin(app, '/staff/auth/microsoft/start');
    assert.match(begun.redirectUri, /\/staff\/auth\/microsoft\/callback$/);
    microsoft.codes.set('code-1', {
      objectId: OBJECT_ID,
      tenantId: TENANT,
      issuer: issuer(TENANT),
      profileId: OBJECT_ID,
      userType: 'Member',
      addresses: [`SMTP:${PREFIX}Yael@${DOMAIN}`],
      nonce: begun.nonce,
    });

    const back = await app.inject({
      method: 'GET',
      url: `/staff/auth/microsoft/callback?code=code-1&state=${begun.state}`,
      headers: { cookie: begun.cookie },
    });
    assert.equal(back.statusCode, 303);
    assert.equal(back.headers.location, '/staff');
    const session = cookieNamed(back.headers['set-cookie'], SESSION_COOKIE);
    assert.notEqual(session, null);
    assert.equal(
      cookieNamed(back.headers['set-cookie'], OAUTH_COOKIE),
      `${OAUTH_COOKIE}=`,
    );

    const row = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(row.rows[0]?.idp_local_id, `ms:${TENANT}:${OBJECT_ID}`);

    const home = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { cookie: session as string },
    });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /OPERATOR/);
    assert.match(home.body, /documents\.write/);
    assert.match(home.body, /party\.write/);
    assert.doesNotMatch(home.body, /staff\.invite/);
    assert.doesNotMatch(home.body, /estate\.write/);

    const audit = await pool.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM audit_log
        WHERE actor_id = (SELECT staff_account_id::text FROM staff_account WHERE email = $1)
          AND action = 'staff.login'`,
      [email],
    );
    assert.equal(audit.rows[0]?.action, 'staff.login');
    assert.equal(audit.rows[0]?.outcome, 'ok');

    const again = await begin(app, '/staff/auth/microsoft/start');
    microsoft.codes.set('code-2', {
      objectId: OBJECT_ID,
      tenantId: TENANT,
      issuer: issuer(TENANT),
      profileId: OBJECT_ID,
      userType: 'Member',
      addresses: [`SMTP:${email}`],
      nonce: again.nonce,
    });
    const second = await app.inject({
      method: 'GET',
      url: `/staff/auth/microsoft/callback?code=code-2&state=${again.state}`,
      headers: { cookie: again.cookie },
    });
    assert.equal(second.statusCode, 303);
    assert.equal(
      (
        await pool.query<{ idp_local_id: string }>(
          'SELECT idp_local_id FROM staff_account WHERE email = $1',
          [email],
        )
      ).rows[0]?.idp_local_id,
      `ms:${TENANT}:${OBJECT_ID}`,
    );
  });

  it('answers every Microsoft refusal with the same bytes as a Google refusal', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const microsoft = fakeMicrosoft();
    const google = fakeGoogle();
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: google,
      microsoft,
    });

    const emails = [
      `${PREFIX}lookalike@evil-${DOMAIN}`,
      `${PREFIX}lookalike@${DOMAIN}.evil`,
      `${PREFIX}personal@${DOMAIN}`,
      `${PREFIX}nonce@${DOMAIN}`,
      `${PREFIX}blank@${DOMAIN}`,
      `${PREFIX}bound@${DOMAIN}`,
    ];
    for (const email of emails) {
      await addOperator(pool, clock, { email, role: 'ADMIN' });
    }
    await pool.query(
      'UPDATE staff_account SET idp_local_id = $2 WHERE email = $1',
      [`${PREFIX}bound@${DOMAIN}`, GOOGLE_SUB],
    );

    const googleBegun = await begin(app, '/staff/auth/start');
    google.codes.set('google-stranger', {
      subject: GOOGLE_SUB,
      email: `${PREFIX}nobody@${DOMAIN}`,
      emailVerified: true,
      hd: null,
      nonce: googleBegun.nonce,
    });
    const googleRefusal = await app.inject({
      method: 'GET',
      url: `/staff/auth/callback?code=google-stranger&state=${googleBegun.state}`,
      headers: { cookie: googleBegun.cookie },
    });
    assert.equal(googleRefusal.statusCode, 403);

    const attempt = async (
      claims: Partial<MicrosoftClaims>,
      over: { state?: string; cookie?: string } = {},
    ) => {
      const begun = await begin(app, '/staff/auth/microsoft/start');
      const code = `code-${Math.random()}`;
      microsoft.codes.set(code, {
        objectId: OBJECT_ID,
        profileId: OBJECT_ID,
        userType: 'Member',
        tenantId: TENANT,
        issuer: issuer(TENANT),
        nonce: begun.nonce,
        addresses: [],
        ...claims,
      });
      return app.inject({
        method: 'GET',
        url: `/staff/auth/microsoft/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(over.state ?? begun.state)}`,
        headers:
          over.cookie === '' ? {} : { cookie: over.cookie ?? begun.cookie },
      });
    };

    const answers = [
      await attempt({ addresses: [`SMTP:${PREFIX}lookalike@evil-${DOMAIN}`] }),
      await attempt({ addresses: [`SMTP:${PREFIX}lookalike@${DOMAIN}.evil`] }),
      await attempt({
        addresses: [`SMTP:${PREFIX}personal@${DOMAIN}`],
        tenantId: CONSUMERS,
        issuer: issuer(CONSUMERS),
      }),
      await attempt({
        addresses: [`SMTP:${PREFIX}nonce@${DOMAIN}`],
        nonce: 'somebody-elses-nonce',
      }),
      await attempt({ addresses: [] }),
      await attempt({ addresses: [`SMTP:${PREFIX}bound@${DOMAIN}`] }),
      await attempt(
        { addresses: [`SMTP:${PREFIX}nonce@${DOMAIN}`] },
        { state: 'not-the-state' },
      ),
      await attempt(
        { addresses: [`SMTP:${PREFIX}nonce@${DOMAIN}`] },
        { cookie: '' },
      ),
    ];

    for (const answer of answers) {
      assert.equal(answer.statusCode, 403);
      assert.equal(answer.body, googleRefusal.body);
      assert.equal(
        cookieNamed(answer.headers['set-cookie'], SESSION_COOKIE),
        null,
      );
    }

    const bound = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [`${PREFIX}bound@${DOMAIN}`],
    );
    assert.equal(bound.rows[0]?.idp_local_id, GOOGLE_SUB);

    const refused = await pool.query<{ action: string; error_code: string }>(
      `SELECT action, error_code FROM audit_log
        WHERE actor_id = (SELECT staff_account_id::text FROM staff_account WHERE email = $1)
          AND action = 'staff.login.refused'`,
      [`${PREFIX}bound@${DOMAIN}`],
    );
    assert.equal(refused.rows.length, 1);
    assert.equal(refused.rows[0]?.error_code, 'not_allowed');
  });

  it('refuses Google for an account Microsoft already bound, and counts both towards one lockout', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const microsoft = fakeMicrosoft();
    const google = fakeGoogle();
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: google,
      microsoft,
    });
    const email = `${PREFIX}switch@${DOMAIN}`;
    await addOperator(pool, clock, { email, role: 'VIEWER' });
    await pool.query(
      'UPDATE staff_account SET idp_local_id = $2 WHERE email = $1',
      [email, `ms:${TENANT}:${OBJECT_ID}`],
    );

    const begun = await begin(app, '/staff/auth/start');
    google.codes.set('google-switch', {
      subject: GOOGLE_SUB,
      email,
      emailVerified: true,
      hd: null,
      nonce: begun.nonce,
    });
    const googleRefusal = await app.inject({
      method: 'GET',
      url: `/staff/auth/callback?code=google-switch&state=${begun.state}`,
      headers: { cookie: begun.cookie },
    });
    assert.equal(googleRefusal.statusCode, 403);

    const msBegun = await begin(app, '/staff/auth/microsoft/start');
    microsoft.codes.set('ms-switch', {
      objectId: '99999999-9999-9999-9999-999999999999',
      tenantId: TENANT,
      issuer: issuer(TENANT),
      profileId: '99999999-9999-9999-9999-999999999999',
      userType: 'Member',
      addresses: [`SMTP:${email}`],
      nonce: msBegun.nonce,
    });
    const msRefusal = await app.inject({
      method: 'GET',
      url: `/staff/auth/microsoft/callback?code=ms-switch&state=${msBegun.state}`,
      headers: { cookie: msBegun.cookie },
    });
    assert.equal(msRefusal.statusCode, 403);
    assert.equal(msRefusal.body, googleRefusal.body);

    const counted = await pool.query<{
      failed_attempts: number;
      idp_local_id: string;
    }>(
      'SELECT failed_attempts, idp_local_id FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(counted.rows[0]?.failed_attempts, 2);
    assert.equal(counted.rows[0]?.idp_local_id, `ms:${TENANT}:${OBJECT_ID}`);

    const actions = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log
        WHERE actor_id = (SELECT staff_account_id::text FROM staff_account WHERE email = $1)
        ORDER BY at`,
      [email],
    );
    assert.deepEqual(
      actions.rows.map((row) => row.action),
      ['staff.login.refused', 'staff.login.refused'],
    );

    let locked = false;
    for (let n = 0; n < 12 && !locked; n += 1) {
      const next = await begin(app, '/staff/auth/microsoft/start');
      const code = `lock-${n}`;
      microsoft.codes.set(code, {
        objectId: '99999999-9999-9999-9999-999999999999',
        tenantId: TENANT,
        issuer: issuer(TENANT),
        profileId: '99999999-9999-9999-9999-999999999999',
        userType: 'Member',
        addresses: [`SMTP:${email}`],
        nonce: next.nonce,
      });
      const answer = await app.inject({
        method: 'GET',
        url: `/staff/auth/microsoft/callback?code=${code}&state=${next.state}`,
        headers: { cookie: next.cookie },
      });
      assert.equal(answer.statusCode, 403);
      assert.equal(answer.body, googleRefusal.body);
      const row = await pool.query<{ locked_until: Date | null }>(
        'SELECT locked_until FROM staff_account WHERE email = $1',
        [email],
      );
      locked = row.rows[0]?.locked_until !== null;
    }
    assert.equal(locked, true);

    await pool.query(
      'UPDATE staff_account SET failed_attempts = 4, locked_until = NULL, idp_local_id = NULL WHERE email = $1',
      [email],
    );
    const clear = await begin(app, '/staff/auth/microsoft/start');
    microsoft.codes.set('clears', {
      objectId: OBJECT_ID,
      tenantId: TENANT,
      issuer: issuer(TENANT),
      profileId: OBJECT_ID,
      userType: 'Member',
      addresses: [`SMTP:${email}`],
      nonce: clear.nonce,
    });
    const signedIn = await app.inject({
      method: 'GET',
      url: `/staff/auth/microsoft/callback?code=clears&state=${clear.state}`,
      headers: { cookie: clear.cookie },
    });
    assert.equal(signedIn.statusCode, 303);
    const after = await pool.query<{
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      'SELECT failed_attempts, locked_until FROM staff_account WHERE email = $1',
      [email],
    );
    assert.equal(after.rows[0]?.failed_attempts, 0);
    assert.equal(after.rows[0]?.locked_until, null);
  });

  it('answers unavailable on both routes when Microsoft is not configured, and Google still signs in', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await cleanup(pool);
      await pool.end();
    });
    await cleanup(pool);

    const google = fakeGoogle();
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: google,
    });
    for (const url of [
      '/staff/auth/microsoft/start',
      '/staff/auth/microsoft/callback',
    ]) {
      const answer = await app.inject({ method: 'GET', url });
      assert.equal(answer.statusCode, 503);
      assert.deepEqual(JSON.parse(answer.body), {
        code: 'unavailable',
        message: 'microsoft sign-in is not configured',
      });
    }

    const email = `${PREFIX}google-only@${DOMAIN}`;
    await addOperator(pool, clock, { email, role: 'ADMIN' });
    const begun = await begin(app, '/staff/auth/start');
    google.codes.set('still-google', {
      subject: GOOGLE_SUB,
      email,
      emailVerified: true,
      hd: null,
      nonce: begun.nonce,
    });
    const back = await app.inject({
      method: 'GET',
      url: `/staff/auth/callback?code=still-google&state=${begun.state}`,
      headers: { cookie: begun.cookie },
    });
    assert.equal(back.statusCode, 303);
    assert.equal(back.headers.location, '/staff');
  });
});

function loginButtons(
  html: string,
): { className: string; href: string; label: string }[] {
  return [
    ...html.matchAll(/<a class="([^"]+)" href="([^"]+)">([^<]+)<\/a>/g),
  ].map((match) => ({
    className: match[1] ?? '',
    href: match[2] ?? '',
    label: match[3] ?? '',
  }));
}

describe('staff · the login screen offers Microsoft beside Google', () => {
  it('shows two equal buttons, Google then Microsoft, when Microsoft is configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      identity: fakeGoogle(),
      microsoft: fakeMicrosoft(),
    });
    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.equal(login.statusCode, 200);
    const offered = loginButtons(login.body);
    assert.deepEqual(
      offered.map((button) => button.label),
      ['המשך עם Google', 'המשך עם Microsoft'],
    );
    assert.deepEqual(
      offered.map((button) => button.href),
      ['/staff/auth/start', '/staff/auth/microsoft/start'],
    );
    assert.equal(offered[0]?.className, offered[1]?.className);
    assert.match(offered[0]?.className ?? '', /btn-primary/);
    assert.match(
      login.body,
      /הכניסה היא דרך חשבון Google או חשבון Microsoft\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(
      login.body,
      /הכניסה היא דרך חשבון Google\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(login.body, /<script/);
    assert.doesNotMatch(login.body, /<input/);
  });

  it('shows Google alone when Microsoft is not configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      identity: fakeGoogle(),
    });
    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(
      loginButtons(login.body).map((button) => button.label),
      ['המשך עם Google'],
    );
    assert.match(
      login.body,
      /הכניסה היא דרך חשבון Google\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(login.body, /Microsoft/);
  });

  it('still offers Microsoft when Google is not configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock: fixedClock(AT),
      microsoft: fakeMicrosoft(),
    });
    const login = await app.inject({ method: 'GET', url: '/staff/login' });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(
      loginButtons(login.body).map((button) => ({
        href: button.href,
        label: button.label,
      })),
      [
        {
          href: '/staff/auth/microsoft/start',
          label: 'המשך עם Microsoft',
        },
      ],
    );
    assert.match(
      login.body,
      /הכניסה היא דרך חשבון Microsoft\. אין כאן סיסמה ואין קוד\./,
    );
    assert.doesNotMatch(login.body, /שירות הזהויות אינו מוגדר/);
    assert.doesNotMatch(login.body, /href="\/staff\/auth\/start"/);
  });

  it('warns an admin on the staff home inside the window, and nobody else', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(new Date('2028-09-27T09:00:00.000Z'));
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      identity: fakeGoogle(),
    });
    const domain = 'ms264-expiry.test';
    const saved = process.env.MICROSOFT_OAUTH_SECRET_EXPIRES;
    const secret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
    await signOutAll(pool, domain);
    t.after(async () => {
      if (saved === undefined)
        delete process.env.MICROSOFT_OAUTH_SECRET_EXPIRES;
      else process.env.MICROSOFT_OAUTH_SECRET_EXPIRES = saved;
      if (secret === undefined)
        delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
      else process.env.MICROSOFT_OAUTH_CLIENT_SECRET = secret;
      await signOutAll(pool, domain);
      await pool.end();
    });

    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'microsoft-client-secret-value';
    process.env.MICROSOFT_OAUTH_SECRET_EXPIRES = '2028-10-07';
    const admin = await signIn(pool, clock, {
      email: `admin@${domain}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, clock, {
      email: `operator@${domain}`,
      role: 'OPERATOR',
    });
    const viewer = await signIn(pool, clock, {
      email: `viewer@${domain}`,
      role: 'VIEWER',
    });

    const home = await asOperator(app, admin).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /הסוד של כניסת Microsoft בתוקף עד 07\.10\.2028/);
    assert.match(home.body, /יש לבקש סוד חדש ממנהל Microsoft 365/);
    assert.doesNotMatch(home.body, /microsoft-client-secret-value/);

    const ops = await asOperator(app, operator).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.equal(ops.statusCode, 200);
    assert.doesNotMatch(ops.body, /כניסת Microsoft/);

    const view = await asOperator(app, viewer).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.equal(view.statusCode, 200);
    assert.doesNotMatch(view.body, /כניסת Microsoft/);

    process.env.MICROSOFT_OAUTH_SECRET_EXPIRES = '2028-09-01';
    const expired = await asOperator(app, admin).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.match(
      expired.body,
      /תוקף הסוד של כניסת Microsoft פג ב-01\.09\.2028/,
    );

    delete process.env.MICROSOFT_OAUTH_SECRET_EXPIRES;
    const quiet = await asOperator(app, admin).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.equal(quiet.statusCode, 200);
    assert.doesNotMatch(quiet.body, /כניסת Microsoft/);

    process.env.MICROSOFT_OAUTH_SECRET_EXPIRES = 'not-a-date';
    const junk = await asOperator(app, admin).inject({
      method: 'GET',
      url: '/staff',
    });
    assert.equal(junk.statusCode, 200);
    assert.doesNotMatch(junk.body, /כניסת Microsoft/);
  });
});
