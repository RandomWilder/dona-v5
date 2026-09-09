// The identity provider, as a port.
//
// **Identity Platform holds the credential and the second factor; this system holds neither.** No
// password hash and no TOTP secret exist in this repository's schema — what `staff_account` keeps
// is a uid that points at Google's row (SPEC-staff.md, and docs/from-v3.md Tier 2 gap 1, which is
// the gap this closes: v3 hand-rolled email + password and had no MFA at all).
//
// **The second factor is TOTP and not SMS**, and that is a consequence of a rule rather than a
// preference: Identity Platform's SMS factor needs a reCAPTCHA token minted in the browser by
// Google's JavaScript SDK, and SPEC.md says the UI is self-contained HTML plus /ui/tokens.css and
// nothing else — a rule tests/ui/tokens.test.ts fails the build over. TOTP's REST endpoints need no
// reCAPTCHA, so every staff screen stays a plain server-rendered form.
//
// REST over `fetch`, ADC through google-auth-library for the one admin call. No Firebase SDK, and
// no new runtime dependency: the same split src/kernel/ocr.ts and src/kernel/objects.ts already
// made for Document AI and GCS.
//
// Sources:
//   https://cloud.google.com/identity-platform/docs/use-rest-api
//   https://cloud.google.com/identity-platform/docs/reference/rest/v2/accounts.mfaEnrollment
//   https://cloud.google.com/identity-platform/docs/reference/rest/v2/accounts.mfaSignIn
//   https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/create
import { GoogleAuth } from 'google-auth-library';
import { KernelError } from '../../kernel/errors.ts';

/** The password step succeeded and Identity Platform is asking for the second factor. */
export interface MfaRequired {
  kind: 'mfa_required';
  /**
   * Google's short-lived credential for the half-finished sign-in. **It never enters this
   * system's database** — it rides in a hidden field on the second-factor form for the seconds
   * that flow takes, and goes straight back to Google (SPEC-staff.md).
   */
  pendingCredential: string;
  enrollmentId: string;
}

/** A completed sign-in. `secondFactor` is what makes it acceptable, or does not. */
export interface SignedIn {
  kind: 'signed_in';
  localId: string;
  /**
   * The `firebase.sign_in_second_factor` claim, or null when the token carries none.
   * **Null is a refusal** at the call site: an ID token minted from a password alone means the
   * account has no second factor, and "enforced, not offered" is a claim this code makes rather
   * than a checkbox in a console (SPEC-staff.md).
   */
  secondFactor: string | null;
  /** Consumed inside the request that obtained it. Never stored, never sent to a browser. */
  idToken: string;
}

export type SignInResult = MfaRequired | SignedIn;

export interface TotpEnrollment {
  sessionInfo: string;
  /** Base32, as Google returns it — which is why this module needs no base32 encoder. */
  sharedSecretKey: string;
}

export interface IdentityProvider {
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  finalizeMfaSignIn(
    pendingCredential: string,
    enrollmentId: string,
    code: string,
  ): Promise<SignedIn>;
  /** Admin, under ADC. Public sign-up stays disabled, so holding the API key is not holding an account. */
  createAccount(email: string, password: string): Promise<{ localId: string }>;
  startTotpEnrollment(idToken: string): Promise<TotpEnrollment>;
  finalizeTotpEnrollment(
    idToken: string,
    sessionInfo: string,
    code: string,
  ): Promise<void>;
  describe(): string;
}

export const defaultIdentityTimeoutMs = 10_000;
/** The label Identity Platform stores beside the enrolled factor. One kind, so one constant. */
export const TOTP_FACTOR_NAME = 'Authenticator app';
const adminScope = 'https://www.googleapis.com/auth/identitytoolkit';

export interface IdentityPlatformOptions {
  project: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  token?: () => Promise<string>;
  timeoutMs?: number;
  endpoint?: string;
}

interface SignInBody {
  idToken?: string;
  localId?: string;
  mfaPendingCredential?: string;
  mfaInfo?: Array<{ mfaEnrollmentId?: string }>;
}

/**
 * Reads the claims out of an ID token **without verifying its signature**, and that is deliberate.
 *
 * A signature check answers "did Google mint this?", and it is indispensable wherever a token
 * arrives from a client. This one never does: it is a field in the JSON body of an outbound HTTPS
 * call this process made to `identitytoolkit.googleapis.com`, read once and discarded in the same
 * request. TLS already answers who sent it, and no browser ever holds it — what the browser holds
 * afterwards is this system's own opaque session token.
 *
 * The `aud` check is here anyway, because it is free and it catches the one mistake that would not
 * be caught otherwise: an API key pointed at the wrong project.
 */
export function readIdTokenClaims(
  idToken: string,
  project: string,
): { localId: string; secondFactor: string | null } {
  const payload = idToken.split('.')[1];
  if (payload === undefined) {
    throw new KernelError(
      'unavailable',
      'the identity provider returned no claims',
    );
  }
  let claims: {
    sub?: string;
    user_id?: string;
    aud?: string;
    firebase?: { sign_in_second_factor?: string };
  };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new KernelError(
      'unavailable',
      'the identity provider returned no claims',
    );
  }
  if (claims.aud !== project) {
    throw new KernelError(
      'unavailable',
      'the identity provider answered for another project',
    );
  }
  const localId = claims.sub ?? claims.user_id;
  if (typeof localId !== 'string' || localId.length === 0) {
    throw new KernelError(
      'unavailable',
      'the identity provider named no account',
    );
  }
  return {
    localId,
    secondFactor: claims.firebase?.sign_in_second_factor ?? null,
  };
}

export function createIdentityPlatform(
  options: IdentityPlatformOptions,
): IdentityProvider {
  const { project, apiKey } = options;
  const call = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultIdentityTimeoutMs;
  const host = options.endpoint ?? 'https://identitytoolkit.googleapis.com';
  let auth: GoogleAuth | null = null;
  const adminToken =
    options.token ??
    (async () => {
      auth ??= new GoogleAuth({ scopes: [adminScope] });
      const value = await auth.getAccessToken();
      if (!value) {
        throw new KernelError(
          'unavailable',
          'no access token for identity platform',
        );
      }
      return value;
    });

  // One place where a provider response becomes a KernelError, so no call site can accidentally
  // let Google's own message — which names the account state — reach a screen. SPEC.md: never leak
  // internals, and SPEC-staff.md: the refusal says not_allowed and nothing more.
  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await call(`${host}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new KernelError(
        'unavailable',
        'the identity provider did not answer',
        {
          timeoutMs,
        },
      );
    }
    const parsed = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const reason =
        (parsed.error as { message?: string } | undefined)?.message ?? '';
      throw new IdentityRefusal(reason, response.status);
    }
    return parsed;
  }

  return {
    async signInWithPassword(email, password) {
      const body = (await post(
        `/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          email,
          password,
          returnSecureToken: true,
        },
      )) as SignInBody;
      if (body.mfaPendingCredential) {
        const enrollmentId = body.mfaInfo?.[0]?.mfaEnrollmentId;
        if (!enrollmentId) {
          throw new KernelError(
            'unavailable',
            'the identity provider named no second factor',
          );
        }
        return {
          kind: 'mfa_required',
          pendingCredential: body.mfaPendingCredential,
          enrollmentId,
        };
      }
      if (!body.idToken) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no token',
        );
      }
      return {
        kind: 'signed_in',
        idToken: body.idToken,
        ...readIdTokenClaims(body.idToken, project),
      };
    },

    async finalizeMfaSignIn(pendingCredential, enrollmentId, code) {
      const body = (await post(
        `/v2/accounts/mfaSignIn:finalize?key=${apiKey}`,
        {
          mfaPendingCredential: pendingCredential,
          mfaEnrollmentId: enrollmentId,
          totpVerificationInfo: { verificationCode: code },
        },
      )) as { idToken?: string };
      if (!body.idToken) {
        throw new KernelError(
          'unavailable',
          'the identity provider returned no token',
        );
      }
      return {
        kind: 'signed_in',
        idToken: body.idToken,
        ...readIdTokenClaims(body.idToken, project),
      };
    },

    async createAccount(email, password) {
      const body = (await post(
        `/v1/projects/${project}/accounts`,
        { email, password, emailVerified: true },
        {
          authorization: `Bearer ${await adminToken()}`,
          // **The admin endpoint bills to a quota project and ADC does not always imply one.**
          // Found at 5.1 by running this path against the real provider rather than the fake: with
          // user credentials it answers 403 "requires a quota project, which is not set by default"
          // — a failure a Cloud Run service account would not have shown, so it would have been
          // discovered by whoever first ran the invite flow on a laptop. The header is correct in
          // both cases and costs nothing when the project is already implied.
          'x-goog-user-project': project,
        },
      )) as { localId?: string };
      if (!body.localId) {
        throw new KernelError(
          'unavailable',
          'the identity provider created no account',
        );
      }
      return { localId: body.localId };
    },

    async startTotpEnrollment(idToken) {
      const body = (await post(
        `/v2/accounts/mfaEnrollment:start?key=${apiKey}`,
        {
          idToken,
          totpEnrollmentInfo: {},
        },
      )) as {
        totpSessionInfo?: { sessionInfo?: string; sharedSecretKey?: string };
      };
      const info = body.totpSessionInfo;
      if (!info?.sessionInfo || !info.sharedSecretKey) {
        throw new KernelError(
          'unavailable',
          'the identity provider started no enrolment',
        );
      }
      return {
        sessionInfo: info.sessionInfo,
        sharedSecretKey: info.sharedSecretKey,
      };
    },

    async finalizeTotpEnrollment(idToken, sessionInfo, code) {
      await post(`/v2/accounts/mfaEnrollment:finalize?key=${apiKey}`, {
        idToken,
        // **Required, and the provider says so only when asked for real** — `MISSING_DISPLAY_NAME`,
        // found at 5.1 against the live endpoint. It names the *factor* rather than the person, and
        // it is the label Identity Platform shows beside the enrolment; a constant is right because
        // this system offers exactly one kind of second factor and never asks the operator to name
        // it.
        displayName: TOTP_FACTOR_NAME,
        totpVerificationInfo: { sessionInfo, verificationCode: code },
      });
    },

    describe: () => `identity-platform:${project}`,
  };
}

/**
 * The provider said no. Carried as its own type so a route can tell "wrong password" from "the
 * provider is down" **and then answer both the same way** — the distinction decides whether a
 * failed attempt is counted, never what the screen says.
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
  const refuse = async (): Promise<never> => {
    throw new KernelError('unavailable', 'no identity provider is configured');
  };
  return {
    signInWithPassword: refuse,
    finalizeMfaSignIn: refuse,
    createAccount: refuse,
    startTotpEnrollment: refuse,
    finalizeTotpEnrollment: refuse,
    describe: () => 'unconfigured',
  };
}

export function createConfiguredIdentity(
  env: Record<string, string | undefined> = process.env,
): IdentityProvider {
  const apiKey = env.IDENTITY_API_KEY;
  const project = env.IDENTITY_PLATFORM_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  if (!apiKey || !project) {
    return createUnconfiguredIdentity();
  }
  return createIdentityPlatform({ project, apiKey });
}
