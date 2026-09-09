// The identity provider, driven through a fake `fetch` — so what is under test is the request this
// module actually sends and the shape it actually reads back, not a mock of its own behaviour.
//
// **The case that matters most is the one that refuses a valid token.** An ID token with no
// `firebase.sign_in_second_factor` claim is what a password-only account produces, and "enforced,
// not offered" is this module recognising it rather than a checkbox in a console
// (SPEC-staff.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KernelError } from '../kernel/errors.ts';
import {
  createIdentityPlatform,
  createUnconfiguredIdentity,
  IdentityRefusal,
  readIdTokenClaims,
} from './contract.ts';

const PROJECT = 'dona-v5';

/** An unsigned JWT with the claims we read. Signature-shaped, because this module reads and does not verify — see identity.ts. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ aud: PROJECT, ...claims })}.signature`;
}

function respondingWith(
  handler: (
    url: string,
    body: Record<string, unknown>,
  ) => { status?: number; body: unknown },
): {
  call: typeof fetch;
  seen: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const call = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    seen.push({ url: String(url), body });
    const answer = handler(String(url), body);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { call, seen };
}

describe('reading an ID token', () => {
  it('names the account and the second factor', () => {
    const claims = readIdTokenClaims(
      idToken({ sub: 'uid-1', firebase: { sign_in_second_factor: 'totp' } }),
      PROJECT,
    );
    assert.deepEqual(claims, { localId: 'uid-1', secondFactor: 'totp' });
  });

  it('reports no second factor rather than inventing one', () => {
    // The single most important line in this file: a token from a password-only sign-in says
    // nothing about a second factor, and the caller refuses on exactly this null.
    const claims = readIdTokenClaims(idToken({ sub: 'uid-1' }), PROJECT);
    assert.equal(claims.secondFactor, null);
  });

  it('refuses a token minted for another project', () => {
    // Free, and it catches the one mistake TLS does not: an API key pointed at the wrong project.
    assert.throws(
      () =>
        readIdTokenClaims(idToken({ sub: 'uid-1' }), 'someone-elses-project'),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'unavailable',
    );
  });

  it('refuses a token that is not one', () => {
    assert.throws(() => readIdTokenClaims('not-a-token', PROJECT), KernelError);
    assert.throws(() => readIdTokenClaims('a.@@@.c', PROJECT), KernelError);
  });
});

describe('identity platform, over REST', () => {
  it('asks for the second factor when the provider does', async () => {
    const { call, seen } = respondingWith(() => ({
      body: {
        mfaPendingCredential: 'pending-abc',
        mfaInfo: [{ mfaEnrollmentId: 'enrol-1' }],
      },
    }));
    const identity = createIdentityPlatform({
      project: PROJECT,
      apiKey: 'test-key',
      fetchImpl: call,
    });
    const result = await identity.signInWithPassword('yael@example.test', 'pw');
    assert.equal(result.kind, 'mfa_required');
    assert.equal(
      result.kind === 'mfa_required' && result.pendingCredential,
      'pending-abc',
    );
    assert.match(
      seen[0]?.url ?? '',
      /accounts:signInWithPassword\?key=test-key$/,
    );
    assert.equal(seen[0]?.body.email, 'yael@example.test');
  });

  it('hands back the second factor the finalize step proved', async () => {
    const { call, seen } = respondingWith((url) =>
      url.includes('mfaSignIn:finalize')
        ? {
            body: {
              idToken: idToken({
                sub: 'uid-9',
                firebase: { sign_in_second_factor: 'totp' },
              }),
            },
          }
        : { body: {} },
    );
    const identity = createIdentityPlatform({
      project: PROJECT,
      apiKey: 'test-key',
      fetchImpl: call,
    });
    const signedIn = await identity.finalizeMfaSignIn(
      'pending-abc',
      'enrol-1',
      '123456',
    );
    assert.equal(signedIn.localId, 'uid-9');
    assert.equal(signedIn.secondFactor, 'totp');
    assert.equal(seen[0]?.body.mfaEnrollmentId, 'enrol-1');
    assert.deepEqual(seen[0]?.body.totpVerificationInfo, {
      verificationCode: '123456',
    });
  });

  it('turns a provider refusal into IdentityRefusal, and never into a message on a screen', async () => {
    // Google's own body names the account state — INVALID_PASSWORD, EMAIL_NOT_FOUND. It is carried
    // as a type the route can branch on and never as text a screen renders.
    const { call } = respondingWith(() => ({
      status: 400,
      body: { error: { message: 'EMAIL_NOT_FOUND' } },
    }));
    const identity = createIdentityPlatform({
      project: PROJECT,
      apiKey: 'test-key',
      fetchImpl: call,
    });
    await assert.rejects(
      identity.signInWithPassword('nobody@example.test', 'pw'),
      IdentityRefusal,
    );
  });

  it('starts a TOTP enrolment and reads the secret Google already encoded', async () => {
    // Base32 comes back from the provider, which is why this module carries no encoder and takes
    // no dependency for one.
    const { call, seen } = respondingWith(() => ({
      body: {
        totpSessionInfo: {
          sessionInfo: 'sess-1',
          sharedSecretKey: 'JBSWY3DPEHPK3PXP',
        },
      },
    }));
    const identity = createIdentityPlatform({
      project: PROJECT,
      apiKey: 'test-key',
      fetchImpl: call,
    });
    const enrolment = await identity.startTotpEnrollment('id-token');
    assert.deepEqual(enrolment, {
      sessionInfo: 'sess-1',
      sharedSecretKey: 'JBSWY3DPEHPK3PXP',
    });
    assert.match(seen[0]?.url ?? '', /mfaEnrollment:start/);
  });

  it('creates an account through the admin endpoint and not public sign-up', async () => {
    // Public sign-up stays disabled, so possession of the API key is not possession of an account.
    // The assertion is on the URL and the bearer, because that is the whole difference.
    const { call, seen } = respondingWith(() => ({
      body: { localId: 'uid-new' },
    }));
    const identity = createIdentityPlatform({
      project: PROJECT,
      apiKey: 'test-key',
      fetchImpl: call,
      token: async () => 'adc-token',
    });
    const created = await identity.createAccount(
      'new@example.test',
      'a-long-password',
    );
    assert.equal(created.localId, 'uid-new');
    assert.equal(
      seen[0]?.url,
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`,
    );
    assert.doesNotMatch(seen[0]?.url ?? '', /key=/);
  });

  it('is unconfigured, loudly, when there is no key', async () => {
    const identity = createUnconfiguredIdentity();
    assert.equal(identity.describe(), 'unconfigured');
    await assert.rejects(
      identity.signInWithPassword('a@b.test', 'pw'),
      KernelError,
    );
  });
});
