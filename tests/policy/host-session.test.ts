// POLICY — a session is a session only on its own host. #272.
//
// A staff cookie presented on the tenant host is not a session there: the staff route is not
// found, and the session row is not touched. The reverse is the tenant cookie on the office host:
// it is not a staff session, and the staff row is not touched either. docs/pipeline.md §6: this
// was red before the host split existed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp, TENANT_SESSION_COOKIE } from '../../src/app.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import {
  addOperator,
  mintSession,
  SESSION_COOKIE,
} from '../../src/staff/contract.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-20T06:00:00.000Z');
const DOMAIN = 'host-session.test';
const TENANT_HOST = 'tenant.localhost';

async function seenAt(
  pool: NonNullable<Awaited<ReturnType<typeof policyPool>>>,
  staffAccountId: string,
): Promise<number> {
  const { rows } = await pool.query<{ last_seen_at: Date }>(
    'SELECT last_seen_at FROM staff_session WHERE staff_account_id = $1',
    [staffAccountId],
  );
  const at = rows[0]?.last_seen_at;
  assert.ok(at, 'the session row is missing');
  return at.getTime();
}

describe('policy · a session cookie is not a session on the other host', () => {
  it('does not take a staff cookie on the tenant host, nor a tenant cookie on the office host', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());

    await pool.query(
      `DELETE FROM staff_session WHERE staff_account_id IN
         (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
      [`%@${DOMAIN}`],
    );
    await pool.query('DELETE FROM staff_account WHERE email LIKE $1', [
      `%@${DOMAIN}`,
    ]);

    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    t.after(() => app.close());

    const { account } = await addOperator(pool, clock, {
      email: `ops@${DOMAIN}`,
      role: 'ADMIN',
    });
    const { token } = await mintSession(pool, clock, account.staffAccountId);
    const minted = await seenAt(pool, account.staffAccountId);

    clock.advance(60_000);
    const onTenant = await app.inject({
      method: 'GET',
      url: '/estate',
      headers: {
        host: TENANT_HOST,
        cookie: `${SESSION_COOKIE}=${token}`,
      },
    });
    assert.equal(onTenant.statusCode, 404);
    assert.equal(
      onTenant.body,
      '{"code":"not_found","message":"route not found"}',
    );
    assert.equal(await seenAt(pool, account.staffAccountId), minted);

    clock.advance(60_000);
    const onOffice = await app.inject({
      method: 'GET',
      url: '/estate',
      headers: {
        host: 'localhost',
        cookie: `${SESSION_COOKIE}=${token}`,
      },
    });
    assert.equal(onOffice.statusCode, 200);
    assert.equal(
      await seenAt(pool, account.staffAccountId),
      AT.getTime() + 120_000,
    );

    clock.advance(60_000);
    const tenantCookieOnOffice = await app.inject({
      method: 'GET',
      url: '/estate',
      headers: {
        host: 'localhost',
        cookie: `${TENANT_SESSION_COOKIE}=${token}`,
      },
    });
    assert.equal(tenantCookieOnOffice.statusCode, 303);
    assert.equal(tenantCookieOnOffice.headers.location, '/staff/login');
    assert.equal(
      await seenAt(pool, account.staffAccountId),
      AT.getTime() + 120_000,
    );
  });
});
