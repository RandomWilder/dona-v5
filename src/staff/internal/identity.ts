// The identity provider, as a port. **Slice 5.1b: the credential is Google's, entirely.**
//
// 5.1 put Identity Platform between this system and Google — our password form, our TOTP form, an
// invite URL and an enrolment screen, all to manage a credential this repository had already
// decided not to hold. Once the credential is Google's outright, Identity Platform is a directory
// in front of Google that costs a project config, an API key and 378 lines of adapter and buys one
// claim. So it is dropped, and what remains is the standard OIDC authorization-code flow:
// authorize -> code -> token -> a verified ID token, server-side, with no client JavaScript
// anywhere (ADR-0005, SPEC-staff.md).
//
// **What was lost is the assertable second factor**: 5.1 refused any ID token with no
// `firebase.sign_in_second_factor`, and nothing equivalent survives delegation. What stands in its
// place is `acceptClaims` below plus the allowlist in accounts.ts -- only an address that already
// has a staff_account row may sign in at all.
//
// `google-auth-library` was already a dependency of this repository, so no new runtime dependency
// arrives with this slice. It is used rather than hand-rolled for exactly one reason: verifying an
// ID token means checking a signature against Google's rotating JWKS, and that is the one piece of
// this flow where a bespoke implementation is genuinely dangerous.
//
// Sources:
//   https://developers.google.com/identity/openid-connect/openid-connect
import { OAuth2Client } from 'google-auth-library';
import { KernelError } from '../../kernel/errors.ts';

/** The claims this system reads out of a verified ID token, and no others. */
export interface GoogleClaims {
  /** Google's immutable account id. The row is bound to the first one that uses it. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** The Workspace domain, when the account has one. Null for a personal account. */
  hd: string | null;
  /** Echoed back from the authorization request. What makes a captured token useless. */
  nonce: string | null;
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

export interface IdentityProvider {
  /** Where the login link points. A pure string: no network, no state kept here. */
  authorizeUrl(input: AuthorizeInput): string;
  /** The code for a verified ID token's claims. Signature, `aud` and `exp` are checked inside. */
  exchangeCode(input: ExchangeInput): Promise<GoogleClaims>;
  describe(): string;
}

/**
 * An address and nothing else. This system never reads a contact list, a calendar or a photo, and
 * a scope it does not ask for is a line the operator does not have to weigh on the consent screen.
 */
const SCOPE = 'openid email';

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  client?: Pick<OAuth2Client, 'getToken' | 'verifyIdToken'>;
}

/**
 * What the callback will accept, as a pure function — which is why the refusals have tests that
 * need no network, no key and no clock.
 *
 * Returns the identity, or **null**, and the caller turns null into the one refusal this module
 * makes. It never says which condition failed: the caller could not use the distinction, and a
 * refusal that carried it would be an account-enumeration oracle (SPEC-staff.md).
 */
export function acceptClaims(
  claims: GoogleClaims,
  expected: { nonce: string; hd: string | null },
): { subject: string; email: string } | null {
  // The token was minted for a sign-in this browser never started.
  if (claims.nonce === null || claims.nonce !== expected.nonce) return null;
  // The allowlist is written in addresses, so an address Google has not verified is a claim by
  // whoever created the account rather than a fact about who they are.
  if (!claims.emailVerified) return null;
  const email = claims.email?.trim().toLowerCase();
  if (!email) return null;
  if (typeof claims.subject !== 'string' || claims.subject.length === 0) {
    return null;
  }
  // Unset is the honest default until Dona Dom's Workspace answer lands: the allowlist is the
  // fence, and the domain is a second condition when there is a domain to name.
  if (expected.hd !== null && claims.hd !== expected.hd) return null;
  return { subject: claims.subject, email };
}

export function createGoogleOidc(options: GoogleOidcOptions): IdentityProvider {
  const { clientId, clientSecret } = options;
  const client = options.client ?? new OAuth2Client({ clientId, clientSecret });

  return {
    authorizeUrl({ state, nonce, redirectUri }) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      // No refresh token: there is nothing for this system to do while the operator is away. The
      // session is ours and Google's tokens are consumed inside the request that fetched them.
      url.searchParams.set('access_type', 'online');
      // The account chooser, every time. Three operators sharing one laptop is the ordinary case in
      // a small office, and a sign-in that silently reuses whoever was last here is a wrong row.
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      let idToken: string | undefined;
      try {
        const { tokens } = await client.getToken({
          code,
          redirect_uri: redirectUri,
        });
        idToken = tokens.id_token ?? undefined;
      } catch (error) {
        // Google's own message names the account state; it never reaches a screen (SPEC.md).
        throw new IdentityRefusal(
          error instanceof Error ? error.message : 'token exchange failed',
          400,
        );
      }
      if (!idToken) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no token',
        );
      }
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no claims',
        );
      }
      return {
        subject: payload.sub,
        email: payload.email ?? null,
        emailVerified: payload.email_verified === true,
        hd: (payload as { hd?: string }).hd ?? null,
        nonce: payload.nonce ?? null,
      };
    },

    // The client id is public by construction — it is in the redirect every operator sees. The
    // secret is never printed, and the boot line is short enough to read at a glance.
    describe: () =>
      `google:${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`,
  };
}

/**
 * The provider said no. Carried as its own type so a route can tell "that code is spent" from "the
 * provider is down" **and then answer both the same way** — the distinction decides whether an
 * attempt is counted, never what the screen says.
 */
export class IdentityRefusal extends Error {
  readonly status: number;
  constructor(reason: string, status: number) {
    super(reason);
    this.name = 'IdentityRefusal';
    this.status = status;
  }
}

export function createUnconfiguredIdentity(): IdentityProvider {
  const refuse = (): never => {
    throw new KernelError('unavailable', 'no identity provider is configured');
  };
  return {
    authorizeUrl: refuse,
    exchangeCode: async () => refuse(),
    describe: () => 'unconfigured',
  };
}

/**
 * Absent either value the provider is `unconfigured` and says so — the shape `ObjectStore`,
 * `OcrText` and `Extractor` already use. `npm run dev` on a clean clone must start, and a deployed
 * revision that signs nobody in must be visibly different from one that does: `src/serve.ts` prints
 * `identity:` on its boot line, and `identity: unconfigured` on staging is as wrong as a `-dev`
 * version string.
 */
export function createConfiguredIdentity(
  env: Record<string, string | undefined> = process.env,
): IdentityProvider {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return createUnconfiguredIdentity();
  }
  return createGoogleOidc({ clientId, clientSecret });
}

/** The Workspace domain to require, when there is one. Unset means the allowlist is the only fence. */
export function configuredHostedDomain(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const hd = env.STAFF_GOOGLE_HD?.trim();
  return hd ? hd : null;
}
