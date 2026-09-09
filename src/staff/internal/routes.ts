// The staff module's HTTP surface. Slice 5.1 — the first routes in this system that decide who is
// asking rather than what to show.
//
// **What this slice does not do: guard the other seven routes.** `/`, `/estate`,
// `/estate/buildings/:id`, `/estate/search`, `/estate/expiring`, `GET /documents/new` and
// `POST /documents` have served unauthenticated since week 1, deliberately and on fixture data.
// **Slice 5.2** puts them behind `requireStaff` in the same change that gives every write route a
// CSRF token worth having. A reader who finds an open estate route in a tree that contains this
// file is looking at a commit between the two, not at an omission.
//
// **The refusal is one sentence, always.** A wrong password, a wrong code, an unknown account, an
// account with no role and a disabled account all answer identically — otherwise the login screen
// of a system holding 1,500 households is an account-enumeration oracle (SPEC-staff.md).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText } from '../../kernel/validate.ts';
import {
  accountByEmail,
  accountByLocalId,
  clearFailedAttempts,
  createAccount,
  normaliseEmail,
  notAllowed,
  noteFailedAttempt,
  requireUsableAccount,
} from './accounts.ts';
import {
  type IdentityProvider,
  IdentityRefusal,
  type SignedIn,
} from './identity.ts';
import {
  createInvite,
  markInviteAccepted,
  openInviteByToken,
  otpauthUri,
} from './invites.ts';
import {
  can,
  isRole,
  type Permission,
  permissionsOf,
  type Role,
} from './roles.ts';
import {
  clearedSessionCookie,
  mintSession,
  type ResolvedSession,
  readSessionCookie,
  resolveSession,
  revokeSession,
  sessionCookie,
} from './sessions.ts';
import {
  REFUSED_HE,
  renderEnrolledPage,
  renderEnrolPage,
  renderInvitePage,
  renderLoginPage,
  renderSecondFactorPage,
  renderStaffHomePage,
} from './views.ts';

export interface StaffDeps {
  pool: Pool;
  clock: Clock;
  identity: IdentityProvider;
  /** Where an invite URL points. The request's own origin when absent, which is what `npm run dev` wants. */
  baseUrl?: string;
}

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  // A login screen in a shared browser's back button is a session handed to the next person at the
  // desk. `no-store` rather than `no-cache`: these pages carry a pending credential and an ID token
  // in hidden fields, and neither belongs in a disk cache.
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
  // 303 and not 302: every redirect here follows a POST, and 303 is the one that says "now GET
  // this" rather than leaving the method to the browser's judgement.
  return reply.code(303).header('location', to).send();
}

type Form = Record<string, string>;

function field(body: unknown, name: string, max: number): string {
  return requireText((body as Form | undefined)?.[name], name, max);
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

  // The urlencoded body these forms post is parsed by `src/kernel/ui/forms.ts`, registered once by
  // the composition root — estate has posted a form since 2.6 and staff is the second module to,
  // which is the moment a parser stops being one module's fact (the move the page shell made at
  // 3.3).
  app.register(async (scope) => {
    scope.get('/staff/login', async (_request, reply) => {
      html(reply);
      return renderLoginPage({
        unconfigured: deps.identity.describe() === 'unconfigured',
      });
    });

    scope.post('/staff/login', async (request, reply) => {
      const email = normaliseEmail(field(request.body, 'email', 320));
      const password = field(request.body, 'password', 1024);
      html(reply);

      // The account is read first so a failed attempt can be counted against it, and **the answer
      // does not depend on whether it was found**. Counting is the only thing this lookup changes.
      const account = await accountByEmail(deps.pool, email);

      let result: Awaited<ReturnType<IdentityProvider['signInWithPassword']>>;
      try {
        result = await deps.identity.signInWithPassword(email, password);
      } catch (error) {
        if (error instanceof IdentityRefusal) {
          if (account)
            await noteFailedAttempt(
              deps.pool,
              deps.clock,
              account.staffAccountId,
            );
          await audit.write(
            {
              actorKind: 'staff',
              actorId: account?.staffAccountId,
              action: 'staff.login.refused',
              inputs: {},
            },
            { outcome: 'error', code: 'not_allowed' },
          );
          reply.code(403);
          return renderLoginPage({ refused: REFUSED_HE });
        }
        throw error;
      }

      if (result.kind === 'signed_in') {
        // **Enforced, not offered.** A password alone produced a token, which means this account
        // has no second factor. Identity Platform's project config says ENFORCED and this line is
        // the claim with a test behind it (SPEC-staff.md).
        await audit.write(
          {
            actorKind: 'staff',
            actorId: account?.staffAccountId,
            action: 'staff.login.no_second_factor',
            inputs: {},
          },
          { outcome: 'error', code: 'not_allowed' },
        );
        reply.code(403);
        return renderLoginPage({ refused: REFUSED_HE });
      }

      return renderSecondFactorPage({
        pendingCredential: result.pendingCredential,
        enrollmentId: result.enrollmentId,
      });
    });

    scope.post('/staff/login/verify', async (request, reply) => {
      const pending = field(request.body, 'pending', 4096);
      const enrollment = field(request.body, 'enrollment', 256);
      const code = field(request.body, 'code', 16);
      html(reply);

      let signedIn: SignedIn;
      try {
        signedIn = await deps.identity.finalizeMfaSignIn(
          pending,
          enrollment,
          code,
        );
      } catch (error) {
        if (error instanceof IdentityRefusal) {
          reply.code(403);
          return renderSecondFactorPage({
            pendingCredential: pending,
            enrollmentId: enrollment,
            refused: REFUSED_HE,
          });
        }
        throw error;
      }

      // The second factor has to be *in the token*, not merely in the flow that produced it.
      if (signedIn.secondFactor === null) {
        reply.code(403);
        return renderLoginPage({ refused: REFUSED_HE });
      }

      const account = await accountByLocalId(deps.pool, signedIn.localId);
      let role: Role;
      try {
        role = requireUsableAccount(account, deps.clock);
      } catch {
        // No row, no role, disabled, locked — one answer, and the audit line names the account only
        // when there is one to name. PII never in logs: no email here, ever (SPEC.md).
        await audit.write(
          {
            actorKind: 'staff',
            actorId: account?.staffAccountId,
            action: 'staff.login.refused',
            inputs: {},
          },
          { outcome: 'error', code: 'not_allowed' },
        );
        reply.code(403);
        return renderLoginPage({ refused: REFUSED_HE });
      }

      const usable = account as NonNullable<typeof account>;
      await clearFailedAttempts(deps.pool, usable.staffAccountId);
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
      reply.header(
        'set-cookie',
        sessionCookie(token, expiresAt, isSecure(request)),
      );
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

    scope.post('/staff/invites', async (request, reply) => {
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
      const { invite, token } = await audit.around(
        {
          actorKind: 'staff',
          actorId: session.staffAccountId,
          actorRole: session.role ?? undefined,
          action: 'staff.invite.create',
          inputs: { role: asked },
        },
        () =>
          createInvite(deps.pool, deps.clock, {
            email,
            role: asked,
            createdBy: session.staffAccountId,
          }),
      );
      html(reply);
      const role = session.role as Role;
      return renderStaffHomePage({
        email: session.email,
        role,
        permissions: permissionsOf(role),
        mayInvite: true,
        issuedInviteUrl: inviteUrl(deps, request, token),
        refused: invite.acceptedAt === null ? undefined : REFUSED_HE,
      });
    });

    scope.get('/staff/invite/:token', async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const invite = await openInviteByToken(deps.pool, deps.clock, token);
      // Expired, already accepted and never existed are one answer, for the same reason sign-in's
      // three causes are: this page must not confirm that an address was ever invited.
      if (invite === null) throw new KernelError('not_found', 'no such invite');
      html(reply);
      return renderInvitePage({
        token,
        email: invite.email,
        role: invite.role,
      });
    });

    scope.post('/staff/invite/:token', async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const invite = await openInviteByToken(deps.pool, deps.clock, token);
      if (invite === null) throw new KernelError('not_found', 'no such invite');
      const password = field(request.body, 'password', 1024);
      if (password.length < 12) {
        html(reply);
        reply.code(400);
        return renderInvitePage({
          token,
          email: invite.email,
          role: invite.role,
          refused: 'הסיסמה קצרה מדי.',
        });
      }

      // Created through the **admin** endpoint under ADC — never the public sign-up endpoint, which
      // stays disabled, so possession of the API key is not possession of an account.
      const created = await deps.identity.createAccount(invite.email, password);
      const existing = await accountByLocalId(deps.pool, created.localId);
      const account =
        existing ??
        (await createAccount(deps.pool, deps.clock, {
          idpLocalId: created.localId,
          email: invite.email,
        }));

      // **The row exists and has no role.** The role lands only when enrolment finalises, below —
      // which is "enforced, not offered" read from the other end: an account that never enrolled a
      // second factor never acquires a role, so the two paths cannot disagree.
      const signedIn = await deps.identity.signInWithPassword(
        invite.email,
        password,
      );
      if (signedIn.kind !== 'signed_in') {
        throw new KernelError(
          'conflict',
          'that account already has a second factor',
        );
      }
      const enrolment = await deps.identity.startTotpEnrollment(
        signedIn.idToken,
      );
      await audit.write(
        {
          actorKind: 'staff',
          actorId: account.staffAccountId,
          action: 'staff.invite.accept',
          inputs: {},
        },
        { outcome: 'ok' },
      );
      html(reply);
      return renderEnrolPage({
        token,
        email: invite.email,
        sharedSecretKey: enrolment.sharedSecretKey,
        otpauthUri: otpauthUri(invite.email, enrolment.sharedSecretKey),
        sessionInfo: enrolment.sessionInfo,
        idToken: signedIn.idToken,
      });
    });

    scope.post('/staff/invite/:token/enrol', async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const invite = await openInviteByToken(deps.pool, deps.clock, token);
      if (invite === null) throw new KernelError('not_found', 'no such invite');
      const sessionInfo = field(request.body, 'session_info', 4096);
      const idToken = field(request.body, 'id_token', 4096);
      const code = field(request.body, 'code', 16);

      try {
        await deps.identity.finalizeTotpEnrollment(idToken, sessionInfo, code);
      } catch (error) {
        if (error instanceof IdentityRefusal) {
          html(reply);
          reply.code(403);
          return renderEnrolPage({
            token,
            email: invite.email,
            sharedSecretKey: '',
            otpauthUri: '',
            sessionInfo,
            idToken,
            refused: REFUSED_HE,
          });
        }
        throw error;
      }

      const account = await accountByEmail(deps.pool, invite.email);
      if (account === null)
        throw new KernelError('conflict', 'the account is not on file');
      await audit.around(
        {
          actorKind: 'staff',
          actorId: account.staffAccountId,
          actorRole: invite.role,
          action: 'staff.invite.enrolled',
          inputs: {},
        },
        async () => {
          await deps.pool.query(
            'UPDATE staff_account SET role = $2 WHERE staff_account_id = $1',
            [account.staffAccountId, invite.role],
          );
          await markInviteAccepted(
            deps.pool,
            deps.clock,
            invite.inviteId,
            account.staffAccountId,
          );
        },
      );
      html(reply);
      return renderEnrolledPage(invite.email);
    });
  });
}

/**
 * Where the invite URL points. The request's own origin unless the deployment says otherwise, so
 * `npm run dev` prints a link that works on 127.0.0.1 and staging prints its own hostname without a
 * second configuration value to keep in step.
 */
function inviteUrl(
  deps: StaffDeps,
  request: FastifyRequest,
  token: string,
): string {
  const base =
    deps.baseUrl ??
    `${isSecure(request) ? 'https' : 'http'}://${request.headers.host ?? '127.0.0.1'}`;
  return `${base}/staff/invite/${token}`;
}
