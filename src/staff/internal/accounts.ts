// The operator's row, and the one refusal this module makes.
//
// **The row is the allowlist** (slice 5.1b, ADR-0005). Since the credential became Google's, this
// table is what decides who may sign in at all: an address with no row here reaches the same
// refusal as an address with no Google account. It is also what replaced the second factor this
// system could assert until 5.1, and the reason that trade is acceptable — the population went from
// everyone Google knows to a list a human wrote, one row at a time.
//
// **The refusal says `not_allowed` and nothing more** (SPEC.md's error shape, SPEC-staff.md).
// Several different facts produce the same answer, byte for byte: no row names the address; the row
// exists and its role is null; the row exists, has a role, and is disabled. An operator learns what
// they may do from the board, not by probing sign-in — and a refusal that distinguished *no such
// account* from *account with no role* would be an account-enumeration oracle on the login screen
// of a system holding 1,500 households.
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { Role } from './roles.ts';
import type { Queryable } from './types.ts';

/**
 * The one refusal. A frozen message, so no call site can enrich it with the fact it happens to
 * know — a test asserts the body is identical across all three causes.
 */
export const NOT_ALLOWED = 'not_allowed';

export function notAllowed(): KernelError {
  return new KernelError('not_allowed', NOT_ALLOWED);
}

export interface StaffAccount {
  staffAccountId: string;
  /** Null until the first Google sign-in against this address fills it (slice 5.1b, `0022_`). */
  idpLocalId: string | null;
  email: string;
  displayName: string | null;
  role: Role | null;
  disabledAt: Date | null;
  lockedUntil: Date | null;
  failedAttempts: number;
}

interface AccountRow {
  staff_account_id: string;
  idp_local_id: string | null;
  email: string;
  display_name: string | null;
  role: string | null;
  disabled_at: Date | null;
  locked_until: Date | null;
  failed_attempts: number;
}

const SELECT_ACCOUNT = `
  SELECT staff_account_id, idp_local_id, email, display_name, role,
         disabled_at, locked_until, failed_attempts
    FROM staff_account`;

function toAccount(row: AccountRow): StaffAccount {
  return {
    staffAccountId: row.staff_account_id,
    idpLocalId: row.idp_local_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as Role | null,
    disabledAt: row.disabled_at,
    lockedUntil: row.locked_until,
    failedAttempts: row.failed_attempts,
  };
}

/**
 * Stored lowercased and trimmed, and normalised on every read path too. An operator invited as
 * `Yael@` who signs in as `yael@` is one person, and a UNIQUE index that disagreed would quietly
 * let them be two — with two roles, one of which nobody remembers granting.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function accountByLocalId(
  db: Queryable,
  idpLocalId: string,
): Promise<StaffAccount | null> {
  const { rows } = await db.query<AccountRow>(
    `${SELECT_ACCOUNT} WHERE idp_local_id = $1`,
    [idpLocalId],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function accountByEmail(
  db: Queryable,
  email: string,
): Promise<StaffAccount | null> {
  const { rows } = await db.query<AccountRow>(
    `${SELECT_ACCOUNT} WHERE email = $1`,
    [normaliseEmail(email)],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

/**
 * Created by an admin, with a role and **no credential at all** — that is the whole of what adding
 * an operator means since 5.1b. `idpLocalId` is null until the first sign-in learns which Google
 * account is behind the address (`linkLocalId`).
 */
export async function createAccount(
  db: Queryable,
  clock: Clock,
  spec: {
    email: string;
    idpLocalId?: string | null;
    role?: Role | null;
    displayName?: string | null;
  },
): Promise<StaffAccount> {
  const id = newId(clock);
  const { rows } = await db.query<AccountRow>(
    `INSERT INTO staff_account
       (staff_account_id, idp_local_id, email, display_name, role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING staff_account_id, idp_local_id, email, display_name, role,
               disabled_at, locked_until, failed_attempts`,
    [
      id,
      spec.idpLocalId ?? null,
      normaliseEmail(spec.email),
      spec.displayName ?? null,
      spec.role ?? null,
      clock.now(),
    ],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new KernelError('unavailable', 'the account was not written');
  }
  return toAccount(row);
}

export async function assignRole(
  db: Queryable,
  staffAccountId: string,
  role: Role,
): Promise<void> {
  await db.query(
    'UPDATE staff_account SET role = $2 WHERE staff_account_id = $1',
    [staffAccountId, role],
  );
}

/**
 * **The row is bound to the first Google account that ever signs in against it**, and never
 * rebound here. An address can be deleted and re-created — by a Workspace administrator, or by
 * Google itself — and silently pointing an existing operator's row at the new `sub` would hand a
 * stranger that operator's role. A rebind is therefore a deliberate act by an admin and not a side
 * effect of a login; the callback refuses the mismatch (SPEC-staff.md).
 */
export async function linkLocalId(
  db: Queryable,
  staffAccountId: string,
  idpLocalId: string,
): Promise<void> {
  await db.query(
    'UPDATE staff_account SET idp_local_id = $2 WHERE staff_account_id = $1 AND idp_local_id IS NULL',
    [staffAccountId, idpLocalId],
  );
}

/**
 * Adding an operator: an email and a role, and that row *is* the authorisation. Adding an address
 * that already has a row moves its role rather than making a second person — an operator added as
 * `Yael@` and signing in as `yael@` is one person, and two rows would be two roles, one of which
 * nobody remembers granting.
 *
 * This is `assignRole`'s reader, which 5.0-cut recorded as owed.
 */
export async function addOperator(
  db: Queryable,
  clock: Clock,
  spec: { email: string; role: Role },
): Promise<{ account: StaffAccount; created: boolean }> {
  const existing = await accountByEmail(db, spec.email);
  if (existing !== null) {
    await assignRole(db, existing.staffAccountId, spec.role);
    return { account: { ...existing, role: spec.role }, created: false };
  }
  const account = await createAccount(db, clock, {
    email: spec.email,
    role: spec.role,
  });
  return { account, created: true };
}

/**
 * v3's rolling window, kept: attempts counted, cleared on success. Google counts its own abuse
 * against the credential; this counts ours against the account, so a lockout is visible to anyone
 * reading the table rather than only to Google.
 */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

export async function noteFailedAttempt(
  db: Queryable,
  clock: Clock,
  staffAccountId: string,
): Promise<void> {
  await db.query(
    `UPDATE staff_account
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN $3 ELSE locked_until END
      WHERE staff_account_id = $1`,
    [
      staffAccountId,
      MAX_FAILED_ATTEMPTS,
      new Date(clock.now().getTime() + LOCKOUT_MS),
    ],
  );
}

export async function clearFailedAttempts(
  db: Queryable,
  staffAccountId: string,
): Promise<void> {
  await db.query(
    'UPDATE staff_account SET failed_attempts = 0, locked_until = NULL WHERE staff_account_id = $1',
    [staffAccountId],
  );
}

/**
 * The gate every sign-in passes through. Returns the role, or throws the one refusal — and the
 * caller may not inspect *why*, because there is nothing in the error to inspect.
 */
export function requireUsableAccount(
  account: StaffAccount | null,
  clock: Clock,
): Role {
  if (account === null) throw notAllowed();
  if (account.disabledAt !== null) throw notAllowed();
  if (account.role === null) throw notAllowed();
  if (account.lockedUntil !== null && account.lockedUntil > clock.now()) {
    throw notAllowed();
  }
  return account.role;
}
