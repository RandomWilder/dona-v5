-- Slice 5.1b. The credential becomes Google's, and the invite stops being a thing this system owns.
--
-- **Why this is a forward migration and not an edit to 0021_.** 5.0-cut squashed two dead tables
-- out of 0002_ rather than dropping them, which is allowed while no environment holds real data
-- (docs/from-v3.md) -- and it reached no environment that had already run the file, because the
-- ledger is by filename with no checksum (src/kernel/migrate.ts). Staging ran 0021_ at the 5.1
-- deploy. Editing it would leave staging with idp_local_id NOT NULL, staff_invite standing, and a
-- first Google sign-in that fails on an INSERT nobody tested. So 0021_ stays as the record of what
-- every environment actually ran, and everything this slice changes is here.
--
-- The same fact makes this file the owner of 5.0-cut's one opened item: outbox and idempotency_keys
-- are still standing wherever 0002_ ran before the squash, which is local and staging. A migration
-- is the only mechanism that reaches both, and it needs no hand-run reset of the whole schema --
-- which is the act .claude/hooks/guard-bash.mjs refuses, and was right to.

-- **Filled by the first sign-in, not by the admin who adds the operator.** An operator is now a row
-- carrying an email and a role and no credential at all; the Google account behind that address is
-- learned the first time somebody uses it, and from then on the row is bound to that one `sub`.
-- The UNIQUE stays: Postgres allows many NULLs under it, and it is what stops two rows claiming the
-- same Google account.
ALTER TABLE staff_account ALTER COLUMN idp_local_id DROP NOT NULL;

-- The invite is deleted rather than replaced. There is no mail transport in this system and after
-- this slice nothing needs one: an admin writes the row, and the operator signs in with an account
-- they already have (SPEC-staff.md, ADR-0005).
DROP TABLE IF EXISTS staff_invite;

-- Slice 5.0-cut, finished. Both were written at 1.4 ahead of a caller and never acquired one.
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS idempotency_keys;
