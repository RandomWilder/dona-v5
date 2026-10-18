// The Microsoft provider, with no network and no staff row. The authorization URL is a pure string,
// the acceptance rule is a pure function, and the code exchange is exercised against a fake fetch
// and a fake verifier — except the one case that signs a token with a local key and asks the real
// verifier to accept it, which is what proves the published key is the key the signature is checked
// against (ADR-0018, #262).

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import {
  acceptMicrosoftClaims,
  createConfiguredMicrosoft,
  createMicrosoftOidc,
  IdentityRefusal,
  type MicrosoftClaims,
  microsoftBootLine,
  microsoftSecretNotice,
} from './contract.ts';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRET = 'microsoft-client-secret-value';
const DOMAIN = 'dona.co.il';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const CONSUMERS = '9188040d-6c67-4c5b-b112-36a304b66dad';

const CLAIMS: MicrosoftClaims = {
  objectId: '33333333-3333-3333-3333-333333333333',
  tenantId: TENANT,
  issuer: ISSUER,
  email: 'Yael@Dona.co.il',
  nonce: 'nonce-abc',
};

function configured(
  over: {
    fetch?: typeof fetch;
    verify?: Parameters<typeof createMicrosoftOidc>[0]['verify'];
  } = {},
) {
  return createMicrosoftOidc({
    clientId: CLIENT,
    clientSecret: SECRET,
    tenantId: TENANT,
    domain: DOMAIN,
    ...over,
  });
}

describe('staff · the Microsoft authorization request', () => {
  it('sends the operator to this tenant, with an account chooser and no more scope than an address', () => {
    const url = new URL(
      configured().authorizeUrl({
        state: 'state-abc',
        nonce: 'nonce-abc',
        redirectUri: 'https://example.test/staff/auth/microsoft/callback',
      }),
    );
    assert.equal(
      url.origin + url.pathname,
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    );
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), CLIENT);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://example.test/staff/auth/microsoft/callback',
    );
    assert.equal(url.searchParams.get('state'), 'state-abc');
    assert.equal(url.searchParams.get('nonce'), 'nonce-abc');
    assert.equal(url.searchParams.get('scope'), 'openid email');
    assert.equal(url.searchParams.get('prompt'), 'select_account');
    assert.equal(url.searchParams.get('client_secret'), null);
    assert.doesNotMatch(url.toString(), /microsoft-client-secret-value/);
  });
});

describe('staff · what a Microsoft callback will accept', () => {
  const expected = { nonce: 'nonce-abc', tenantId: TENANT, domain: DOMAIN };

  it('accepts this tenant and this domain, and binds ms:<tenant>:<object id>', () => {
    assert.deepEqual(acceptMicrosoftClaims(CLAIMS, expected), {
      bindingId: `ms:${TENANT}:${CLAIMS.objectId}`,
      email: 'yael@dona.co.il',
    });
  });

  it('refuses a foreign tenant, a personal account, a look-alike, a nonce mismatch and a missing address', () => {
    assert.equal(
      acceptMicrosoftClaims(
        { ...CLAIMS, tenantId: 'someone-else', issuer: ISSUER },
        expected,
      ),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims(
        {
          ...CLAIMS,
          tenantId: CONSUMERS,
          issuer: `https://login.microsoftonline.com/${CONSUMERS}/v2.0`,
          email: 'yael@dona.co.il',
        },
        expected,
      ),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims(
        { ...CLAIMS, email: 'x@evil-dona.co.il' },
        expected,
      ),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims(
        { ...CLAIMS, email: 'x@dona.co.il.evil' },
        expected,
      ),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims(CLAIMS, { ...expected, nonce: 'nonce-other' }),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims({ ...CLAIMS, nonce: null }, expected),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims({ ...CLAIMS, email: null }, expected),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims({ ...CLAIMS, email: '   ' }, expected),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims({ ...CLAIMS, objectId: '' }, expected),
      null,
    );
    assert.equal(
      acceptMicrosoftClaims(
        { ...CLAIMS, issuer: `https://sts.windows.net/${TENANT}/` },
        expected,
      ),
      null,
    );
  });
});

describe('staff · exchanging a Microsoft code', () => {
  function header(kid: string): string {
    return Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString(
      'base64url',
    );
  }

  it('posts the code to this tenant and reads the object id off the verified token', async () => {
    const seen: { url?: string; body?: string } = {};
    const jwt = `${header('kid-1')}.payload.sig`;
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const providerWithKey = configured({
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/token')) {
          seen.url = url;
          seen.body = String(init?.body);
          return new Response(JSON.stringify({ id_token: jwt }), {
            status: 200,
          });
        }
        assert.equal(
          url,
          `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        );
        return new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: 'kid-1', use: 'sig' }],
          }),
          { status: 200 },
        );
      },
      verify: async (_jwt, certs, audience, issuers) => {
        assert.equal(audience, CLIENT);
        assert.deepEqual(issuers, [ISSUER]);
        assert.match(certs['kid-1'] ?? '', /BEGIN PUBLIC KEY/);
        return {
          getPayload: () => ({
            oid: CLAIMS.objectId,
            sub: 'app-scoped-subject',
            tid: TENANT,
            iss: ISSUER,
            email: 'Yael@Dona.co.il',
            nonce: 'nonce-abc',
          }),
        };
      },
    });
    const claims = await providerWithKey.exchangeCode({
      code: 'code-1',
      redirectUri: 'https://example.test/staff/auth/microsoft/callback',
    });
    assert.equal(
      seen.url,
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    );
    const posted = new URLSearchParams(seen.body);
    assert.equal(posted.get('grant_type'), 'authorization_code');
    assert.equal(posted.get('code'), 'code-1');
    assert.equal(posted.get('client_id'), CLIENT);
    assert.equal(posted.get('client_secret'), SECRET);
    assert.equal(
      posted.get('redirect_uri'),
      'https://example.test/staff/auth/microsoft/callback',
    );
    assert.equal(claims.objectId, CLAIMS.objectId);
    assert.notEqual(claims.objectId, 'app-scoped-subject');
  });

  it('fetches the keys again when the token names a key the cache does not have', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    let keys = 0;
    const provider = configured({
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/token')) {
          return new Response(
            JSON.stringify({ id_token: `${header('kid-new')}.p.s` }),
            { status: 200 },
          );
        }
        keys += 1;
        const kid = keys === 1 ? 'kid-old' : 'kid-new';
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), {
          status: 200,
        });
      },
      verify: async () => ({
        getPayload: () => ({
          oid: 'oid-1',
          tid: TENANT,
          iss: ISSUER,
          email: 'a@dona.co.il',
          nonce: 'n',
        }),
      }),
    });
    const claims = await provider.exchangeCode({
      code: 'code-1',
      redirectUri: 'https://example.test/cb',
    });
    assert.equal(keys, 2);
    assert.equal(claims.objectId, 'oid-1');
  });

  it('refuses a token whose key is still unknown after the refetch, and a code the tenant rejects', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const unknown = configured({
      fetch: async (input) => {
        if (String(input).endsWith('/token')) {
          return new Response(
            JSON.stringify({ id_token: `${header('kid-missing')}.p.s` }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ keys: [{ ...jwk, kid: 'kid-other' }] }),
          { status: 200 },
        );
      },
    });
    await assert.rejects(
      () =>
        unknown.exchangeCode({ code: 'c', redirectUri: 'https://e.test/cb' }),
      IdentityRefusal,
    );

    const rejected = configured({
      fetch: async () => new Response('no', { status: 400 }),
    });
    await assert.rejects(
      () =>
        rejected.exchangeCode({ code: 'c', redirectUri: 'https://e.test/cb' }),
      IdentityRefusal,
    );

    const down = configured({
      fetch: async () => new Response('down', { status: 503 }),
    });
    await assert.rejects(
      () => down.exchangeCode({ code: 'c', redirectUri: 'https://e.test/cb' }),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'unavailable',
    );
  });

  it('checks the signature, the audience and the issuer against the tenant key', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = mint(privateKey, 'kid-1', {
      iss: ISSUER,
      aud: CLIENT,
      iat: now,
      exp: now + 3600,
      sub: 'app-scoped-subject',
      oid: CLAIMS.objectId,
      tid: TENANT,
      email: 'yael@dona.co.il',
      nonce: 'nonce-abc',
    });
    const jwk = publicKey.export({ format: 'jwk' });
    const provider = configured({
      fetch: async (input) => {
        if (String(input).endsWith('/token')) {
          return new Response(JSON.stringify({ id_token: token }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ keys: [{ ...jwk, kid: 'kid-1' }] }),
          { status: 200 },
        );
      },
    });
    const claims = await provider.exchangeCode({
      code: 'code-1',
      redirectUri: 'https://example.test/cb',
    });
    assert.equal(claims.objectId, CLAIMS.objectId);
    assert.equal(claims.tenantId, TENANT);
    assert.equal(claims.issuer, ISSUER);
    assert.equal(claims.email, 'yael@dona.co.il');

    const wrongAudience = mint(privateKey, 'kid-1', {
      iss: ISSUER,
      aud: 'somebody-else',
      iat: now,
      exp: now + 3600,
      oid: CLAIMS.objectId,
      tid: TENANT,
    });
    const refused = configured({
      fetch: async (input) => {
        if (String(input).endsWith('/token')) {
          return new Response(JSON.stringify({ id_token: wrongAudience }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ keys: [{ ...jwk, kid: 'kid-1' }] }),
          { status: 200 },
        );
      },
    });
    await assert.rejects(
      () =>
        refused.exchangeCode({ code: 'c', redirectUri: 'https://e.test/cb' }),
      IdentityRefusal,
    );
  });
});

describe('staff · Microsoft unconfigured', () => {
  it('is what a missing value gets, and the boot line names that without the secret', () => {
    const full = {
      MICROSOFT_OAUTH_CLIENT_ID: CLIENT,
      MICROSOFT_OAUTH_CLIENT_SECRET: SECRET,
      MICROSOFT_OAUTH_TENANT_ID: TENANT,
      MICROSOFT_OAUTH_DOMAIN: 'Dona.CO.IL',
    };
    for (const key of Object.keys(full)) {
      const provider = createConfiguredMicrosoft({ ...full, [key]: '  ' });
      assert.equal(provider.describe(), 'unconfigured');
      assert.equal(provider.expected(), null);
      assert.equal(microsoftBootLine(provider), 'microsoft:unconfigured');
      assert.doesNotMatch(
        microsoftBootLine(provider),
        /microsoft-client-secret/,
      );
    }
    const ready = createConfiguredMicrosoft(full);
    assert.equal(microsoftBootLine(ready), `microsoft:${CLIENT}`);
    assert.equal(ready.expected()?.domain, 'dona.co.il');
    assert.doesNotMatch(microsoftBootLine(ready), /microsoft-client-secret/);
    assert.equal(
      microsoftBootLine(createConfiguredMicrosoft({})),
      'microsoft:unconfigured',
    );
  });
});

describe('staff · Microsoft secret expiry', () => {
  it('warns from 30 days before the date, and stays quiet when the date is missing', () => {
    const env = { MICROSOFT_OAUTH_SECRET_EXPIRES: '2028-10-07' };
    const at = (iso: string) => fixedClock(new Date(iso));
    assert.equal(
      microsoftSecretNotice(env, at('2028-09-06T20:59:59.000Z')),
      null,
    );
    assert.deepEqual(
      microsoftSecretNotice(env, at('2028-09-06T21:00:00.000Z')),
      {
        expires: '2028-10-07',
        expired: false,
      },
    );
    assert.deepEqual(
      microsoftSecretNotice(env, at('2028-11-01T00:00:00.000Z')),
      {
        expires: '2028-10-07',
        expired: true,
      },
    );
    assert.equal(
      microsoftSecretNotice({}, at('2026-10-07T00:00:00.000Z')),
      null,
    );
    assert.equal(
      microsoftSecretNotice(
        { MICROSOFT_OAUTH_SECRET_EXPIRES: 'not-a-date' },
        at('2026-10-07T00:00:00.000Z'),
      ),
      null,
    );
    assert.equal(
      microsoftSecretNotice(
        { MICROSOFT_OAUTH_SECRET_EXPIRES: '2028-02-31' },
        at('2028-02-01T00:00:00.000Z'),
      ),
      null,
    );
  });

  it('mounts the five values on staging only when they exist, and names the Entra step', () => {
    const staging = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const prod = readFileSync('.github/workflows/release.yml', 'utf8');
    const bootstrap = readFileSync('infra/bootstrap.sh', 'utf8');
    const required = staging.slice(
      staging.indexOf('SECRETS="DATABASE_URL'),
      staging.indexOf('add_secret()'),
    );
    assert.doesNotMatch(required, /MICROSOFT_OAUTH/);
    for (const line of [
      'add_secret MICROSOFT_OAUTH_CLIENT_ID staging-microsoft-oauth-client-id',
      'add_secret MICROSOFT_OAUTH_CLIENT_SECRET staging-microsoft-oauth-client-secret',
      'add_secret MICROSOFT_OAUTH_TENANT_ID staging-microsoft-oauth-tenant-id',
      'add_secret MICROSOFT_OAUTH_SECRET_EXPIRES staging-microsoft-oauth-secret-expires',
    ]) {
      assert.match(staging, new RegExp(line.replace(/[.*]/g, '\\$&')));
    }
    assert.match(staging, /MICROSOFT_OAUTH_DOMAIN=dona\.co\.il/);
    assert.doesNotMatch(prod, /MICROSOFT_OAUTH/);
    assert.match(bootstrap, /microsoft-oauth-client-id/);
    assert.match(bootstrap, /microsoft-oauth-client-secret/);
    assert.match(bootstrap, /microsoft-oauth-tenant-id/);
    assert.match(bootstrap, /microsoft-oauth-secret-expires/);
    assert.match(bootstrap, /openid email/);
    assert.match(bootstrap, /\/staff\/auth\/microsoft\/callback/);
    assert.match(bootstrap, /microsoft:unconfigured/);
  });
});

function mint(
  privateKey: KeyObject,
  kid: string,
  payload: Record<string, unknown>,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = createSign('RSA-SHA256')
    .update(data)
    .sign(privateKey)
    .toString('base64url');
  return `${data}.${signature}`;
}
