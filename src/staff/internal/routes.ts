// The staff module's HTTP surface. Slice 5.1 gave this system its first routes that decide who is
// asking rather than what to show; **slice 5.1b cut them from nine to five** by handing the
// credential to Google (ADR-0005). What is left is one link, one redirect, one callback, the board
// and the way out.
//
// **Slice 5.2 made this module's guard the whole application's.** `requireStaff` is now called from
// exactly one place — the `onRequest` hook in `src/app.ts` — against the permission each route
// declares in its own `config`. These five routes declare theirs like every other route in the
// system, and their handlers read `request.staff` rather than calling the guard again: a guard
// called twice is a guard that can be called once by mistake.
//
// **Three of them are `public`, and that is written rather than assumed.** The login screen, the
// redirect to Google and the callback all serve somebody who by definition has no session. The
// callback in particular must be reachable without one — it is what mints the first.
//
// **The refusal is one sentence, always.** An address that is not on the list, an unverified
// address, an account with no role, a disabled account, a replayed `state` and a token minted for
// another sign-in all answer identically — otherwise the login screen of a system holding 1,500
// households is an account-enumeration oracle (SPEC-staff.md).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest } from '../../chrome.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { sameValue } from '../../kernel/compare.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { requireText } from '../../kernel/validate.ts';
import { accountsByEmails, addOperator, notAllowed } from './accounts.ts';
import { csrfFrom } from './csrf.ts';
import { acceptClaims, type IdentityProvider } from './identity.ts';
import {
  acceptMicrosoftClaims,
  type MicrosoftProvider,
  microsoftSecretNotice,
} from './microsoft.ts';
import {
  can,
  isRole,
  type Permission,
  permissionsOf,
  type Role,
} from './roles.ts';
import {
  clearedOauthCookie,
  clearedSessionCookie,
  newSessionToken,
  oauthCookie,
  type ResolvedSession,
  readOauthCookie,
  readSessionCookie,
  resolveSession,
  revokeSession,
} from './sessions.ts';
import { completeSignIn, refuseSignIn } from './sign-in.ts';
import { renderLoginPage, renderStaffHomePage } from './views.ts';

export interface StaffDeps {
  pool: Pool;
  clock: Clock;
  identity: IdentityProvider;
  /** Microsoft, beside Google. Unconfigured unless the caller says otherwise, and Google is unaffected either way. */
  microsoft: MicrosoftProvider;
  /** Where Google is told to send the operator back. The request's own origin when absent, which is what `npm run dev` wants. */
  baseUrl?: string;
  /** The Workspace domain to require, when Dona Dom's answer is known. Null means the allowlist is the only fence. */
  hostedDomain?: string | null;
  /**
   * Slice 5.2b. Built at the composition root. Login screens do not receive it. **`mayFile` from
   * 6.9**: the rail's documents destination is gated on `documents.write`.
   */
  chrome: (
    csrf: string,
    dest: ChromeDest,
    mayFile: boolean,
    mayReadParties: boolean,
    openCalls?: number,
  ) => Html;
}

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  // A login screen in a shared browser's back button is a session handed to the next person at the
  // desk. `no-store` rather than `no-cache`: the callback's URL carries a one-time code, and a
  // cached page of a signed-in board is the same mistake in another costume.
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
}

/**
 * Cloud Run terminates TLS and forwards the fact in a header; the socket this process reads is
 * plain http. A cookie marked `Secure` is never sent back over http, so deciding this from the
 * socket alone would mean the cookie works locally and silently never works in production — or the
 * reverse. Both headers are consulted, and locally neither says https, which is correct.
 */
function isSecure(request: FastifyRequest): boolean {
  return (
    request.headers['x-forwarded-proto'] === 'https' ||
    request.protocol === 'https'
  );
}

function redirect(reply: FastifyReply, to: string): FastifyReply {
  // 303 and not 302: it says "now GET this" rather than leaving the method to the browser's
  // judgement, which matters on the POST paths and costs nothing on the GET ones.
  return reply.code(303).header('location', to).send();
}

type Form = Record<string, string>;

function field(body: unknown, name: string, max: number): string {
  return requireText((body as Form | undefined)?.[name], name, max);
}

/** Admins see the Microsoft client-secret warning. Operators and viewers do not. */
function secretNoticeFor(
  deps: StaffDeps,
  role: Role,
): { expires: string; expired: boolean } | null {
  if (role !== 'ADMIN') return null;
  return microsoftSecretNotice(process.env, deps.clock);
}

/** Where Google sends the operator back, and the value Google matches character for character. */
function callbackUrl(
  deps: StaffDeps,
  request: FastifyRequest,
  path = '/staff/auth/callback',
): string {
  const base =
    deps.baseUrl ??
    `${isSecure(request) ? 'https' : 'http'}://${request.headers.host ?? '127.0.0.1'}`;
  return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * The guard, and **the application's only one from slice 5.2**. It is exported through
 * `contract.ts` and called from exactly one place: the `onRequest` hook in `src/app.ts`, with
 * whatever permission the matched route declared. A guard's second copy is how a guard dies
 * (tests/ui/tokens.test.ts carries the same sentence about its `SCREENS` registry), and a guard
 * with sixteen call sites is fifteen chances to forget the seventeenth.
 *
 * No session at all is not a refusal: it is a request from somebody who has not signed in, and it
 * goes to the login screen. A session whose account has since lost its role, or been disabled, is a
 * refusal — and it is byte-identical to every other refusal this module makes.
 */
export async function requireStaff(
  deps: StaffDeps,
  request: FastifyRequest,
  permission: Permission,
): Promise<ResolvedSession> {
  const token = readSessionCookie(request.headers.cookie);
  if (token === null) {
    throw new KernelError('not_found', 'no session');
  }
  const session = await resolveSession(deps.pool, deps.clock, token);
  if (session === null) {
    throw new KernelError('not_found', 'no session');
  }
  if (!can(session.role, permission)) {
    throw notAllowed();
  }
  return session;
}

/**
 * The stances. `public` on the three sign-in routes because a person who is signing in has no
 * session yet, and on `POST /staff/logout` for a sharper reason: an operator whose role was
 * withdrawn holds a live session with no permission at all, and a logout behind a permission would
 * leave them unable to sign out of a system that will not let them do anything. It is still
 * defended — the CSRF hook keys on the presence of a session cookie, not on the route's stance.
 */
const PUBLIC = { config: { staff: 'public' } } as const;
const BOARD = { config: { staff: 'estate.read' } } as const;
const INVITE = { config: { staff: 'staff.invite' } } as const;

/** The session the guard already resolved. Absent only on a `public` route. */
function operator(request: FastifyRequest): ResolvedSession {
  const session = request.staff;
  if (!session) {
    throw notAllowed();
  }
  return session;
}

export function registerStaffRoutes(
  app: FastifyInstance,
  deps: StaffDeps,
): void {
  const audit = createAuditLog(deps.pool, deps.clock);
  const unconfigured = () => deps.identity.describe() === 'unconfigured';
  const signing = {
    pool: deps.pool,
    clock: deps.clock,
    offerMicrosoft: deps.microsoft.expected() !== null,
  };

  // The urlencoded body these forms post is parsed by `src/kernel/ui/forms.ts`, registered once by
  // the composition root — estate has posted a form since 2.6 and staff is the second module to,
  // which is the moment a parser stops being one module's fact (the move the page shell made at
  // 3.3).
  app.register(async (scope) => {
    scope.get('/staff/login', PUBLIC, async (_request, reply) => {
      html(reply);
      return renderLoginPage({
        unconfigured: unconfigured(),
        microsoft: signing.offerMicrosoft,
      });
    });

    // **The redirect begins here so that the one-shot cookie is set by this system**, on this
    // origin, in the same response that sends the operator away. `state` and `nonce` are minted
    // together, spent together, and never reach the database (SPEC-staff.md).
    scope.get('/staff/auth/start', PUBLIC, async (request, reply) => {
      if (unconfigured()) {
        html(reply);
        reply.code(503);
        return renderLoginPage({ unconfigured: true });
      }
      const state = newSessionToken();
      const nonce = newSessionToken();
      reply.header('set-cookie', oauthCookie(state, nonce, isSecure(request)));
      return redirect(
        reply,
        deps.identity.authorizeUrl({
          state,
          nonce,
          redirectUri: callbackUrl(deps, request),
        }),
      );
    });

    scope.get('/staff/auth/callback', PUBLIC, async (request, reply) => {
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };
      const carried = readOauthCookie(request.headers.cookie);
      // Spent on arrival, whatever happens next: the same redirect must not work twice from the
      // browser's history.
      const cookies = [clearedOauthCookie(isSecure(request))];
      html(reply);

      const refuse = () => refuseSignIn(signing, audit, reply, cookies);

      // Google declined, or the callback arrived without the redirect that should have started it.
      if (
        query.error !== undefined ||
        typeof query.code !== 'string' ||
        typeof query.state !== 'string' ||
        carried === null ||
        !sameValue(carried.state, query.state)
      ) {
        return refuse();
      }

      let claims: Awaited<ReturnType<IdentityProvider['exchangeCode']>>;
      try {
        claims = await deps.identity.exchangeCode({
          code: query.code,
          redirectUri: callbackUrl(deps, request),
        });
      } catch (error) {
        if (error instanceof KernelError && error.code === 'unavailable') {
          throw error;
        }
        return refuse();
      }

      const accepted = acceptClaims(claims, {
        nonce: carried.nonce,
        hd: deps.hostedDomain ?? null,
      });
      if (accepted === null) return refuse();

      return completeSignIn(signing, audit, reply, isSecure(request), cookies, {
        bindingId: accepted.subject,
        address: accepted.email,
      });
    });

    // Microsoft's own redirect URI, so a change to one provider's registration cannot move the
    // other's. Unconfigured is not a refusal: both routes answer unavailable, and the login screen
    // is what hides the button (SPEC-staff.md).
    scope.get('/staff/auth/microsoft/start', PUBLIC, async (request, reply) => {
      const expected = deps.microsoft.expected();
      if (expected === null) {
        throw new KernelError(
          'unavailable',
          'microsoft sign-in is not configured',
        );
      }
      const state = newSessionToken();
      const nonce = newSessionToken();
      reply.header('set-cookie', oauthCookie(state, nonce, isSecure(request)));
      return redirect(
        reply,
        deps.microsoft.authorizeUrl({
          state,
          nonce,
          redirectUri: callbackUrl(
            deps,
            request,
            '/staff/auth/microsoft/callback',
          ),
        }),
      );
    });

    scope.get(
      '/staff/auth/microsoft/callback',
      PUBLIC,
      async (request, reply) => {
        const expected = deps.microsoft.expected();
        if (expected === null) {
          throw new KernelError(
            'unavailable',
            'microsoft sign-in is not configured',
          );
        }
        const query = request.query as {
          code?: string;
          state?: string;
          error?: string;
        };
        const carried = readOauthCookie(request.headers.cookie);
        const cookies = [clearedOauthCookie(isSecure(request))];
        html(reply);
        const refuse = () => refuseSignIn(signing, audit, reply, cookies);

        if (
          query.error !== undefined ||
          typeof query.code !== 'string' ||
          typeof query.state !== 'string' ||
          carried === null ||
          !sameValue(carried.state, query.state)
        ) {
          return refuse();
        }

        let claims: Awaited<ReturnType<MicrosoftProvider['exchangeCode']>>;
        try {
          claims = await deps.microsoft.exchangeCode({
            code: query.code,
            redirectUri: callbackUrl(
              deps,
              request,
              '/staff/auth/microsoft/callback',
            ),
          });
        } catch (error) {
          if (error instanceof KernelError && error.code === 'unavailable') {
            throw error;
          }
          return refuse();
        }

        const accepted = acceptMicrosoftClaims(claims, {
          nonce: carried.nonce,
          tenantId: expected.tenantId,
          domain: expected.domain,
        });
        if (accepted === null) return refuse();

        // The person's addresses are the primary and its aliases (#289). Exactly one may name a
        // staff account: two would be a choice this system has no basis to make, and the refusal
        // names no account, so it spends neither one's lockout.
        const named = await accountsByEmails(deps.pool, accepted.addresses);
        const [account] = named;
        if (named.length !== 1 || account === undefined) return refuse();

        return completeSignIn(
          signing,
          audit,
          reply,
          isSecure(request),
          cookies,
          {
            bindingId: accepted.bindingId,
            address: account.email,
          },
        );
      },
    );

    scope.post('/staff/logout', PUBLIC, async (request, reply) => {
      const token = readSessionCookie(request.headers.cookie);
      if (token !== null) {
        await revokeSession(deps.pool, deps.clock, token);
      }
      reply.header('set-cookie', clearedSessionCookie(isSecure(request)));
      return redirect(reply, '/staff/login');
    });

    scope.get('/staff', BOARD, async (request, reply) => {
      const session = operator(request);
      html(reply);
      const role = session.role as Role;
      const csrf = csrfFrom(request);
      return renderStaffHomePage({
        nav: deps.chrome(
          csrf,
          'staff',
          can(request.staff?.role ?? null, 'documents.write'),
          can(request.staff?.role ?? null, 'party.read'),
          request.openCalls,
        ),
        csrf,
        email: session.email,
        role,
        permissions: permissionsOf(role),
        mayInvite: can(role, 'staff.invite'),
        secretNotice: secretNoticeFor(deps, role),
      });
    });

    // **Adding an operator is writing the row that authorises them.** There is no invite, no token
    // and nothing to deliver: the person signs in with a Google account they already have.
    scope.post('/staff/operators', INVITE, async (request, reply) => {
      const session = operator(request);
      const email = field(request.body, 'email', 320);
      const asked = field(request.body, 'role', 32);
      if (!isRole(asked)) {
        throw new KernelError('invalid', 'that is not a role');
      }
      const added = await audit.around(
        {
          actorKind: 'staff',
          actorId: session.staffAccountId,
          actorRole: session.role ?? undefined,
          action: 'staff.operator.add',
          inputs: { role: asked },
        },
        () => addOperator(deps.pool, deps.clock, { email, role: asked }),
      );
      html(reply);
      const role = session.role as Role;
      const csrf = csrfFrom(request);
      return renderStaffHomePage({
        nav: deps.chrome(
          csrf,
          'staff',
          can(request.staff?.role ?? null, 'documents.write'),
          can(request.staff?.role ?? null, 'party.read'),
          request.openCalls,
        ),
        csrf,
        email: session.email,
        role,
        permissions: permissionsOf(role),
        mayInvite: true,
        secretNotice: secretNoticeFor(deps, role),
        addedOperator: {
          email: added.account.email,
          role: asked,
          created: added.created,
        },
      });
    });
  });
}
