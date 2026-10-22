-- #275. A passkey is one WebAuthn credential on a portal identity. The challenge is
-- the one-time proof a ceremony has to present, and it is spent when it is used.
-- No phone on either table. No DEFAULT now(): the clock is injected (SPEC.md).

CREATE TABLE IF NOT EXISTS portal_passkey (
  passkey_id uuid PRIMARY KEY,
  portal_identity_id uuid NOT NULL REFERENCES portal_identity (portal_identity_id),
  credential_id bytea NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  sign_count integer NOT NULL,
  created_at timestamptz NOT NULL,
  removed_at timestamptz,
  CONSTRAINT portal_passkey_point CHECK (octet_length(public_key) = 65)
);

CREATE INDEX IF NOT EXISTS portal_passkey_identity
  ON portal_passkey (portal_identity_id);

CREATE TABLE IF NOT EXISTS portal_passkey_challenge (
  challenge_id uuid PRIMARY KEY,
  kind text NOT NULL,
  portal_identity_id uuid REFERENCES portal_identity (portal_identity_id),
  challenge bytea NOT NULL UNIQUE,
  origin text NOT NULL,
  rp_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT portal_passkey_challenge_kind
    CHECK (kind IN ('register', 'authenticate')),
  CONSTRAINT portal_passkey_challenge_identity CHECK (
    (kind = 'register' AND portal_identity_id IS NOT NULL)
    OR kind = 'authenticate'
  )
);
