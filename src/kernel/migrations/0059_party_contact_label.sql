-- #206. A short name for who answers a number, such as "יוסי – סדרן".
-- Nullable: most contacts are the party themselves and need no label.
-- Not a person and not a party. A contact person with their own record is still open.

-- pii
ALTER TABLE party_contact ADD COLUMN label text;
