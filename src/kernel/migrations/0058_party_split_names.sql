-- #200. A person's name is a given name and a family name, a company's is a legal name,
-- and full_name is computed from them. This file writes no UPDATE: existing rows are not
-- split by guessing. full_name_before_split keeps the display string those rows already
-- had, and the generated full_name uses it only while the split columns are still null.
-- A later import writes the split columns. It does not parse the old string.
--
-- The CHECK is NOT VALID so the rows already in the table are not scanned. Every new
-- insert and every update is held to it.

-- pii
ALTER TABLE party ADD COLUMN given_name text;

-- pii
ALTER TABLE party ADD COLUMN family_name text;

-- pii
ALTER TABLE party ADD COLUMN legal_name text;

-- pii -- the display string written before the split. Not a name this file parsed.
ALTER TABLE party RENAME COLUMN full_name TO full_name_before_split;

ALTER TABLE party ALTER COLUMN full_name_before_split DROP NOT NULL;

ALTER TABLE party
  -- pii
  ADD COLUMN full_name text NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN legal_name IS NOT NULL THEN legal_name
      WHEN family_name IS NOT NULL AND given_name IS NOT NULL
        THEN given_name || ' ' || family_name
      WHEN family_name IS NOT NULL THEN family_name
      ELSE full_name_before_split
    END
  ) STORED;

ALTER TABLE party ADD CONSTRAINT party_name_matches_kind CHECK (
  (
    party_kind = 'PERSON'
    AND family_name IS NOT NULL
    AND legal_name IS NULL
  )
  OR (
    party_kind = 'COMPANY'
    AND legal_name IS NOT NULL
    AND given_name IS NULL
    AND family_name IS NULL
  )
) NOT VALID;

-- The view followed the rename onto full_name_before_split. Point it back at the
-- generated column. The shape is 0008's; only the binding of full_name changes.
CREATE OR REPLACE VIEW occupancy AS
SELECT
  u.unit_id,
  u.unit_number,
  t.tenancy_id,
  t.start_date,
  t.end_date,
  t.status,
  t.terms_profile_id,
  tp.role,
  tp.is_service_contact,
  p.party_id,
  -- pii
  p.full_name,
  p.preferred_language,
  pc.contact_id,
  pc.channel,
  -- pii
  pc.value AS contact_value,
  pc.valid_from,
  pc.valid_to
FROM unit u
JOIN tenancy t ON t.unit_id = u.unit_id
JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
JOIN party p ON p.party_id = tp.party_id
LEFT JOIN party_contact pc ON pc.party_id = p.party_id;
