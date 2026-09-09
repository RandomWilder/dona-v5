// `npm run staff:invite <email> <ADMIN|OPERATOR|VIEWER>` — **how the first operator comes to exist.**
// Slice 5.1.
//
// **Owed by 1.5, and this is the shape that discharges it.** `infra/bootstrap.sh` deliberately
// creates no staff seed secrets, because a generated credential that nothing reads and no rotation
// flow owns is worse than an absent one. v3 created four. So there is no seeded operator here
// either: the first invite is issued by a human who can already reach the database, and it expires
// on its own if nobody uses it.
//
// **It prints a URL and sends nothing.** This system has no mail transport, and acquiring one is an
// external dependency with its own DPA and its own fuse — not something a slice about sessions adds
// quietly (SPEC-staff.md). The row keeps a hash, so the URL is shown once and cannot be recovered
// from the table: an operator who lost it is issued a new invite.
//
// Deliberately wired into no workflow, like `src/seed.ts` and `src/seed-doctypes.ts`. It runs
// locally, or as a Cloud Run job from this same image.
import { systemClock } from './kernel/clock.ts';
import { createPool } from './kernel/db.ts';
import { createInvite, isRole } from './staff/contract.ts';

const [email, role] = process.argv.slice(2);
const base = process.env.STAFF_BASE_URL ?? 'http://127.0.0.1:3000';

if (!email || !role || !isRole(role)) {
  console.error(
    'usage: npm run staff:invite -- <email> <ADMIN|OPERATOR|VIEWER>\n' +
      '       STAFF_BASE_URL=https://… npm run staff:invite -- …  (for a deployed environment)',
  );
  process.exit(1);
}

const pool = createPool();
try {
  const { invite, token } = await createInvite(pool, systemClock, {
    email,
    role,
  });
  console.log(
    `staff:invite: ${invite.role} · expires ${invite.expiresAt.toISOString()}`,
  );
  // The one time this value is readable. Not logged anywhere else, and not recoverable from the row.
  console.log(`${base}/staff/invite/${token}`);
} catch (error) {
  console.error(
    `staff:invite failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
