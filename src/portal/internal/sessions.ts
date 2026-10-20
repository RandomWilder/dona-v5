// The tenant session. The browser holds an opaque cookie. The row holds its hash.
// SameSite=Strict and no Domain: the cookie is host-only on the tenant host, and a staff
// session is a different cookie that this host does not read.
import { randomBytes } from 'node:crypto';
import type { Clock } from '../../kernel/clock.ts';
import { newId } from '../../kernel/ids.ts';
import { hashToken, readCookie } from '../../staff/contract.ts';
import type { Queryable } from './types.ts';

export const PORTAL_SESSION_COOKIE = 'dona_portal';
export const PORTAL_CHALLENGE_COOKIE = 'dona_portal_code';
export const PORTAL_FORM_COOKIE = 'dona_portal_form';

/** 30 days absolute, 14 days idle. Both walked by the injected clock. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;

const FORM_MAX_AGE = 600;
const CHALLENGE_MAX_AGE = 300;

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PortalSession {
  sessionId: string;
  portalIdentityId: string;
  phone: string;
}

export async function mintPortalSession(
  db: Queryable,
  clock: Clock,
  portalIdentityId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newOpaqueToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.query(
    `INSERT INTO portal_session
       (session_id, portal_identity_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [newId(clock), portalIdentityId, hashToken(token), now, expiresAt],
  );
  return { token, expiresAt };
}

interface SessionRow {
  session_id: string;
  portal_identity_id: string;
  phone: string;
  last_seen_at: Date;
}

export async function resolvePortalSession(
  db: Queryable,
  clock: Clock,
  token: string,
): Promise<PortalSession | null> {
  const now = clock.now();
  const { rows } = await db.query<SessionRow>(
    `SELECT s.session_id, s.portal_identity_id, i.phone, s.last_seen_at
       FROM portal_session s
       JOIN portal_identity i ON i.portal_identity_id = s.portal_identity_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > $2`,
    [hashToken(token), now],
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_IDLE_MS) return null;
  await db.query(
    'UPDATE portal_session SET last_seen_at = $2 WHERE session_id = $1',
    [row.session_id, now],
  );
  return {
    sessionId: row.session_id,
    portalIdentityId: row.portal_identity_id,
    phone: row.phone,
  };
}

export async function revokePortalSession(
  db: Queryable,
  clock: Clock,
  token: string,
): Promise<void> {
  await db.query(
    'UPDATE portal_session SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token), clock.now()],
  );
}

export async function revokeEveryPortalSession(
  db: Queryable,
  clock: Clock,
  portalIdentityId: string,
): Promise<void> {
  await db.query(
    `UPDATE portal_session
        SET revoked_at = $2
      WHERE portal_identity_id = $1
        AND revoked_at IS NULL`,
    [portalIdentityId, clock.now()],
  );
}

export function readPortalCookie(
  header: string | undefined,
  name: string,
): string | null {
  return readCookie(header, name);
}

interface CookieOptions {
  secure: boolean;
  maxAge?: number;
  expires?: Date;
  clear?: boolean;
}

export function portalCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (options.clear) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else if (options.expires !== undefined) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  } else if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function formCookie(token: string, secure: boolean): string {
  return portalCookie(PORTAL_FORM_COOKIE, token, {
    secure,
    maxAge: FORM_MAX_AGE,
  });
}

export function challengeCookie(token: string, secure: boolean): string {
  return portalCookie(PORTAL_CHALLENGE_COOKIE, token, {
    secure,
    maxAge: CHALLENGE_MAX_AGE,
  });
}

export function sessionCookie(
  token: string,
  expiresAt: Date,
  secure: boolean,
): string {
  return portalCookie(PORTAL_SESSION_COOKIE, token, {
    secure,
    expires: expiresAt,
  });
}

export function clearedCookie(name: string, secure: boolean): string {
  return portalCookie(name, '', { secure, clear: true });
}
