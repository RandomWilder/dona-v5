-- #208. Every provider that has no party gets one company named after it, then
-- the party is required. A provider created after this file cannot skip the link.
-- Re-running the statements only fills rows that are still missing a party.

WITH created AS (
  INSERT INTO party (party_id, party_kind, legal_name)
  SELECT gen_random_uuid(), 'COMPANY', provider.name
    FROM provider
   WHERE provider.party_id IS NULL
  RETURNING party_id, legal_name
)
UPDATE provider
   SET party_id = created.party_id
  FROM created
 WHERE provider.party_id IS NULL
   AND provider.name = created.legal_name;

ALTER TABLE provider
  ALTER COLUMN party_id SET NOT NULL;
