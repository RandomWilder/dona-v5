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
