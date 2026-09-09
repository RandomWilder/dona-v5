// The role matrix, which is code and not a config row (SPEC-staff.md, docs/from-v3.md Tier 2).
//
// **What this suite is actually defending.** The matrix's value is not that ADMIN has more
// permissions than VIEWER — it is that no runtime path can change that. So the assertions are about
// the *shape* as much as the contents: frozen at both levels, a null role holds nothing, and every
// permission the vocabulary declares is held by somebody, because a permission no role holds is
// either a typo or a dead guard.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  can,
  isRole,
  PERMISSIONS,
  type Permission,
  permissionsOf,
  ROLES,
} from './contract.ts';

describe('the role matrix is code', () => {
  it('cannot be widened at runtime', () => {
    // A test that forgot to restore what it mutated, or a module that mutated what it was handed,
    // would make "the matrix is code" true only until the process started.
    const admin = permissionsOf('ADMIN');
    assert.ok(Object.isFrozen(admin));
    assert.throws(() => {
      (admin as Permission[]).push('settings.write');
    });
  });

  it('holds no permission for a role that is null', () => {
    // No account row, a row whose role was never assigned, and a disabled account all arrive here
    // as null. All three answer false, which is the same non-answer the refusal gives.
    for (const permission of PERMISSIONS) {
      assert.equal(can(null, permission), false, permission);
    }
  });

  it('gives ADMIN every permission and VIEWER only reads', () => {
    for (const permission of PERMISSIONS) {
      assert.equal(can('ADMIN', permission), true, permission);
    }
    assert.deepEqual(
      [...permissionsOf('VIEWER')],
      ['estate.read', 'documents.read'],
    );
    assert.equal(can('VIEWER', 'documents.write'), false);
    assert.equal(can('OPERATOR', 'settings.write'), false);
    assert.equal(can('OPERATOR', 'staff.invite'), false);
    assert.equal(can('OPERATOR', 'party.national_id.read'), false);
  });

  it('leaves no permission unheld by any role', () => {
    // A permission nobody holds is a typo or a guard that can never pass. `party.national_id.read`
    // has no reader until slice 5.3 and is still held by ADMIN, which is the difference between
    // "not used yet" and "unreachable".
    for (const permission of PERMISSIONS) {
      const holders = ROLES.filter((role) => can(role, permission));
      assert.ok(holders.length > 0, `${permission} is held by nobody`);
    }
  });

  it('refuses a role name the database could invent', () => {
    // staff_account.role is CHECKed against exactly these names, so this is the code half of the
    // same constraint: a row that somehow carried SUPERUSER resolves to no role, not to everything.
    assert.equal(isRole('ADMIN'), true);
    assert.equal(isRole('SUPERUSER'), false);
    assert.equal(isRole('admin'), false);
    assert.equal(isRole(null), false);
  });
});
