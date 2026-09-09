// The invite. **A printed one-time URL, never an email** (SPEC-staff.md): this system has no mail
// transport, and acquiring one is an external dependency with its own DPA, its own deliverability
// problem and its own fuse — not something a slice about sessions quietly adds. The inviter sees
// the URL on their own screen and hands it over by whatever channel they already trust.
//
// The token is hashed for the same reason the session's is, and for a sharper one: an invite that
// has not been accepted yet *is* an unclaimed account with a role already chosen for it.
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { normaliseEmail } from './accounts.ts';
import type { Role } from './roles.ts';
import { hashToken, newSessionToken } from './sessions.ts';
import type { Queryable } from './types.ts';

/** Long enough that the URL is the credential, short enough that an operator can be told to hurry. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StaffInvite {
  inviteId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
}

interface InviteRow {
  invite_id: string;
  email: string;
  role: string;
  expires_at: Date;
  accepted_at: Date | null;
}

function toInvite(row: InviteRow): StaffInvite {
  return {
    inviteId: row.invite_id,
    email: row.email,
    role: row.role as Role,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

/**
 * Returns the token **once**, exactly as `mintSession` does. The row keeps its hash, so an operator
 * who lost the URL is issued a new invite rather than shown the old one — which is the property
 * that makes a leaked backup of this table useless.
 */
export async function createInvite(
  db: Queryable,
  clock: Clock,
  spec: { email: string; role: Role; createdBy?: string | null },
): Promise<{ invite: StaffInvite; token: string }> {
  const token = newSessionToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const { rows } = await db.query<InviteRow>(
    `INSERT INTO staff_invite
       (invite_id, email, role, token_hash, created_at, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING invite_id, email, role, expires_at, accepted_at`,
    [
      newId(clock),
      normaliseEmail(spec.email),
      spec.role,
      hashToken(token),
      now,
      expiresAt,
      spec.createdBy ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new KernelError('unavailable', 'the invite was not written');
  }
  return { invite: toInvite(row), token };
}

/**
 * An open invite, or null. Expired, already accepted and never existed are one answer for the same
 * reason sign-in's three causes are: the page an unknown token reaches must not say which of them
 * it was.
 */
export async function openInviteByToken(
  db: Queryable,
  clock: Clock,
  token: string,
): Promise<StaffInvite | null> {
  const { rows } = await db.query<InviteRow>(
    `SELECT invite_id, email, role, expires_at, accepted_at
       FROM staff_invite
      WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > $2`,
    [hashToken(token), clock.now()],
  );
  return rows[0] ? toInvite(rows[0]) : null;
}

export async function markInviteAccepted(
  db: Queryable,
  clock: Clock,
  inviteId: string,
  staffAccountId: string,
): Promise<void> {
  await db.query(
    `UPDATE staff_invite
        SET accepted_at = $2, accepted_account_id = $3
      WHERE invite_id = $1 AND accepted_at IS NULL`,
    [inviteId, clock.now(), staffAccountId],
  );
}

/**
 * The `otpauth://` URI, built here rather than taken from the provider, because the label is ours:
 * an authenticator app shows whatever this string says, and "Dona Dom" beside the operator's own
 * address is what makes the right entry findable a year later.
 *
 * Rendered **as text** on the enrolment screen. There is no QR code, because a QR needs either a
 * canvas — client JavaScript, which SPEC.md refuses and tests/ui/tokens.test.ts fails the build
 * over — or an encoder taken as a dependency to save one operator fifteen seconds of typing, once.
 */
export function otpauthUri(email: string, sharedSecretKey: string): string {
  const label = encodeURIComponent(`Dona Dom:${email}`);
  const issuer = encodeURIComponent('Dona Dom');
  return `otpauth://totp/${label}?secret=${sharedSecretKey}&issuer=${issuer}`;
}
