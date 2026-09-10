// The role matrix. **Code, not a config row** — a deliberate exception to SPEC.md rule 8's
// "policies are data", and v3 stated the reason exactly right: an access-control matrix that a
// database write could widen is a privilege-escalation path wearing the clothes of a setting.
// Changing who may mutate should cost a deploy and leave a diff a reviewer reads.
//
// So there is no table this is read from, no `config_settings` key that tunes it, and no admin
// screen that edits it — **including slice 5.8's settings screen**, which manages the
// `ObligationType` and `DocumentType` catalogues and must never grow a third card for this one.
// `staff_account.role` is CHECKed against exactly these names, so a hand-written UPDATE cannot
// invent a role the code does not know.

export const ROLES = ['ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'estate.read',
  'documents.read',
  'documents.write',
  'tenancy.write',
  'settings.write',
  'staff.invite',
  // Unused at 5.1, and here on purpose. SPEC.md's security default says `national_id` is
  // **admin-only, unreachable by any agent tool, and access-logged**; the "admin-only" half needs a
  // permission to name before week 9 can write the policy case that enforces the "unreachable"
  // half. A permission with no reader is a smaller lie than a security default with no vocabulary.
  'party.national_id.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Frozen at both levels, so the matrix cannot be widened at runtime either — by a test that forgot
// to restore it, by a module that mutated what it was handed, or by anything else that would make
// "the matrix is code" true only until the process started.
const MATRIX: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  ADMIN: Object.freeze([
    'estate.read',
    'documents.read',
    'documents.write',
    'tenancy.write',
    'settings.write',
    'staff.invite',
    'party.national_id.read',
  ] as const),
  OPERATOR: Object.freeze([
    'estate.read',
    'documents.read',
    'documents.write',
    'tenancy.write',
  ] as const),
  VIEWER: Object.freeze(['estate.read', 'documents.read'] as const),
});

/**
 * Whether a role holds a permission. **A null role is not a role** — no account row, a row whose
 * role was never assigned, and a disabled account all arrive here as null and all answer false,
 * which is the same non-answer the refusal gives (SPEC-staff.md).
 */
export function can(role: Role | null, permission: Permission): boolean {
  if (role === null) return false;
  return MATRIX[role].includes(permission);
}

export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}

/** What a role may do, for the operator's own page. Never for a decision — `can` is the decision. */
export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
