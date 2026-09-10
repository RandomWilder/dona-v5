// `npm run staff:add -- <email> <ADMIN|OPERATOR|VIEWER>` — **how the first operator comes to exist.**
// Slice 5.1b, replacing 5.1's `staff:invite`.
//
// **Owed by 1.5, and this is the shape that discharges it.** `infra/bootstrap.sh` deliberately
// creates no staff seed secrets, because a generated credential that nothing reads and no rotation
// flow owns is worse than an absent one. v3 created four. There is nothing to seed here at all now:
// the row this writes carries an email and a role and no credential, because the credential is
// Google's (ADR-0005).
//
// **It prints nothing to hand over.** 5.1's invite was a one-time URL because this system has no
// mail transport; 5.1b deleted the invite, so there is no URL and nothing has to reach the new
// operator except the fact that they may now sign in.
//
// Deliberately wired into no workflow, like `src/seed.ts` and `src/seed-doctypes.ts`. It runs
// locally, or as a Cloud Run job from this same image.
import { systemClock } from './kernel/clock.ts';
import { createPool } from './kernel/db.ts';
import { addOperator, isRole } from './staff/contract.ts';

const [email, role] = process.argv.slice(2);

if (!email || !role || !isRole(role)) {
  console.error(
    'usage: npm run staff:add -- <email> <ADMIN|OPERATOR|VIEWER>\n' +
      '       the address is a Google account; adding one that exists moves its role',
  );
  process.exit(1);
}

const pool = createPool();
try {
  const { account, created } = await addOperator(pool, systemClock, {
    email,
    role,
  });
  console.log(
    `staff:add: ${created ? 'added' : 'role updated'} · ${account.email} · ${role}`,
  );
} catch (error) {
  console.error(
    `staff:add failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
