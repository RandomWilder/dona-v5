// Microsoft sign-in, beside Google. The credential is either provider's (ADR-0018). This file is the
// Microsoft one: a tenant-specific authorization-code flow, the pure acceptance rule, and nothing
// that knows about a staff row. The row, the session and the audit line are the shared step in
// sign-in.ts, which this module's callback calls after the rule has accepted the token.
//
// **No new dependency.** The code exchange is an HTTPS POST. The ID token is a signed JWT, and
// `google-auth-library` already verifies one against a set of keys. Microsoft publishes those keys
// as a JWKS document; this file turns each key into the PEM that verifier already accepts. A second
// auth library would be a dependency for a job the first one does (ADR-0018).
//
// Sources:
//   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
//   https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens
import { createPublicKey } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { sameValue } from '../../kernel/compare.ts';
import { KernelError } from '../../kernel/errors.ts';
import { IdentityRefusal } from './identity.ts';

/** The claims this system reads out of a verified Microsoft ID token, and no others. */
export interface MicrosoftClaims {
  /** Entra object id (`oid`). The binding is this, not the app-scoped `sub`. */
  objectId: string;
  /** The `tid` claim. */
  tenantId: string;
  /** The `iss` claim. */
  issuer: string;
  email: string | null;
  nonce: string | null;
}

export interface MicrosoftExpected {
  tenantId: string;
  domain: string;
}

export interface AuthorizeInput {
  state: string;
  nonce: string;
  redirectUri: string;
}

export interface ExchangeInput {
  code: string;
  redirectUri: string;
}

export interface MicrosoftProvider {
  /** Where the login link points. A pure string: no network, no state kept here. */
  authorizeUrl(input: AuthorizeInput): string;
  /** The code for a verified ID token's claims. Signature, audience and expiry are checked inside. */
  exchangeCode(input: ExchangeInput): Promise<MicrosoftClaims>;
  describe(): string;
  /**
   * The tenant and domain this provider will accept. Null when Microsoft is unconfigured, which is
   * how the routes decide to answer unavailable rather than start a redirect to nowhere.
   */
  expected(): MicrosoftExpected | null;
}

/**
 * An address and nothing else. The sign-in registration holds no mail permission; the mailbox app
 * is a different registration (ADR-0018).
 */
const SCOPE = 'openid email';

/** What `verifySignedJwtWithCertsAsync` accepts: a key id to a PEM. */
export type SigningKeys = Record<string, string>;

export interface VerifiedTicket {
  getPayload(): Record<string, unknown> | undefined;
}

export type MicrosoftVerifier = (
  jwt: string,
  certs: SigningKeys,
  audience: string,
  issuers: string[],
) => Promise<VerifiedTicket>;

export interface MicrosoftOidcOptions {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  domain: string;
  fetch?: typeof fetch;
  verify?: MicrosoftVerifier;
}

/**
 * What the callback will accept, as a pure function. Returns the identity, or null, and the caller
 * turns null into the one refusal. It never says which condition failed (SPEC-staff.md).
 *
 * The address is trusted only after the tenant and the issuer match. The email string alone is not
 * evidence: the directory that issued the token can set it to any address, including one a staff
 * account already uses. The domain is the second gate, so a look-alike inside the right tenant is
 * still refused. A personal Microsoft account is a different tenant and a different issuer, and it
 * fails those same gates.
 */
export function acceptMicrosoftClaims(
  claims: MicrosoftClaims,
  expected: { nonce: string; tenantId: string; domain: string },
): { bindingId: string; email: string } | null {
  if (claims.nonce === null || !sameValue(claims.nonce, expected.nonce)) {
    return null;
  }
  if (claims.tenantId !== expected.tenantId) return null;
  const issuer = `https://login.microsoftonline.com/${expected.tenantId}/v2.0`;
  if (claims.issuer !== issuer) return null;
  const email = claims.email?.trim().toLowerCase() ?? '';
  const at = email.lastIndexOf('@');
  if (at <= 0 || email.slice(at + 1) !== expected.domain.trim().toLowerCase()) {
    return null;
  }
  if (typeof claims.objectId !== 'string' || claims.objectId.length === 0) {
    return null;
  }
  return {
    bindingId: `ms:${expected.tenantId}:${claims.objectId}`,
    email,
  };
}

function authority(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

function v2Issuer(tenantId: string): string {
  return `${authority(tenantId)}/v2.0`;
}

interface PublishedKey {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

function pemFromJwk(jwk: { kty: string; n: string; e: string }): string {
  const exported = createPublicKey({ key: jwk, format: 'jwk' }).export({
    type: 'spki',
    format: 'pem',
  });
  return exported.toString();
}

function keyId(jwt: string): string | null {
  const encoded = jwt.split('.')[0];
  if (!encoded) return null;
  try {
    const header = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as { kid?: unknown };
    return typeof header.kid === 'string' && header.kid.length > 0
      ? header.kid
      : null;
  } catch {
    return null;
  }
}

async function verifyWithLibrary(
  jwt: string,
  certs: SigningKeys,
  audience: string,
  issuers: string[],
): Promise<VerifiedTicket> {
  const client = new OAuth2Client();
  const ticket = await client.verifySignedJwtWithCertsAsync(
    jwt,
    certs,
    audience,
    issuers,
  );
  return {
    getPayload() {
      const payload = ticket.getPayload();
      if (!payload) return undefined;
      return payload as unknown as Record<string, unknown>;
    },
  };
}

function claimString(
  payload: Record<string, unknown>,
  name: string,
): string | null {
  const value = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createMicrosoftOidc(
  options: MicrosoftOidcOptions,
): MicrosoftProvider {
  const { clientId, clientSecret, tenantId, domain } = options;
  const fetchImpl = options.fetch ?? fetch;
  const verify = options.verify ?? verifyWithLibrary;
  const tokenUrl = `${authority(tenantId)}/oauth2/v2.0/token`;
  const keysUrl = `${authority(tenantId)}/discovery/v2.0/keys`;
  const issuer = v2Issuer(tenantId);
  let cached: SigningKeys | null = null;

  async function signingKeys(force: boolean): Promise<SigningKeys> {
    if (cached !== null && !force) return cached;
    let response: Response;
    try {
      response = await fetchImpl(keysUrl);
    } catch {
      throw new KernelError(
        'unavailable',
        'the identity provider is unavailable',
      );
    }
    if (!response.ok) {
      throw new KernelError(
        'unavailable',
        'the identity provider is unavailable',
      );
    }
    let body: { keys?: PublishedKey[] };
    try {
      body = (await response.json()) as { keys?: PublishedKey[] };
    } catch {
      throw new KernelError(
        'unavailable',
        'the identity provider is unavailable',
      );
    }
    const certs: SigningKeys = {};
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
      certs[jwk.kid] = pemFromJwk({ kty: jwk.kty, n: jwk.n, e: jwk.e });
    }
    cached = certs;
    return certs;
  }

  return {
    authorizeUrl({ state, nonce, redirectUri }) {
      const url = new URL(`${authority(tenantId)}/oauth2/v2.0/authorize`);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      // The account chooser, every time. A shared office laptop is the ordinary case, and a
      // sign-in that silently reuses whoever was last here is a wrong row.
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        scope: SCOPE,
      });
      let response: Response;
      try {
        response = await fetchImpl(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
      } catch {
        throw new KernelError(
          'unavailable',
          'the identity provider is unavailable',
        );
      }
      if (!response.ok) {
        if (response.status >= 500) {
          throw new KernelError(
            'unavailable',
            'the identity provider is unavailable',
          );
        }
        throw new IdentityRefusal('token exchange failed', response.status);
      }
      let token: { id_token?: unknown };
      try {
        token = (await response.json()) as { id_token?: unknown };
      } catch {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no token',
        );
      }
      if (typeof token.id_token !== 'string' || token.id_token.length === 0) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no token',
        );
      }
      const kid = keyId(token.id_token);
      if (kid === null) {
        throw new IdentityRefusal('token exchange failed', 400);
      }
      let certs = await signingKeys(false);
      if (certs[kid] === undefined) {
        certs = await signingKeys(true);
      }
      if (certs[kid] === undefined) {
        throw new IdentityRefusal('token exchange failed', 400);
      }
      let ticket: VerifiedTicket;
      try {
        ticket = await verify(token.id_token, certs, clientId, [issuer]);
      } catch {
        throw new IdentityRefusal('token exchange failed', 400);
      }
      const payload = ticket.getPayload();
      if (!payload) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no claims',
        );
      }
      return {
        objectId: claimString(payload, 'oid') ?? '',
        tenantId: claimString(payload, 'tid') ?? '',
        issuer: claimString(payload, 'iss') ?? '',
        email: claimString(payload, 'email'),
        nonce: claimString(payload, 'nonce'),
      };
    },

    // The client id is public — it is in the redirect every operator sees. The secret is never
    // printed, and the boot line is this value with a `microsoft:` prefix.
    describe: () => clientId,

    expected: () => ({ tenantId, domain }),
  };
}

export function createUnconfiguredMicrosoft(): MicrosoftProvider {
  const refuse = (): never => {
    throw new KernelError('unavailable', 'microsoft sign-in is not configured');
  };
  return {
    authorizeUrl: refuse,
    exchangeCode: async () => refuse(),
    describe: () => 'unconfigured',
    expected: () => null,
  };
}

/**
 * The boot line. `microsoft:unconfigured` on a clean clone, and the client id when the four values
 * are present. The client secret is not an input to this string.
 */
export function microsoftBootLine(provider: MicrosoftProvider): string {
  return `microsoft:${provider.describe()}`;
}

/**
 * Missing any of the client id, the client secret, the tenant or the domain leaves Microsoft
 * unconfigured. The application still starts, and Google is unaffected (SPEC-staff.md).
 */
export function createConfiguredMicrosoft(
  env: Record<string, string | undefined> = process.env,
): MicrosoftProvider {
  const clientId = env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const tenantId = env.MICROSOFT_OAUTH_TENANT_ID?.trim();
  const domain = env.MICROSOFT_OAUTH_DOMAIN?.trim().toLowerCase();
  if (!clientId || !clientSecret || !tenantId || !domain) {
    return createUnconfiguredMicrosoft();
  }
  return createMicrosoftOidc({ clientId, clientSecret, tenantId, domain });
}
