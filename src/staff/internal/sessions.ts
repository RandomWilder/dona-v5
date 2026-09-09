// The session. **`staff_session` stores `token_hash` and never the token** — reading the table gives
// an attacker nothing to ride, because the column holds a SHA-256 digest and the cookie is its
// preimage. tests/policy/staff-session.test.ts is the standing form of that rule and was red before
// 0021_staff.sql existed.
//
// **Why this system mints a session at all, when Identity Platform already returns a token.** An
// ID token is a JWT with a one-hour life that this application cannot revoke, so an operator
// dismissed at 09:00 would still hold authority until 10:00. The ID token is therefore consumed
// once, at the end of sign-in, and never stored or re-presented; what the browser carries is an
// opaque value this system minted, expires on its own injected clock, and revokes in one row.
//
// **No pepper**, and that is a decision rather than an omission (SPEC-staff.md): a pepper defends a
// secret whose preimage space can be searched, and 256 bits of CSPRNG output is not one. It would
// buy a secret to rotate, a rotation path to own and a way to lock every operator out of a running
// system, in exchange for nothing.
import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../../kernel/clock.ts';
import { newId } from '../../kernel/ids.ts';
import type { Role } from './roles.ts';
import type { Queryable } from './types.ts';

export const SESSION_COOKIE = 'dona_session';

/** 12 hours absolute, 60 minutes idle. Both walked by the injected clock, so a test needs no sleep. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 60 * 60 * 1000;

const TOKEN_BYTES = 32;

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface ResolvedSession {
  sessionId: string;
  staffAccountId: string;
  email: string;
  role: Role | null;
}

/**
 * Mints a session and returns the token **once**. The caller sets it as a cookie; nothing else in
 * this system ever sees it again, because nothing else has it — the row holds the hash.
 */
export async function mintSession(
  db: Queryable,
  clock: Clock,
  staffAccountId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.query(
    `INSERT INTO staff_session
       (session_id, staff_account_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [newId(clock), staffAccountId, hashToken(token), now, expiresAt],
  );
  return { token, expiresAt };
}

interface SessionRow {
  session_id: string;
  staff_account_id: string;
  email: string;
  role: string | null;
  last_seen_at: Date;
  disabled_at: Date | null;
}

/**
 * Resolves a cookie to an operator, or to null.
 *
 * **Null covers every reason**, and the caller answers all of them identically: no such session,
 * expired, idle past its bound, revoked, or an account disabled since the session was minted. That
 * last one is why the account is joined here rather than trusted from mint time — a withdrawal is
 * meant to take effect on the next request, not on the next sign-in.
 *
 * The idle bound is asked at read time and touched on success, which is why it is not a CHECK: a
 * constraint cannot ask "has an hour passed since the last request".
 */
export async function resolveSession(
  db: Queryable,
  clock: Clock,
  token: string,
): Promise<ResolvedSession | null> {
  const now = clock.now();
  const { rows } = await db.query<SessionRow>(
    `SELECT s.session_id, s.staff_account_id, a.email, a.role, s.last_seen_at, a.disabled_at
       FROM staff_session s
       JOIN staff_account a ON a.staff_account_id = s.staff_account_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > $2`,
    [hashToken(token), now],
  );
  const row = rows[0];
  if (row === undefined || row.disabled_at !== null) {
    return null;
  }
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_IDLE_MS) {
    return null;
  }
  await db.query(
    'UPDATE staff_session SET last_seen_at = $2 WHERE session_id = $1',
    [row.session_id, now],
  );
  return {
    sessionId: row.session_id,
    staffAccountId: row.staff_account_id,
    email: row.email,
    role: row.role as Role | null,
  };
}

/** Sign-out is a row update, not a hope that the browser dropped the cookie. */
export async function revokeSession(
  db: Queryable,
  clock: Clock,
  token: string,
): Promise<void> {
  await db.query(
    'UPDATE staff_session SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token), clock.now()],
  );
}

/**
 * The `Set-Cookie` value. `HttpOnly` and `Secure` are unarguable; `SameSite=Lax` is **this slice's
 * real cross-site defence** and is stated as such, because there is no CSRF token until slice 5.2 —
 * which owns the token in the same change that gives `POST /documents` one worth having
 * (SPEC-staff.md).
 *
 * `Secure` is dropped only when the request itself arrived over plain http, which is `npm run dev`
 * on 127.0.0.1 and nothing else: a cookie marked Secure is never sent back over http, so keeping it
 * unconditionally would mean local sign-in silently never works.
 */
export function sessionCookie(
  token: string,
  expiresAt: Date,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Fastify hands cookies as one header. No cookie plugin for one read of one name. */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(at + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}
