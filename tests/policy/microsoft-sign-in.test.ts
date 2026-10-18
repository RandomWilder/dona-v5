// The Microsoft sign-in gate: a token from another tenant, or an address outside the configured
// domain, is refused even when a staff account already names that address.
//
// #262, SPEC-staff.md, ADR-0018. The email claim is a string the issuing directory's administrator
// can set to anything, including an address this system already trusts. The allowlist is not the
// fence on this path. The tenant and the domain are, and both are required.
//
// **Why it lives in tests/policy/.** docs/pipeline.md §6 is the gate for everything no model may
// decide. Whether a foreign directory may enter is not a judgement. It is also deterministic.
//
// **The accepting attempt is what keeps the refusals honest.** A handler that refused every
// Microsoft callback would pass the two refusals below on the day it was written and on the day
// the gate was deleted. The third attempt is the same account, the configured tenant and
// `dona.co.il`, and it must bind. That is the shape tests/policy/staff-session.test.ts uses: the
// check has to be able to see a violation, and it has to be able to let a clean case through.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import type {
  MicrosoftClaims,
  MicrosoftProvider,
} from '../../src/staff/contract.ts';
import {
  addOperator,
  OAUTH_COOKIE,
  SESSION_COOKIE,
} from '../../src/staff/contract.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');
const TENANT = '11111111-1111-1111-1111-111111111111';
const FOREIGN = '22222222-2222-2222-2222-222222222222';
const DOMAIN = 'dona.co.il';
const LISTED = 'policy262-listed@dona.co.il';
const OUTSIDE = 'policy262-outside@gmail.com';
const OBJECT_ID = '33333333-3333-3333-3333-333333333333';

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
        `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
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

describe('policy · a Microsoft sign-in is Dona Dom’s tenant and dona.co.il, or it is refused', () => {
  it('refuses a foreign tenant and an outside address even when the staff account exists, and binds the same account when both gates pass', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      await pool.query(
        'DELETE FROM staff_session WHERE staff_account_id IN (SELECT staff_account_id FROM staff_account WHERE email = ANY($1::text[]))',
        [[LISTED, OUTSIDE]],
      );
      await pool.query(
        'DELETE FROM staff_account WHERE email = ANY($1::text[])',
        [[LISTED, OUTSIDE]],
      );
      await pool.end();
    });
    await pool.query(
      'DELETE FROM staff_session WHERE staff_account_id IN (SELECT staff_account_id FROM staff_account WHERE email = ANY($1::text[]))',
      [[LISTED, OUTSIDE]],
    );
    await pool.query(
      'DELETE FROM staff_account WHERE email = ANY($1::text[])',
      [[LISTED, OUTSIDE]],
    );

    const microsoft = fakeMicrosoft();
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      microsoft,
    });
    await addOperator(pool, clock, { email: LISTED, role: 'OPERATOR' });
    await addOperator(pool, clock, { email: OUTSIDE, role: 'OPERATOR' });

    const attempt = async (
      claims: Omit<MicrosoftClaims, 'nonce' | 'objectId'>,
    ) => {
      const begun = await app.inject({
        method: 'GET',
        url: '/staff/auth/microsoft/start',
      });
      assert.equal(begun.statusCode, 303);
      const cookie = cookieNamed(begun.headers['set-cookie'], OAUTH_COOKIE);
      assert.notEqual(cookie, null);
      const location = new URL(begun.headers.location as string);
      const state = location.searchParams.get('state') as string;
      const nonce = location.searchParams.get('nonce') as string;
      const code = `code-${claims.email}-${claims.tenantId}`;
      microsoft.codes.set(code, {
        objectId: OBJECT_ID,
        nonce,
        ...claims,
      });
      return app.inject({
        method: 'GET',
        url: `/staff/auth/microsoft/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        headers: { cookie: cookie as string },
      });
    };

    const foreign = await attempt({
      tenantId: FOREIGN,
      issuer: issuer(FOREIGN),
      email: LISTED,
    });
    const outside = await attempt({
      tenantId: TENANT,
      issuer: issuer(TENANT),
      email: OUTSIDE,
    });

    for (const answer of [foreign, outside]) {
      assert.equal(answer.statusCode, 403);
      assert.equal(
        cookieNamed(answer.headers['set-cookie'], SESSION_COOKIE),
        null,
      );
    }
    assert.equal(foreign.body, outside.body);

    // The address on a foreign token is not evidence, so the refusal must not spend the
    // account's lockout either. Counting it would let another tenant's administrator lock a
    // staff member out by presenting their address.
    const bound = await pool.query<{
      idp_local_id: string | null;
      failed_attempts: number;
    }>(
      'SELECT idp_local_id, failed_attempts FROM staff_account WHERE email = ANY($1::text[]) ORDER BY email',
      [[LISTED, OUTSIDE]],
    );
    assert.deepEqual(
      bound.rows.map((row) => [row.idp_local_id, row.failed_attempts]),
      [
        [null, 0],
        [null, 0],
      ],
    );

    const accepted = await attempt({
      tenantId: TENANT,
      issuer: issuer(TENANT),
      email: LISTED,
    });
    assert.equal(accepted.statusCode, 303);
    assert.equal(accepted.headers.location, '/staff');
    const row = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [LISTED],
    );
    assert.equal(row.rows[0]?.idp_local_id, `ms:${TENANT}:${OBJECT_ID}`);
  });
});
