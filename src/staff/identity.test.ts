// The identity port, and the four questions a callback asks about a token before it will mint a
// session. Slice 5.1b.
//
// **No network anywhere in this file.** `authorizeUrl` is a pure string, `acceptClaims` is a pure
// function, and the one place a token is verified against Google's keys is
// `OAuth2Client.verifyIdToken`, which is the library's job and is exercised for real by signing in
// rather than by a mock of somebody else's JWKS.
//
// The four refusals here are the ones that replaced 5.1's `firebase.sign_in_second_factor` check
// (ADR-0005): what this system can assert is who the token is for, that Google verified the
// address, that the token belongs to *this* sign-in, and — when the domain is known — that it came
// from Dona Dom's domain.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptClaims,
  createConfiguredIdentity,
  createGoogleOidc,
  createUnconfiguredIdentity,
  type GoogleClaims,
} from './contract.ts';

const CLAIMS: GoogleClaims = {
  subject: '104729103847561092837',
  email: 'Yael@donadom.co.il',
  emailVerified: true,
  hd: 'donadom.co.il',
  nonce: 'nonce-abc',
};

describe('staff · the authorization request', () => {
  it('asks Google for a code, with a state and a nonce, and no more scope than an address', () => {
    const url = new URL(
      createGoogleOidc({
        clientId: 'client-1.apps.googleusercontent.com',
        clientSecret: 'shh',
      }).authorizeUrl({
        state: 'state-abc',
        nonce: 'nonce-abc',
        redirectUri: 'https://example.test/staff/auth/callback',
      }),
    );
    assert.equal(
      url.origin + url.pathname,
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(
      url.searchParams.get('client_id'),
      'client-1.apps.googleusercontent.com',
    );
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://example.test/staff/auth/callback',
    );
    assert.equal(url.searchParams.get('state'), 'state-abc');
    assert.equal(url.searchParams.get('nonce'), 'nonce-abc');
    // An address and nothing else. This system never reads a contact list, a calendar or a photo,
    // and a scope it does not ask for is a consent screen line the operator does not have to weigh.
    assert.equal(url.searchParams.get('scope'), 'openid email');
    // No refresh token: there is nothing to do offline. The session is ours and Google's tokens are
    // consumed inside the request that fetched them (SPEC-staff.md).
    assert.notEqual(url.searchParams.get('access_type'), 'offline');
  });

  it('names the client on the boot line and never the secret', () => {
    const provider = createGoogleOidc({
      clientId: '482913-abcdef.apps.googleusercontent.com',
      clientSecret: 'shh',
    });
    assert.equal(provider.describe(), 'google:482913-abcdef');
    assert.doesNotMatch(provider.describe(), /shh/);
  });
});

describe('staff · what the callback will accept', () => {
  it('accepts a verified address and normalises it', () => {
    const accepted = acceptClaims(CLAIMS, { nonce: 'nonce-abc', hd: null });
    assert.deepEqual(accepted, {
      subject: '104729103847561092837',
      email: 'yael@donadom.co.il',
    });
  });

  it('refuses a token minted for another sign-in', () => {
    // The nonce is what makes a captured token useless: it was minted for a redirect this browser
    // never started.
    assert.equal(
      acceptClaims(CLAIMS, { nonce: 'nonce-other', hd: null }),
      null,
    );
    assert.equal(
      acceptClaims(
        { ...CLAIMS, nonce: null },
        { nonce: 'nonce-abc', hd: null },
      ),
      null,
    );
  });

  it('refuses an address Google has not verified', () => {
    // An unverified address is a claim by whoever created the account, and this system's whole
    // allowlist is written in addresses.
    assert.equal(
      acceptClaims(
        { ...CLAIMS, emailVerified: false },
        { nonce: 'nonce-abc', hd: null },
      ),
      null,
    );
  });

  it('refuses a token carrying no address at all', () => {
    assert.equal(
      acceptClaims(
        { ...CLAIMS, email: null },
        { nonce: 'nonce-abc', hd: null },
      ),
      null,
    );
  });

  it('refuses another domain when a domain is required, and any domain when none is', () => {
    // `STAFF_GOOGLE_HD` unset is the honest default until Dona Dom's Workspace answer lands: the
    // allowlist is the fence, and the domain is a second condition when there is one to name.
    assert.equal(
      acceptClaims(
        { ...CLAIMS, hd: 'somewhere-else.co.il' },
        { nonce: 'nonce-abc', hd: 'donadom.co.il' },
      ),
      null,
    );
    assert.equal(
      acceptClaims(
        { ...CLAIMS, hd: null },
        { nonce: 'nonce-abc', hd: 'donadom.co.il' },
      ),
      null,
    );
    assert.notEqual(
      acceptClaims({ ...CLAIMS, hd: null }, { nonce: 'nonce-abc', hd: null }),
      null,
    );
  });
});

describe('staff · an unconfigured provider', () => {
  it('says so rather than answering as though a sign-in failed', async () => {
    const provider = createUnconfiguredIdentity();
    assert.equal(provider.describe(), 'unconfigured');
    await assert.rejects(
      () =>
        provider.exchangeCode({
          code: 'x',
          redirectUri: 'https://example.test/cb',
        }),
      /no identity provider is configured/,
    );
    assert.throws(
      () =>
        provider.authorizeUrl({
          state: 's',
          nonce: 'n',
          redirectUri: 'https://example.test/cb',
        }),
      /no identity provider is configured/,
    );
  });

  it('is what a half-configured environment gets, not a half-working sign-in', () => {
    assert.equal(
      createConfiguredIdentity({
        GOOGLE_OAUTH_CLIENT_ID: 'only-the-id',
      }).describe(),
      'unconfigured',
    );
    assert.equal(
      createConfiguredIdentity({
        GOOGLE_OAUTH_CLIENT_SECRET: 'only-the-secret',
      }).describe(),
      'unconfigured',
    );
    assert.equal(
      createConfiguredIdentity({
        GOOGLE_OAUTH_CLIENT_ID: 'id-1.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret-1',
      }).describe(),
      'google:id-1',
    );
  });
});
