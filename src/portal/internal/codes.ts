// Sign-in codes. Six digits, one use, five minutes, five attempts, salted hash. The sender
// delivers; this file is the only place that knows whether the digits were right.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Pool } from 'pg';
import type { CodeSender } from '../../channel/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { sameValue } from '../../kernel/compare.ts';
import { newId } from '../../kernel/ids.ts';
import { hashToken } from '../../staff/contract.ts';
import { israeliMobile } from './phone.ts';
import type { Queryable } from './types.ts';

export const CODE_TTL_MS = 5 * 60 * 1000;
export const CODE_ATTEMPTS = 5;
export const RESEND_WAIT_MS = 60 * 1000;
export const SENDS_PER_NUMBER = 5;
export const SENDS_PER_ADDRESS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CodeNotice =
  | 'sign_in.not_mobile'
  | 'sign_in.capped'
  | 'sign_in.unavailable'
  | 'sign_in.wait'
  | 'code.wrong'
  | 'code.expired'
  | 'code.used'
  | 'code.exhausted';

export interface IssuedCode {
  challenge: string;
  phone: string;
  retryAt: Date;
  sent: boolean;
}

function hashCode(code: string, salt: string): string {
  return createHash('sha256')
    .update(`portal-code:${salt}:${code}`, 'utf8')
    .digest('hex');
}

function sixDigits(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function countSince(
  db: Queryable,
  sql: string,
  value: string,
  since: Date,
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql, [value, since]);
  return Number(rows[0]?.n ?? 0);
}

function sendsForPhone(
  db: Queryable,
  phone: string,
  since: Date,
): Promise<number> {
  return countSince(
    db,
    `SELECT count(*)::text AS n
       FROM portal_sign_in_code
      WHERE phone = $1
        AND created_at >= $2`,
    phone,
    since,
  );
}

function sendsForAddress(
  db: Queryable,
  address: string,
  since: Date,
): Promise<number> {
  return countSince(
    db,
    `SELECT count(*)::text AS n
       FROM portal_sign_in_code
      WHERE client_address = $1
        AND created_at >= $2`,
    address,
    since,
  );
}

async function auditSend(
  audit: AuditLog,
  outcome: 'ok' | 'error',
  reason: string | undefined,
  subjectId?: string,
): Promise<void> {
  await audit.write(
    {
      actorKind: 'tenant',
      action: 'portal.code.send',
      subjectId,
      inputs: reason === undefined ? {} : { reason },
    },
    outcome === 'ok'
      ? { outcome: 'ok' }
      : { outcome: 'error', code: 'too_many', message: reason },
  );
}

interface RecentCode {
  code_id: string;
  created_at: Date;
  consumed_at: Date | null;
  expires_at: Date;
}

type Prepared =
  | { notice: CodeNotice }
  | IssuedCode
  | {
      deliver: true;
      codeId: string;
      code: string;
      challenge: string;
      now: Date;
    };

async function locked<T>(
  db: Queryable,
  phone: string,
  address: string,
  body: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const pool = db as Pool;
  if (typeof pool.connect !== 'function') return body(db);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Phone first, then address, so two overlapping requests cannot deadlock.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`portal-phone:${phone}`],
    );
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`portal-address:${address}`],
    );
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function prepareCode(
  db: Queryable,
  clock: Clock,
  audit: AuditLog,
  phone: string,
  address: string,
): Promise<Prepared> {
  const now = clock.now();
  const { rows } = await db.query<RecentCode>(
    `SELECT code_id, created_at, consumed_at, expires_at
       FROM portal_sign_in_code
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone],
  );
  const latest = rows[0];
  if (
    latest !== undefined &&
    now.getTime() - latest.created_at.getTime() < RESEND_WAIT_MS
  ) {
    const retryAt = new Date(latest.created_at.getTime() + RESEND_WAIT_MS);
    const live =
      latest.consumed_at === null &&
      latest.expires_at.getTime() > now.getTime();
    if (!live) return { notice: 'sign_in.wait' };
    const challenge = randomBytes(32).toString('base64url');
    await db.query(
      'UPDATE portal_sign_in_code SET challenge_hash = $2 WHERE code_id = $1',
      [latest.code_id, hashToken(challenge)],
    );
    return { challenge, phone, retryAt, sent: false };
  }

  const since = new Date(now.getTime() - DAY_MS);
  if ((await sendsForPhone(db, phone, since)) >= SENDS_PER_NUMBER) {
    await auditSend(audit, 'error', 'number');
    return { notice: 'sign_in.capped' };
  }
  if ((await sendsForAddress(db, address, since)) >= SENDS_PER_ADDRESS) {
    await auditSend(audit, 'error', 'address');
    return { notice: 'sign_in.capped' };
  }

  const code = sixDigits();
  const salt = randomBytes(16).toString('hex');
  const challenge = randomBytes(32).toString('base64url');
  const codeId = newId(clock);
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db.query(
    `INSERT INTO portal_sign_in_code
       (code_id, phone, code_hash, code_salt, client_address, challenge_hash,
        attempts, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)`,
    [
      codeId,
      phone,
      hashCode(code, salt),
      salt,
      address,
      hashToken(challenge),
      now,
      expiresAt,
    ],
  );
  return { deliver: true, codeId, code, challenge, now };
}

export async function requestCode(
  db: Queryable,
  clock: Clock,
  audit: AuditLog,
  sender: CodeSender,
  input: { phoneRaw: string; address: string },
): Promise<{ notice: CodeNotice } | IssuedCode> {
  const phone = israeliMobile(input.phoneRaw);
  if (phone === null) return { notice: 'sign_in.not_mobile' };

  const prepared = await locked(db, phone, input.address, (tx) =>
    prepareCode(tx, clock, audit, phone, input.address),
  );
  if (!('deliver' in prepared)) return prepared;

  try {
    await sender.send({ to: phone, code: prepared.code });
  } catch {
    // The row stays, marked used, so the attempt counts and the minute still applies.
    await db.query(
      'UPDATE portal_sign_in_code SET consumed_at = $2 WHERE code_id = $1',
      [prepared.codeId, prepared.now],
    );
    await audit.write(
      {
        actorKind: 'tenant',
        action: 'portal.code.send',
        inputs: { reason: 'sender' },
      },
      { outcome: 'error', code: 'unavailable', message: 'sender' },
    );
    return { notice: 'sign_in.unavailable' };
  }
  await db.query(
    `UPDATE portal_sign_in_code
        SET consumed_at = $3
      WHERE phone = $1
        AND code_id <> $2
        AND consumed_at IS NULL`,
    [phone, prepared.codeId, prepared.now],
  );
  await auditSend(audit, 'ok', undefined, prepared.codeId);
  return {
    challenge: prepared.challenge,
    phone,
    retryAt: new Date(prepared.now.getTime() + RESEND_WAIT_MS),
    sent: true,
  };
}

interface CodeRow {
  code_id: string;
  phone: string;
  code_hash: string;
  code_salt: string;
  attempts: number;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

async function loadCode(
  db: Queryable,
  challenge: string,
): Promise<CodeRow | undefined> {
  const { rows } = await db.query<CodeRow>(
    `SELECT code_id, phone, code_hash, code_salt, attempts, created_at, expires_at, consumed_at
       FROM portal_sign_in_code
      WHERE challenge_hash = $1`,
    [hashToken(challenge)],
  );
  return rows[0];
}

export async function describeChallenge(
  db: Queryable,
  clock: Clock,
  challenge: string,
): Promise<{ phone: string; retryAt: Date; notice: CodeNotice | null } | null> {
  const row = await loadCode(db, challenge);
  if (row === undefined) return null;
  const now = clock.now();
  let notice: CodeNotice | null = null;
  if (row.consumed_at !== null) notice = 'code.used';
  else if (row.expires_at.getTime() <= now.getTime()) notice = 'code.expired';
  else if (row.attempts >= CODE_ATTEMPTS) notice = 'code.exhausted';
  return {
    phone: row.phone,
    retryAt: new Date(row.created_at.getTime() + RESEND_WAIT_MS),
    notice,
  };
}

export type VerifyResult =
  | { status: 'missing' }
  | { status: 'notice'; notice: CodeNotice; phone: string; retryAt: Date }
  | {
      status: 'signed-in';
      token: string;
      expiresAt: Date;
      portalIdentityId: string;
    };

async function auditVerify(
  audit: AuditLog,
  outcome: 'ok' | 'error',
  reason: string | undefined,
  actorId?: string,
): Promise<void> {
  await audit.write(
    {
      actorKind: 'tenant',
      actorId,
      action: 'portal.code.verify',
      subjectId: actorId,
      inputs: reason === undefined ? {} : { reason },
    },
    outcome === 'ok'
      ? { outcome: 'ok' }
      : { outcome: 'error', code: 'invalid', message: reason },
  );
}

export async function verifyCode(
  db: Queryable,
  clock: Clock,
  audit: AuditLog,
  challenge: string,
  typed: string,
  mint: (
    portalIdentityId: string,
  ) => Promise<{ token: string; expiresAt: Date }>,
): Promise<VerifyResult> {
  const row = await loadCode(db, challenge);
  if (row === undefined) {
    await auditVerify(audit, 'error', 'missing');
    return { status: 'missing' };
  }
  const now = clock.now();
  const retryAt = new Date(row.created_at.getTime() + RESEND_WAIT_MS);
  const fail = async (notice: CodeNotice): Promise<VerifyResult> => {
    await auditVerify(audit, 'error', notice);
    return { status: 'notice', notice, phone: row.phone, retryAt };
  };
  if (row.consumed_at !== null) return fail('code.used');
  if (row.expires_at.getTime() <= now.getTime()) return fail('code.expired');
  if (row.attempts >= CODE_ATTEMPTS) return fail('code.exhausted');

  const digits = typed.replace(/\D/g, '');
  const matches =
    /^\d{6}$/.test(digits) &&
    sameValue(hashCode(digits, row.code_salt), row.code_hash);
  if (!matches) {
    const { rows } = await db.query<{ attempts: number }>(
      `UPDATE portal_sign_in_code
          SET attempts = attempts + 1
        WHERE code_id = $1
          AND consumed_at IS NULL
          AND attempts < $2
        RETURNING attempts`,
      [row.code_id, CODE_ATTEMPTS],
    );
    const attempts = rows[0]?.attempts ?? CODE_ATTEMPTS;
    return fail(attempts >= CODE_ATTEMPTS ? 'code.exhausted' : 'code.wrong');
  }

  const consumed = await db.query(
    `UPDATE portal_sign_in_code
        SET consumed_at = $2
      WHERE code_id = $1
        AND consumed_at IS NULL
        AND attempts < $3
        AND expires_at > $2`,
    [row.code_id, now, CODE_ATTEMPTS],
  );
  if (consumed.rowCount === 0) return fail('code.used');

  const identityId = await ensureIdentity(db, clock, row.phone, now);
  const session = await mint(identityId);
  await auditVerify(audit, 'ok', undefined, identityId);
  return {
    status: 'signed-in',
    token: session.token,
    expiresAt: session.expiresAt,
    portalIdentityId: identityId,
  };
}

async function ensureIdentity(
  db: Queryable,
  clock: Clock,
  phone: string,
  now: Date,
): Promise<string> {
  const { rows } = await db.query<{ portal_identity_id: string }>(
    `INSERT INTO portal_identity (portal_identity_id, phone, verified_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING portal_identity_id`,
    [newId(clock), phone, now],
  );
  const id = rows[0]?.portal_identity_id;
  if (id === undefined) {
    throw new Error('portal identity was not stored');
  }
  return id;
}
