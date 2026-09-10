// **The guard, asserted from outside. Slice 5.2's acceptance suite.**
//
// The sentence this slice exists to end: *seven routes have served unauthenticated since week 1*.
// What proves it ended is not that `requireStaff` is called — it is that a request with no cookie
// reaches no screen, on every route the application has, discovered from Fastify's own route table
// rather than from a list somebody typed here. A list typed here would be a list that stops
// mentioning the route added next month, which is the failure mode of every "all routes are
// guarded" test ever written.
//
// Three things are under test and they are different claims:
//
//   1. **The boot check.** A route that declares no stance stops the process from starting.
//   2. **The guard.** No session reaches no screen; a session with the wrong role is refused with
//      the one refusal this system makes.
//   3. **The token.** A POST with a valid session and no token is refused, and so is a POST
//      carrying a token minted for a different session.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import {
  addOperator,
  csrfTokenFor,
  mintSession,
  PERMISSIONS,
  SESSION_COOKIE,
} from './staff/contract.ts';

const AT = new Date('2026-10-04T06:00:00.000Z');
const DOMAIN = 'guard.test';

/** A pool that cannot connect: enough to build the app and ask it about its routes. */
function deadPool(): Pool {
  return new Pool({
    connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
    connectionTimeoutMillis: 500,
    allowExitOnIdle: true,
  });
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM staff_session WHERE staff_account_id IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${DOMAIN}`],
  );
  await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
    `%@${DOMAIN}`,
  ]);
}

describe('the boot check', () => {
  it('refuses to start an application whose route declares no stance', () => {
    // The whole inversion in one assertion. Before 5.2 an undeclared route served; now it does not
    // exist, because the process carrying it does not start. The message names the route, because
    // the person reading it is looking at a stack trace at deploy time.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    assert.throws(
      () => {
        app.get('/forgot-to-say', async () => 'served to anybody');
      },
      /declares no staff stance/,
      'a route with no config was accepted',
    );
    void pool.end();
  });

  it('refuses a stance that is not a permission this system has', () => {
    // A typo is not a permission. Without this, `staff: 'estate.reed'` would boot and then refuse
    // every request at run time, which looks like a broken session rather than a broken route.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    assert.throws(() => {
      app.get(
        '/typo',
        { config: { staff: 'estate.reed' } },
        async () => 'never',
      );
    }, /declares no staff stance/);
    void pool.end();
  });

  it('is not satisfied by a config that carries something else', () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    assert.throws(() => {
      app.get('/other', { config: { csrf: 'in-body' } }, async () => 'never');
    }, /declares no staff stance/);
    void pool.end();
  });

  it('is what a Fastify instance without it does not do', () => {
    // The control. Fastify's own behaviour is to accept the route and serve it, which is exactly
    // what this application did for four weeks and seven routes.
    const bare = Fastify({ logger: false });
    assert.doesNotThrow(() => {
      bare.get('/anything', async () => 'served');
    });
  });
});

describe('every route in the application', () => {
  it('declares a stance, and the public ones are the ones that must be', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    await app.ready();
    const declared = app.stances.map(
      (route) =>
        [`${route.method} ${route.url}`, route.stance] as [
          string,
          string | undefined,
        ],
    );
    const open = declared
      .filter(([, stance]) => stance === 'public')
      .map(([route]) => route)
      .sort();

    // **The whole public surface of this system, enumerated.** Four routes, and every one of them
    // is a route somebody with no session must be able to reach: the liveness probe, the assets the
    // login screen itself loads, the login screen, the redirect to Google, the callback that mints
    // the first session, and the way out. Anything else appearing in this list is the regression
    // this slice exists to make loud.
    assert.deepEqual(open, [
      'GET /health',
      'GET /staff/auth/callback',
      'GET /staff/auth/start',
      'GET /staff/login',
      'GET /ui/fonts/:file',
      'GET /ui/tokens.css',
      'POST /staff/logout',
    ]);

    // And the seven the slice is named for are not among them.
    for (const url of [
      'GET /',
      'GET /estate',
      'GET /estate/buildings/:buildingId',
      'GET /estate/search',
      'GET /estate/expiring',
      'GET /documents/new',
      'GET /calls',
      'GET /settings',
      'POST /documents',
    ]) {
      const stance = declared.find(([name]) => name === url)?.[1];
      assert.ok(stance !== undefined, `${url} is not registered at all`);
      assert.notEqual(stance, 'public', `${url} is still open`);
      assert.ok(
        (PERMISSIONS as readonly string[]).includes(stance as string),
        `${url} declares ${stance}, which is not a permission`,
      );
    }
    await app.close();
    await pool.end();
  });

  it('marks exactly one route as verifying its own token', async () => {
    // `csrf: 'in-body'` is an exemption from the hook, and an exemption that spreads is the hook
    // being switched off one route at a time. There is one, it is the multipart upload, and it
    // calls the same `verifyCsrf` the hook calls.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    await app.ready();
    const exempt = app.stances
      .filter((route) => route.csrf === 'in-body')
      .map((route) => `${route.method} ${route.url}`);
    assert.deepEqual(exempt, ['POST /documents']);
    await app.close();
    await pool.end();
  });
});

describe('a request with no session', () => {
  it('reaches no screen on any guarded route, and is told nothing about it', async () => {
    // **The acceptance bar, on the five read routes the sentence names.** A dead pool is enough:
    // the guard refuses before the handler runs, so a route that answers here at all would be a
    // route reaching its query without a session.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      for (const url of [
        '/',
        '/estate',
        '/estate/buildings/11111111-1111-4111-8111-111111111111',
        '/estate/search?q=%D7%A8%D7%A7%D7%A4%D7%AA',
        '/estate/expiring',
        '/estate/incomplete',
        '/estate/units/11111111-1111-4111-8111-111111111111',
        '/documents/new?unit=11111111-1111-4111-8111-111111111111',
        '/documents/11111111-1111-4111-8111-111111111111/read',
        '/documents/11111111-1111-4111-8111-111111111111/seed',
        '/documents/11111111-1111-4111-8111-111111111111/tenancy',
        '/calls',
        '/settings',
      ]) {
        const response = await app.inject({ method: 'GET', url });
        assert.equal(response.statusCode, 303, url);
        assert.equal(response.headers.location, '/staff/login', url);
        // Not a screen, not a fragment of one, and no hint of what is behind it.
        assert.equal(response.body, '', url);
      }
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('is sent to the login screen by an unknown path too, rather than told it is unknown', async () => {
    // A 404 for the paths that do not exist and a redirect for the ones that do would tell a
    // stranger which is which. Both answer the same thing until somebody signs in.
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/no-such-route',
      });
      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.location, '/staff/login');
      assert.equal(/no-such-route/.test(response.body), false);
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('still reaches the login screen and the stylesheet it loads', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const login = await app.inject({ method: 'GET', url: '/staff/login' });
      assert.equal(login.statusCode, 200);
      const css = await app.inject({ method: 'GET', url: '/ui/tokens.css' });
      assert.equal(css.statusCode, 200);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});

describe('a request with a session', () => {
  it('is served, is refused when the role does not carry the permission, and needs a token to write', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await cleanup(pool);
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    try {
      const { account: admin } = await addOperator(pool, clock, {
        email: `admin@${DOMAIN}`,
        role: 'ADMIN',
      });
      const { account: viewer } = await addOperator(pool, clock, {
        email: `viewer@${DOMAIN}`,
        role: 'VIEWER',
      });
      const adminSession = await mintSession(pool, clock, admin.staffAccountId);
      const viewerSession = await mintSession(
        pool,
        clock,
        viewer.staffAccountId,
      );
      const asAdmin = `${SESSION_COOKIE}=${adminSession.token}`;
      const asViewer = `${SESSION_COOKIE}=${viewerSession.token}`;

      // The screens answer.
      for (const url of ['/', '/estate', '/estate/expiring']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: asAdmin },
        });
        assert.equal(response.statusCode, 200, url);
        assert.match(response.body, /<html lang="he" dir="rtl">/, url);
      }

      // **A role that does not carry the permission is refused, and the refusal is the one
      // sentence this system makes.** A VIEWER may read the estate and may not write a tenancy.
      const refused = await app.inject({
        method: 'POST',
        url: '/estate/incomplete/11111111-1111-4111-8111-111111111111/exception',
        headers: {
          cookie: asViewer,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `reason=x&csrf=${csrfTokenFor(viewerSession.token)}`,
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });

      // **A POST with a valid session and no token is refused.** This is the acceptance bar's
      // second line, and it is the one that was impossible to write before this slice.
      const noToken = await app.inject({
        method: 'POST',
        url: '/staff/operators',
        headers: {
          cookie: asAdmin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `email=nobody@${DOMAIN}&role=VIEWER`,
      });
      assert.equal(noToken.statusCode, 403);
      assert.deepEqual(noToken.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
      const after = await pool.query(
        'SELECT count(*)::text AS n FROM staff_account WHERE email = $1',
        [`nobody@${DOMAIN}`],
      );
      assert.equal(after.rows[0]?.n, '0', 'a token-less POST wrote a row');

      // **A token minted for another session is refused**, which is what makes it a token about
      // *this* session rather than a shared secret anybody signed in can reuse.
      const wrongToken = await app.inject({
        method: 'POST',
        url: '/staff/operators',
        headers: {
          cookie: asAdmin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload:
          `email=nobody2@${DOMAIN}&role=VIEWER&csrf=` +
          csrfTokenFor(viewerSession.token),
      });
      assert.equal(wrongToken.statusCode, 403);

      // And the same POST with this session's own token is served.
      const ok = await app.inject({
        method: 'POST',
        url: '/staff/operators',
        headers: {
          cookie: asAdmin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload:
          `email=added@${DOMAIN}&role=VIEWER&csrf=` +
          csrfTokenFor(adminSession.token),
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await cleanup(pool);
      await app.close();
      await pool.end();
    }
  });

  it('never serves a form with an empty token', async (t) => {
    // **Found by clicking `/estate/incomplete` on :3000 before merge.** `renderIncompletePage` took
    // its token as a parameter with a default of `''`, so the route that never passed one compiled,
    // rendered, and served a form that would be refused on every submit. `tests/ui/tokens.test.ts`
    // could not see it: that guard renders the view with a token, and the bug was in the caller.
    //
    // So the assertion lives where the bug was — at the route, over what the wire carries. The
    // default is gone too, but a required parameter is a fix for one screen and this is the rule.
    //
    // **These two routes and not the screen the defect was on**, which is the correction CI made to
    // this case: `/estate/incomplete` renders one form per incomplete tenancy, so on a database with
    // none it renders none, and the floor assertion below was asserting the *fixture* rather than
    // the property. A guard that passes because it looked at nothing is the failure
    // `kernel/boundary.test.ts` names in its own words. `/` and `/staff` always render a form —
    // the sign-out — whatever the database holds, so the floor is real for them. The screen that
    // carried the defect is asserted in `src/estate/routes.test.ts`, inside the case that already
    // builds the row that makes its form exist.
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await cleanup(pool);
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    try {
      const { account } = await addOperator(pool, clock, {
        email: `forms@${DOMAIN}`,
        role: 'ADMIN',
      });
      const { token } = await mintSession(pool, clock, account.staffAccountId);
      for (const url of ['/', '/staff']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: `${SESSION_COOKIE}=${token}` },
        });
        assert.equal(response.statusCode, 200, url);
        const values = [
          ...response.body.matchAll(/name="csrf" value="([^"]*)"/g),
        ].map((match) => match[1]);
        assert.ok(values.length > 0, `${url} renders no token at all`);
        for (const value of values) {
          assert.equal(value, csrfTokenFor(token), `${url} served a bad token`);
        }
      }
    } finally {
      await cleanup(pool);
      await app.close();
      await pool.end();
    }
  });

  it('renders the token into the form the screen serves, and the same token verifies', async (t) => {
    // The round trip, from the outside: whatever the screen puts in the form is what the check
    // accepts. Deriving it twice in a test would prove the derivation agrees with itself.
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await cleanup(pool);
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    try {
      const { account } = await addOperator(pool, clock, {
        email: `round@${DOMAIN}`,
        role: 'ADMIN',
      });
      const { token } = await mintSession(pool, clock, account.staffAccountId);
      const board = await app.inject({
        method: 'GET',
        url: '/staff',
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      const rendered = /name="csrf" value="([^"]+)"/.exec(board.body)?.[1];
      assert.ok(rendered, 'the staff board rendered no token');
      assert.equal(rendered, csrfTokenFor(token));
      // And it is not the value the database holds for this session, which is the mistake the
      // domain separator in `csrfTokenFor` exists to prevent.
      const row = await pool.query<{ token_hash: string }>(
        'SELECT token_hash FROM staff_session WHERE staff_account_id = $1',
        [account.staffAccountId],
      );
      assert.notEqual(rendered, row.rows[0]?.token_hash);
    } finally {
      await cleanup(pool);
      await app.close();
      await pool.end();
    }
  });
});

describe('dev mockups', () => {
  it('are not registered on a stamped version', async () => {
    const pool = deadPool();
    const app = buildApp({ pool, version: '9.9.9-test' });
    await app.ready();
    const urls = app.stances.map((route) => `${route.method} ${route.url}`);
    assert.equal(
      urls.includes('GET /dev/mockups/:flow'),
      false,
      'a non-dev process served mockups',
    );
    await app.close();
    await pool.end();
  });

  it('exist only when asked for, and stay behind the session', async () => {
    const pool = deadPool();
    const app = buildApp({
      pool,
      version: '0.0.0-dev',
      devMockups: true,
    });
    await app.ready();
    const stance = app.stances.find(
      (route) => route.method === 'GET' && route.url === '/dev/mockups/:flow',
    );
    assert.equal(stance?.stance, 'estate.read');
    const anon = await app.inject({ method: 'GET', url: '/dev/mockups/ia' });
    assert.equal(anon.statusCode, 303);
    assert.equal(anon.headers.location, '/staff/login');
    await app.close();
    await pool.end();
  });
});
