-- Slice 5.1. The admin edge's own three tables — the first tables in this system that describe an
-- *operator* rather than a household, a building or a piece of paper.
--
-- **staff owns none of E1-E16** (SPEC.md's module map, SPEC-staff.md). These three appear in no
-- entity catalogue and never will: they are the mechanism by which somebody is allowed to look at
-- the entities, and a schema that confused the two would put a staff role on the path that decides
-- tenant isolation. That path is src/scope/'s and has exactly one file.
--
-- **What is deliberately absent: a password, and a TOTP secret.** Identity Platform holds the
-- credential and the second factor; this schema holds a uid that points at them. There is no
-- password hash here to leak and no seed to steal, which is the reason the split is worth the
-- external dependency.
--
-- Every timestamp comes from the injected clock. No DEFAULT now() anywhere in this file: a
-- timestamp the tests cannot control is a session whose expiry cannot be walked without sleeping
-- (SPEC.md, "Time comes from the injected clock").

CREATE TABLE IF NOT EXISTS staff_account (
  staff_account_id uuid PRIMARY KEY,
  -- The Identity Platform uid, and the only join between this system and the credential it
  -- deliberately does not hold.
  -- not-pii: a provider-issued random handle. It identifies a row in Google's directory, not a
  -- person -- it carries no name, no address and nothing anybody could recognise a human by, and
  -- resolving it to one requires the same authority that already reads the email beside it.
  idp_local_id text NOT NULL UNIQUE,
  -- pii -- stored lowercased, normalised at the edge: an operator who was invited as Yael@ and
  -- signs in as yael@ is one person, and a UNIQUE index that disagrees would let them be two.
  email text NOT NULL UNIQUE,
  -- pii
  display_name text,
  -- **Nullable on purpose.** "An account with no role" is not a defect this column should refuse —
  -- it is a state the refusal path is written for, and it is what an operator whose access was
  -- withdrawn looks like. The CHECK names exactly the roles src/staff/internal/roles.ts defines, so
  -- a hand-written UPDATE cannot invent one: the matrix is code, and this constraint is the
  -- database agreeing with it rather than a second copy of it (SPEC-staff.md).
  role text CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
  -- v3's rolling window, kept: attempts counted, cleared on success. Identity Platform does its own
  -- abuse counting on the credential; this is ours on the account, and it is what makes a lockout
  -- visible to an operator reading the table rather than only to Google.
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL
);

-- **token_hash and never the token.** Reading this table gives an attacker nothing to ride: the
-- column holds sha256 of a 32-byte CSPRNG value and the cookie is its preimage. No pepper, and that
-- is a decision rather than an omission -- a pepper defends a secret whose preimage space can be
-- searched, and 256 bits is not one (SPEC-staff.md). tests/policy/staff-session.test.ts is the
-- standing form of the rule and was red before this file existed.
CREATE TABLE IF NOT EXISTS staff_session (
  session_id uuid PRIMARY KEY,
  staff_account_id uuid NOT NULL REFERENCES staff_account (staff_account_id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  -- 12 hours absolute. last_seen_at carries the 60-minute idle bound, which is enforced in the
  -- resolver rather than here: an idle timeout is a question asked at read time and a CHECK cannot
  -- ask it.
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  -- Sign-out is a row update, not a hope that the browser dropped the cookie.
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS staff_session_account
  ON staff_session (staff_account_id);

-- The invite is a printed one-time URL and never an email (SPEC-staff.md): this system has no mail
-- transport, and acquiring one is an external dependency with its own DPA and its own fuse. The
-- token is hashed here for the same reason the session's is, and for the sharper one -- an invite
-- that has not been accepted yet *is* an unclaimed account.
CREATE TABLE IF NOT EXISTS staff_invite (
  invite_id uuid PRIMARY KEY,
  -- pii
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_account_id uuid REFERENCES staff_account (staff_account_id),
  -- Nullable: the first invite in an environment is issued by `npm run staff:invite` and has no
  -- inviter, because there is no operator yet to be one. That is slice 1.5's argument honoured --
  -- a seeded credential nothing reads is worse than an absent one -- and this null is what it
  -- looks like in the schema.
  created_by uuid REFERENCES staff_account (staff_account_id)
);

CREATE INDEX IF NOT EXISTS staff_invite_open
  ON staff_invite (expires_at) WHERE accepted_at IS NULL;
