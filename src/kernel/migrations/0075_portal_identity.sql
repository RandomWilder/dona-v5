-- #273. The portal's own three tables. A Portal identity is a verified phone number, not a
-- Party and not a role. A Tenant session is one device signed in as that number. A sign-in code
-- is the one-time proof that created the identity, and it is gone once it has been used.
--
-- No DEFAULT now() anywhere: timestamps come from the injected clock (SPEC.md).

CREATE TABLE IF NOT EXISTS portal_identity (
  portal_identity_id uuid PRIMARY KEY,
  -- pii
  phone text NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL
);

-- token_hash and never the token, the same rule as staff_session. 30 days absolute.
-- The 14-day idle bound is enforced when the row is read, because a CHECK cannot ask it.
CREATE TABLE IF NOT EXISTS portal_session (
  session_id uuid PRIMARY KEY,
  portal_identity_id uuid NOT NULL REFERENCES portal_identity (portal_identity_id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS portal_session_identity
  ON portal_session (portal_identity_id);

-- The code is a salted hash. Six digits would fall to a rainbow if the hash were bare, so each
-- row carries its own salt. The challenge cookie's preimage is not here either: challenge_hash
-- is sha256 of it.
CREATE TABLE IF NOT EXISTS portal_sign_in_code (
  code_id uuid PRIMARY KEY,
  -- pii
  phone text NOT NULL,
  code_hash text NOT NULL,
  code_salt text NOT NULL,
  -- pii
  client_address text NOT NULL,
  challenge_hash text NOT NULL UNIQUE,
  attempts integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS portal_sign_in_code_phone
  ON portal_sign_in_code (phone, created_at);

CREATE INDEX IF NOT EXISTS portal_sign_in_code_address
  ON portal_sign_in_code (client_address, created_at);
