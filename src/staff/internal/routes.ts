// The staff module's HTTP surface. Slice 5.1 gave this system its first routes that decide who is
// asking rather than what to show; **slice 5.1b cut them from nine to five** by handing the
// credential to Google (ADR-0005). What is left is one link, one redirect, one callback, the board
// and the way out.
//
// **What this slice does not do: guard the other seven routes.** `/`, `/estate`,
// `/estate/buildings/:id`, `/estate/search`, `/estate/expiring`, `GET /documents/new` and
// `POST /documents` have served unauthenticated since week 1, deliberately and on fixture data.
// **Slice 5.2** puts them behind `requireStaff` in the same change that gives every write route a
// CSRF token worth having. A reader who finds an open estate route in a tree that contains this
// file is looking at a commit between the two, not at an omission.
//
// **The refusal is one sentence, always.** An address that is not on the list, an unverified
// address, an account with no role, a disabled account, a replayed `state` and a token minted for
// another sign-in all answer identically — otherwise the login screen of a system holding 1,500
// households is an account-enumeration oracle (SPEC-staff.md).
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText } from '../../kernel/validate.ts';
import {
  accountByEmail,
  addOperator,
  linkLocalId,
  notAllowed,
  requireUsableAccount,
} from './accounts.ts';
import { acceptClaims, type IdentityProvider } from './identity.ts';
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
  mintSession,
  newSessionToken,
  oauthCookie,
  type ResolvedSession,
  readOauthCookie,
  readSessionCookie,
  resolveSession,
  revokeSession,
  sessionCookie,
} from './sessions.ts';
import { REFUSED_HE, renderLoginPage, renderStaffHomePage } from './views.ts';

export interface StaffDeps {
  pool: Pool;
  clock: Clock;
  identity: IdentityProvider;
  /** Where Google is told to send the operator back. The request's own origin when absent, which is what `npm run dev` wants. */
  baseUrl?: string;
  /** The Workspace domain to require, when Dona Dom's answer is known. Null means the allowlist is the only fence. */
  hostedDomain?: string | null;
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

/** Where Google sends the operator back, and the value Google matches character for character. */
function callbackUrl(deps: StaffDeps, request: FastifyRequest): string {
  const base =
    deps.baseUrl ??
    `${isSecure(request) ? 'https' : 'http'}://${request.headers.host ?? '127.0.0.1'}`;
  return `${base.replace(/\/$/, '')}/staff/auth/callback`;
}

/** Constant time, because comparing a secret with `===` leaks its prefix one request at a time. */
function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The guard. **Slice 5.2's caller**, exported through `contract.ts` so the seven open routes get
 * exactly this one and never a second copy — a guard's second copy is how a guard dies
 * (tests/ui/tokens.test.ts carries the same sentence about its `SCREENS` registry).
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

/** Distinguishes "not signed in" from "not allowed" at the route, and nowhere else. */
function isMissingSession(error: unknown): boolean {
  return error instanceof KernelError && error.code === 'not_found';
}

export function registerStaffRoutes(
  app: FastifyInstance,
  deps: StaffDeps,
): void {
  const audit = createAuditLog(deps.pool, deps.clock);
  const unconfigured = () => deps.identity.describe() === 'unconfigured';

  // The urlencoded body these forms post is parsed by `src/kernel/ui/forms.ts`, registered once by
  // the composition root — estate has posted a form since 2.6 and staff is the second module to,
  // which is the moment a parser stops being one module's fact (the move the page shell made at
  // 3.3).
  app.register(async (scope) => {
    scope.get('/staff/login', async (_request, reply) => {
      html(reply);
      return renderLoginPage({ unconfigured: unconfigured() });
    });

    // **The redirect begins here so that the one-shot cookie is set by this system**, on this
    // origin, in the same response that sends the operator away. `state` and `nonce` are minted
    // together, spent together, and never reach the database (SPEC-staff.md).
    scope.get('/staff/auth/start', async (request, reply) => {
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

    scope.get('/staff/auth/callback', async (request, reply) => {
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

      const refuse = async (accountId?: string): Promise<string> => {
        await audit.write(
          {
            actorKind: 'staff',
            actorId: accountId,
            action: 'staff.login.refused',
            inputs: {},
          },
          { outcome: 'error', code: 'not_allowed' },
        );
        reply.header('set-cookie', cookies);
        reply.code(403);
        return renderLoginPage({ refused: REFUSED_HE });
      };

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

      // **The allowlist.** An address with no row reaches exactly the same answer as an address
      // with no Google account behind it (ADR-0005).
      const account = await accountByEmail(deps.pool, accepted.email);
      let role: Role;
      try {
        role = requireUsableAccount(account, deps.clock);
      } catch {
        // No row, no role, disabled, locked — one answer, and the audit line names the account only
        // when there is one to name. PII never in logs: no email here, ever (SPEC.md).
        return refuse(account?.staffAccountId);
      }
      const usable = account as NonNullable<typeof account>;

      // **The row is bound to the first Google account that ever uses it.** A re-created address is
      // not the same operator, and rebinding silently is how a stranger inherits a role.
      if (usable.idpLocalId === null) {
        await linkLocalId(deps.pool, usable.staffAccountId, accepted.subject);
      } else if (!sameValue(usable.idpLocalId, accepted.subject)) {
        return refuse(usable.staffAccountId);
      }

      const { token, expiresAt } = await mintSession(
        deps.pool,
        deps.clock,
        usable.staffAccountId,
      );
      await audit.write(
        {
          actorKind: 'staff',
          actorId: usable.staffAccountId,
          actorRole: role,
          action: 'staff.login',
          inputs: {},
        },
        { outcome: 'ok' },
      );
      cookies.push(sessionCookie(token, expiresAt, isSecure(request)));
      reply.header('set-cookie', cookies);
      return redirect(reply, '/staff');
    });

    scope.post('/staff/logout', async (request, reply) => {
      const token = readSessionCookie(request.headers.cookie);
      if (token !== null) {
        await revokeSession(deps.pool, deps.clock, token);
      }
      reply.header('set-cookie', clearedSessionCookie(isSecure(request)));
      return redirect(reply, '/staff/login');
    });

    scope.get('/staff', async (request, reply) => {
      let session: ResolvedSession;
      try {
        session = await requireStaff(deps, request, 'estate.read');
      } catch (error) {
        if (isMissingSession(error)) return redirect(reply, '/staff/login');
        throw error;
      }
      html(reply);
      const role = session.role as Role;
      return renderStaffHomePage({
        email: session.email,
        role,
        permissions: permissionsOf(role),
        mayInvite: can(role, 'staff.invite'),
      });
    });

    // **Adding an operator is writing the row that authorises them.** There is no invite, no token
    // and nothing to deliver: the person signs in with a Google account they already have.
    scope.post('/staff/operators', async (request, reply) => {
      let session: ResolvedSession;
      try {
        session = await requireStaff(deps, request, 'staff.invite');
      } catch (error) {
        if (isMissingSession(error)) return redirect(reply, '/staff/login');
        throw error;
      }
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
      return renderStaffHomePage({
        email: session.email,
        role,
        permissions: permissionsOf(role),
        mayInvite: true,
        addedOperator: {
          email: added.account.email,
          role: asked,
          created: added.created,
        },
      });
    });
  });
}
