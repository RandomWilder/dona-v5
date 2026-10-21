// The Microsoft sign-in gate: a token from another tenant, or an address outside the configured
// domain, is refused even when a staff account already names that address.
//
// #262, #289, SPEC-staff.md, ADR-0018. An address is a string the issuing directory's administrator
// can set to anything, including an address this system already trusts. The allowlist is not the
// fence on this path. The tenant and the domain are, and both are required.
//
// **The address is any of the person's own, not only the primary.** Dona Dom's staff have
// `@donail.onmicrosoft.com` as their primary address and `@dona.co.il` as an alias (#289). The
// second case below is that person, and the refusals beside it are the ways a wider match could
// let the wrong person in: a look-alike alias, a guest, a profile that is not the token's, and two
// addresses naming two accounts.
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
import { describe, it, type TestContext } from 'node:test';
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
const ALIASED = 'policy289-asafv@dona.co.il';
const OTHER = 'policy289-other@dona.co.il';
const PRIMARY = 'policy289-asafv@donail.onmicrosoft.com';
const ALL = [LISTED, OUTSIDE, ALIASED, OTHER];

type Presented = Pick<MicrosoftClaims, 'tenantId' | 'issuer' | 'addresses'> &
  Partial<Pick<MicrosoftClaims, 'objectId' | 'profileId' | 'userType'>>;

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

/** One app, one fake tenant, the four test rows cleared before and after. Null when there is no database. */
async function harness(t: TestContext) {
  const pool = await policyPool();
  if (pool === null) {
    t.skip(skipReason);
    return null;
  }
  t.after(async () => {
    await pool.query(
      'DELETE FROM staff_session WHERE staff_account_id IN (SELECT staff_account_id FROM staff_account WHERE email = ANY($1::text[]))',
      [ALL],
    );
    await pool.query(
      'DELETE FROM staff_account WHERE email = ANY($1::text[])',
      [ALL],
    );
    await pool.end();
  });
  await pool.query(
    'DELETE FROM staff_session WHERE staff_account_id IN (SELECT staff_account_id FROM staff_account WHERE email = ANY($1::text[]))',
    [ALL],
  );
  await pool.query('DELETE FROM staff_account WHERE email = ANY($1::text[])', [
    ALL,
  ]);

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
  await addOperator(pool, clock, { email: ALIASED, role: 'OPERATOR' });
  await addOperator(pool, clock, { email: OTHER, role: 'OPERATOR' });

  let codes = 0;
  const attempt = async (claims: Presented) => {
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
    codes += 1;
    const code = `code-${codes}`;
    const objectId = claims.objectId ?? OBJECT_ID;
    microsoft.codes.set(code, {
      objectId,
      profileId: objectId,
      userType: 'Member',
      nonce,
      ...claims,
    });
    return app.inject({
      method: 'GET',
      url: `/staff/auth/microsoft/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      headers: { cookie: cookie as string },
    });
  };
  return { pool, attempt };
}

describe('policy · a Microsoft sign-in is Dona Dom’s tenant and dona.co.il, or it is refused', () => {
  it('refuses a foreign tenant and an outside address even when the staff account exists, and binds the same account when both gates pass', async (t) => {
    const set = await harness(t);
    if (set === null) return;
    const { pool, attempt } = set;

    const foreign = await attempt({
      tenantId: FOREIGN,
      issuer: issuer(FOREIGN),
      addresses: [`SMTP:${LISTED}`],
    });
    const outside = await attempt({
      tenantId: TENANT,
      issuer: issuer(TENANT),
      addresses: [`SMTP:${OUTSIDE}`],
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
      addresses: [`SMTP:${LISTED}`],
    });
    assert.equal(accepted.statusCode, 303);
    assert.equal(accepted.headers.location, '/staff');
    const row = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [LISTED],
    );
    assert.equal(row.rows[0]?.idp_local_id, `ms:${TENANT}:${OBJECT_ID}`);
  });

  it('signs in a person whose dona.co.il address is an alias, and refuses a look-alike alias, a guest, a profile that is not the token’s and two addresses naming two accounts', async (t) => {
    const set = await harness(t);
    if (set === null) return;
    const { pool, attempt } = set;
    const ours = { tenantId: TENANT, issuer: issuer(TENANT) };
    const STRANGER = '44444444-4444-4444-4444-444444444444';

    const refusals = [
      await attempt({
        ...ours,
        objectId: STRANGER,
        addresses: [
          `SMTP:policy289-x@donail.onmicrosoft.com`,
          'smtp:policy289-x@evil-dona.co.il',
          'smtp:policy289-x@dona.co.il.evil',
        ],
      }),
      await attempt({
        ...ours,
        objectId: STRANGER,
        userType: 'Guest',
        addresses: [`SMTP:${ALIASED}`],
      }),
      await attempt({
        ...ours,
        objectId: STRANGER,
        profileId: OBJECT_ID,
        addresses: [`SMTP:${ALIASED}`],
      }),
      await attempt({
        ...ours,
        objectId: STRANGER,
        addresses: [`SMTP:${PRIMARY}`, `smtp:${ALIASED}`, `smtp:${OTHER}`],
      }),
    ];
    for (const answer of refusals) {
      assert.equal(answer.statusCode, 403);
      assert.equal(
        cookieNamed(answer.headers['set-cookie'], SESSION_COOKIE),
        null,
      );
      assert.equal(answer.body, refusals[0]?.body);
    }
    // Unbound, and no lockout spent: an address that was refused, or two that name two accounts,
    // is not evidence against either account.
    const untouched = await pool.query<{
      idp_local_id: string | null;
      failed_attempts: number;
    }>(
      'SELECT idp_local_id, failed_attempts FROM staff_account WHERE email = ANY($1::text[])',
      [[ALIASED, OTHER]],
    );
    assert.deepEqual(
      untouched.rows.map((row) => [row.idp_local_id, row.failed_attempts]),
      [
        [null, 0],
        [null, 0],
      ],
    );

    // The primary address is the onmicrosoft one; the staff row names the alias. Proxy entries
    // that are not SMTP, and the prefix's case, must not matter.
    const accepted = await attempt({
      ...ours,
      addresses: [
        'X500:/o=ExchangeLabs/ou=Exchange/cn=Recipients/cn=policy289',
        'SIP:policy289-asafv@donail.onmicrosoft.com',
        `SMTP:${PRIMARY}`,
        `smtp:${ALIASED.toUpperCase()}`,
      ],
    });
    assert.equal(accepted.statusCode, 303);
    assert.equal(accepted.headers.location, '/staff');
    const row = await pool.query<{ idp_local_id: string | null }>(
      'SELECT idp_local_id FROM staff_account WHERE email = $1',
      [ALIASED],
    );
    assert.equal(row.rows[0]?.idp_local_id, `ms:${TENANT}:${OBJECT_ID}`);
  });
});
