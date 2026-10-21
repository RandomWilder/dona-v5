// What every provider callback does once it has accepted a verified identity. The caller has already
// decided the token is this provider's and this browser's; this step only sees a binding id and an
// address, and it is the same step whichever provider produced them (SPEC-staff.md, ADR-0018).
import type { FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { sameValue } from '../../kernel/compare.ts';
import {
  accountByEmail,
  clearFailedAttempts,
  linkLocalId,
  noteFailedAttempt,
  requireUsableAccount,
} from './accounts.ts';
import type { Role } from './roles.ts';
import { mintSession, sessionCookie } from './sessions.ts';
import { REFUSED_HE, renderLoginPage } from './views.ts';

/** A provider-neutral identity: the binding id stored on the account, and the address the allowlist is keyed on. */
export interface VerifiedIdentity {
  bindingId: string;
  address: string;
}

/** The one refusal, before or after the identity is accepted. Names the account only when there is one. */
export async function refuseSignIn(
  deps: { pool: Pool; clock: Clock; offerMicrosoft?: boolean },
  audit: AuditLog,
  reply: FastifyReply,
  cookies: string[],
  accountId?: string,
): Promise<string> {
  // Counted only once the address is one this system already holds. A token that has not been
  // accepted does not name an account, and spending the lockout on an untrusted address would let
  // a stranger lock a staff member out. Google and Microsoft share this counter: a second provider
  // is not a second budget (ADR-0018).
  if (accountId !== undefined) {
    await noteFailedAttempt(deps.pool, deps.clock, accountId);
  }
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
  return renderLoginPage({
    refused: REFUSED_HE,
    microsoft: deps.offerMicrosoft === true,
  });
}

/**
 * Look up the staff account, refuse unless it is usable, bind it to this identity or refuse a
 * mismatch, then mint the session, write the audit row, set the cookie and redirect. A refusal
 * here is the same sentence as every earlier refusal, and the audit line names the account only
 * when there is one to name.
 *
 * `cookies` already holds whatever the callback must clear (the one-shot sign-in cookie). This
 * step appends the session cookie on success and sets the header either way.
 */
export async function completeSignIn(
  deps: { pool: Pool; clock: Clock; offerMicrosoft?: boolean },
  audit: AuditLog,
  reply: FastifyReply,
  secure: boolean,
  cookies: string[],
  identity: VerifiedIdentity,
): Promise<string | FastifyReply> {
  const refuse = (accountId?: string) =>
    refuseSignIn(deps, audit, reply, cookies, accountId);

  // **The allowlist.** An address with no row reaches exactly the same answer as an address the
  // provider never verified (ADR-0005, and the same fence for every later provider).
  const account = await accountByEmail(deps.pool, identity.address);
  let role: Role;
  try {
    role = requireUsableAccount(account, deps.clock);
  } catch {
    return refuse(account?.staffAccountId);
  }
  const usable = account as NonNullable<typeof account>;

  // **The row is bound to the first identity that ever uses it.** A re-created address is not the
  // same operator, and rebinding silently is how a stranger inherits a role. One account, one
  // binding (ADR-0018).
  if (usable.idpLocalId === null) {
    await linkLocalId(deps.pool, usable.staffAccountId, identity.bindingId);
  } else if (!sameValue(usable.idpLocalId, identity.bindingId)) {
    return refuse(usable.staffAccountId);
  }

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
  cookies.push(sessionCookie(token, expiresAt, secure));
  reply.header('set-cookie', cookies);
  return reply.code(303).header('location', '/staff').send();
}
