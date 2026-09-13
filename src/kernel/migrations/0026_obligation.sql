-- Slice 5.7. Obligation and ObligationType — E9 and E10.
--
-- Foundation rule 8: ObligationType is an admin-managed catalogue, deactivated never deleted,
-- with responsible_party copied onto the obligation at creation so editing the catalogue cannot
-- rewrite history. The snapshot is a column on obligation, not a live join to the type's default.
--
-- The five seed rows are NOT in this file. They are data (src/tenancy/fixtures/obligation-types.ts,
-- applied by `npm run seed:obligation-types`), for the same reason document_type's nine are not in
-- 0011: a sixth type must cost a seed row, not a migration. The settings screen is 5.8.
--
-- No status column. SATISFIED / EXPIRING / EXPIRED / MISSING is derived on read from dates plus
-- whether evidence exists. No amount column, here or ever (foundation rule 2). No DEFAULT now().

CREATE TABLE IF NOT EXISTS obligation_type (
  obligation_type_id uuid PRIMARY KEY,

  -- Stable machine key. Never renamed and never reused — obligations and rules point at this.
  -- Also the seed's natural key, so a second `npm run seed:obligation-types` is a no-op.
  code text NOT NULL UNIQUE,

  label_he text NOT NULL,
  label_en text,

  -- A default for new obligations only. Copied at creation, never pushed onto existing rows.
  default_responsible_party text NOT NULL CHECK (
    default_responsible_party IN ('TENANT', 'OPERATOR')
  ),

  -- Must a document exist before this can read SATISFIED?
  requires_evidence boolean NOT NULL,

  -- Retired types stay as rows and stop appearing in the add list. NEVER delete one.
  is_active boolean NOT NULL
);

CREATE OR REPLACE FUNCTION obligation_type_is_never_deleted() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'obligation_type is deactivated, never deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obligation_type_is_never_deleted ON obligation_type;
CREATE TRIGGER obligation_type_is_never_deleted
  BEFORE DELETE ON obligation_type
  FOR EACH ROW EXECUTE FUNCTION obligation_type_is_never_deleted();

CREATE TABLE IF NOT EXISTS obligation (
  obligation_id uuid PRIMARY KEY,
  tenancy_id uuid NOT NULL REFERENCES tenancy (tenancy_id),
  obligation_type_id uuid NOT NULL REFERENCES obligation_type (obligation_type_id),

  -- Copied from the type when the obligation is created. A later change to the catalogue
  -- must never rewrite this.
  responsible_party text NOT NULL CHECK (
    responsible_party IN ('TENANT', 'OPERATOR')
  ),

  valid_from date,
  valid_to date,
  -- The certificate, bill or guarantee that proves it. Nullable. Kernel DDL may reference
  -- document; the tenancy module still does not import evidence internals.
  evidence_document_id uuid REFERENCES document (document_id),

  CONSTRAINT obligation_period_is_ordered CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from
  )
);

CREATE INDEX IF NOT EXISTS obligation_tenancy
  ON obligation (tenancy_id);
