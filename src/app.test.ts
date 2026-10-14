import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';

// app.inject drives the route without binding a socket, so the suite never races a port.
//
// The four-line REQUIRE_POSTGRES check 1.3 wrote by hand is gone: kernel/pg-support.ts owns the
// skip-vs-fail decision from this slice, and it migrates the pool it hands back as well.

describe('/health', () => {
  it('reports ok:true and db:up against a real database', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const app = buildApp({ pool, version: '9.9.9-test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      strictEqual(response.statusCode, 200);
      const body = response.json();
      // Both halves of 1.3's acceptance bar: a process that is up is not the same claim as a
      // process that can reach its database.
      strictEqual(body.ok, true);
      strictEqual(body.db, 'up');
      strictEqual(body.version, '9.9.9-test');
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('degrades to 503 in the SPEC.md error shape when the database is down', async () => {
    const deadPool = new Pool({
      connectionString: 'postgres://dona:dona@127.0.0.1:59999/dona',
      connectionTimeoutMillis: 500,
      allowExitOnIdle: true,
    });
    const app = buildApp({ pool: deadPool, version: '9.9.9-test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      strictEqual(response.statusCode, 503);
      const body = response.json();
      strictEqual(body.ok, false);
      strictEqual(body.code, 'unavailable');
      strictEqual(body.message, 'database unreachable');
      // The connection string is in the caught error. It must not be on the wire.
      strictEqual(/59999|postgres:\/\//.test(response.body), false);
    } finally {
      await app.close();
      await deadPool.end();
    }
  });

  it('renders an unknown route as the kernel not_found shape, rather than Fastify default', async (t) => {
    // **Slice 5.2 moved this case behind a session, and that is the finding rather than a chore.**
    // Before it, an unknown path answered 404 and a known one answered a screen, so an anonymous
    // caller could map this application by asking. Now both answer the same redirect until somebody
    // signs in (`src/guard.test.ts` asserts that half), and the SPEC.md error shape — which is what
    // *this* case is about — is what an operator sees.
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2026-10-04T06:00:00.000Z'));
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'app-404.test';
    try {
      await signOutAll(pool, domain);
      const who = await signIn(pool, clock, { email: `ops@${domain}` });
      const response = await app.inject({
        method: 'GET',
        url: '/no-such-route',
        headers: { cookie: who.cookie },
      });
      strictEqual(response.statusCode, 404);
      const body = response.json();
      strictEqual(body.code, 'not_found');
      strictEqual(body.message, 'route not found');
      // Fastify's own 404 echoes the requested path back into the body. This one does not.
      strictEqual(/no-such-route/.test(response.body), false);
    } finally {
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});

describe('the generic error handler (#233)', () => {
  // One failing route, asked twice. POST /settings/document-types with a valid token and no fields
  // ends in `requireText`'s KernelError('invalid', 'type_key is required'), which no screen catches.
  it('answers a browser with a Hebrew page and a JSON client with the shape, same status', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(new Date('2026-10-14T06:00:00.000Z'));
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'app-error-page.test';
    try {
      await signOutAll(pool, domain);
      const who = await signIn(pool, clock, { email: `ops@${domain}` });
      const ask = (accept: string, referer?: string) =>
        app.inject({
          method: 'POST',
          url: '/settings/document-types',
          headers: {
            cookie: who.cookie,
            accept,
            host: 'localhost:3000',
            'content-type': 'application/x-www-form-urlencoded',
            ...(referer === undefined ? {} : { referer }),
          },
          payload: `csrf=${encodeURIComponent(who.csrf)}`,
        });

      const json = await ask('application/json');
      strictEqual(json.statusCode, 400);
      strictEqual(
        json.body,
        '{"code":"invalid","message":"type_key is required"}',
      );

      const html = await ask(
        'text/html,application/xhtml+xml,*/*;q=0.8',
        'http://localhost:3000/settings?tab=documents',
      );
      strictEqual(html.statusCode, 400);
      strictEqual(
        /^text\/html/.test(String(html.headers['content-type'])),
        true,
      );
      strictEqual(html.body.includes('lang="he"'), true);
      // The shell with the rail, because the request carries a session.
      strictEqual(html.body.includes('class="ops-nav"'), true);
      strictEqual(html.body.includes('data-error-code="invalid"'), true);
      strictEqual(html.body.includes('href="/settings?tab=documents"'), true);
      // Never the English message.
      strictEqual(/type_key|required/.test(html.body), false);

      // A referer from another host is not a way back: home instead.
      const foreign = await ask('text/html', 'https://evil.example/phish');
      strictEqual(foreign.body.includes('evil.example'), false);
      strictEqual(foreign.body.includes('data-way-back href="/"'), true);
    } finally {
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
