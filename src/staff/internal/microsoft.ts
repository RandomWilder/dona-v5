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
// **The address is read from the person's own Graph profile, not the ID token** (#289). Dona Dom's
// staff have `@donail.onmicrosoft.com` as their primary address and `@dona.co.il` as an alias, and
// the token's `email` claim carries only the primary. `/me` lists every address the tenant gave the
// person.
//
// Sources:
//   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
//   https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens
//   https://learn.microsoft.com/en-us/graph/api/user-get
//   https://learn.microsoft.com/en-us/graph/api/resources/user (proxyAddresses)
import { createPublicKey } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { addDays, type Clock, today } from '../../kernel/clock.ts';
import { sameValue } from '../../kernel/compare.ts';
import { KernelError } from '../../kernel/errors.ts';
import { IdentityRefusal } from './identity.ts';

/**
 * What this system reads out of a verified Microsoft ID token, and out of the signed-in person's own
 * Graph profile fetched with the same exchange's access token. Nothing else.
 */
export interface MicrosoftClaims {
  /** Entra object id (`oid`). The binding is this, not the app-scoped `sub`. */
  objectId: string;
  /** The `tid` claim. */
  tenantId: string;
  /** The `iss` claim. */
  issuer: string;
  nonce: string | null;
  /** The Graph profile's `id`. It must be `objectId`, or the profile is not the token's person. */
  profileId: string;
  /** The Graph profile's `userType`: `Member` or `Guest`. */
  userType: string | null;
  /** The profile's `proxyAddresses`, as Graph returned them (`SMTP:primary`, `smtp:alias`, `SIP:…`). */
  addresses: string[];
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
 * Sign-in and the person's own profile, nothing else. `User.Read` cannot read mail or anyone else;
 * the mailbox app is a different registration (ADR-0018).
 */
const SCOPE = 'openid User.Read';

const PROFILE_URL =
  'https://graph.microsoft.com/v1.0/me?$select=id,userType,proxyAddresses';

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
 * What the callback will accept, as a pure function. Returns the binding and the candidate
 * addresses, or null, and the caller turns null into the one refusal. It never says which condition
 * failed (SPEC-staff.md). Which staff account the candidates name is the caller's question: exactly
 * one must, and that needs the database.
 *
 * The addresses are trusted only after the tenant and the issuer match. An address alone is not
 * evidence: the directory that issued the token can set it to anything, including one a staff
 * account already uses. The domain is the second gate, so a look-alike inside the right tenant is
 * still refused. A personal Microsoft account is a different tenant and a different issuer, and it
 * fails those same gates. The profile must be the token's person, and a member rather than a guest.
 */
export function acceptMicrosoftClaims(
  claims: MicrosoftClaims,
  expected: { nonce: string; tenantId: string; domain: string },
): { bindingId: string; addresses: string[] } | null {
  if (claims.nonce === null || !sameValue(claims.nonce, expected.nonce)) {
    return null;
  }
  if (claims.tenantId !== expected.tenantId) return null;
  const issuer = `https://login.microsoftonline.com/${expected.tenantId}/v2.0`;
  if (claims.issuer !== issuer) return null;
  if (typeof claims.objectId !== 'string' || claims.objectId.length === 0) {
    return null;
  }
  if (claims.profileId !== claims.objectId) return null;
  if (claims.userType !== 'Member') return null;
  const domain = expected.domain.trim().toLowerCase();
  const addresses = smtpAddresses(claims.addresses).filter(
    (address) => address.slice(address.lastIndexOf('@') + 1) === domain,
  );
  if (addresses.length === 0) return null;
  return {
    bindingId: `ms:${expected.tenantId}:${claims.objectId}`,
    addresses,
  };
}

/** The mail addresses among proxy addresses, primary or not, lower case, each once. `SIP:`, `X500:` and the rest are not mail. */
function smtpAddresses(proxies: string[]): string[] {
  const found = new Set<string>();
  for (const proxy of proxies) {
    if (typeof proxy !== 'string' || !/^smtp:/i.test(proxy)) continue;
    const address = proxy.slice('smtp:'.length).trim().toLowerCase();
    if (address.lastIndexOf('@') > 0) found.add(address);
  }
  return [...found];
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

  async function ownProfile(
    accessToken: string,
  ): Promise<Pick<MicrosoftClaims, 'profileId' | 'userType' | 'addresses'>> {
    let response: Response;
    try {
      response = await fetchImpl(PROFILE_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
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
      throw new IdentityRefusal('profile read failed', response.status);
    }
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new KernelError(
        'unavailable',
        'the identity provider returned no profile',
      );
    }
    const proxies = Array.isArray(body.proxyAddresses)
      ? body.proxyAddresses.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
    return {
      profileId: claimString(body, 'id') ?? '',
      userType: claimString(body, 'userType'),
      addresses: proxies,
    };
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
      let token: { id_token?: unknown; access_token?: unknown };
      try {
        token = (await response.json()) as {
          id_token?: unknown;
          access_token?: unknown;
        };
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
      // Only once the ID token has verified. The access token is used for this one request and
      // dropped: never stored, never logged.
      if (
        typeof token.access_token !== 'string' ||
        token.access_token.length === 0
      ) {
        throw new IdentityRefusal('no access token', 400);
      }
      const profile = await ownProfile(token.access_token);
      return {
        objectId: claimString(payload, 'oid') ?? '',
        tenantId: claimString(payload, 'tid') ?? '',
        issuer: claimString(payload, 'iss') ?? '',
        nonce: claimString(payload, 'nonce'),
        ...profile,
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

/** From 30 days before the client secret expires. No date, or a value that is not a date, is silence. */
const SECRET_WARN_DAYS = 30;

export function microsoftSecretNotice(
  env: Record<string, string | undefined>,
  clock: Clock,
): { expires: string; expired: boolean } | null {
  const expires = calendarDate(
    env.MICROSOFT_OAUTH_SECRET_EXPIRES?.trim() ?? '',
  );
  if (expires === null) return null;
  const day = today(clock);
  if (day < addDays(expires, -SECRET_WARN_DAYS)) return null;
  return { expires, expired: expires < day };
}

function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
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
