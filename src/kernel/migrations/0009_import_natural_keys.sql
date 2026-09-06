-- Slice 2.4. The three natural keys the register importer needs in order to be run twice.
--
-- 0005_estate_natural_keys.sql is this file's precedent and its argument: 1.9 shipped the estate
-- spine with nothing unique but its primary keys, 1.11 measured what that cost -- the same fixture
-- applied twice produced 2 buildings, 368 spaces and 144 units -- and the keys landed with the
-- importer that needed them. 2.1 and 2.2 left `party`, `party_contact` and `terms_profile` in the
-- same state, deliberately and on the record, because the key each of them wants is a decision that
-- needs a file in front of it rather than a preference. This is the slice with the file.
--
-- DDL only, no backfill (SPEC.md). Every environment holds zero rows in all three tables today.

-- ------------------------------------------------------------------------------------------------
-- party -- a normalised national_id, and why it is not `UNIQUE (national_id)`.
-- ------------------------------------------------------------------------------------------------
--
-- Three hazards, and a naive unique index walks into all three:
--
--   1. **Leading zeros.** A ת.ז. is nine digits and every spreadsheet export drops the leading ones,
--      so `042938271` and `42938271` are one person. A key that calls them two is a key that
--      disagrees with itself the first time a register arrives -- exactly what `address_key` was
--      built to prevent for addresses, and the same technique answers it: normalise in the database,
--      where every writer gets it, rather than in an importer the next caller has to remember.
--   2. **Two registries.** A ת.ז. and a ח.פ. are issued by different registries and can be the same
--      nine digits, so `party_kind` is part of the key. Without it, importing a company would
--      collide with a person and one of them would silently become the other.
--   3. **Nullable.** We frequently do not have the identifier, and a required one is typed as
--      '000000000' within a week (2.1). A UNIQUE index ignores nulls, so a party with no identifier
--      simply has no natural key -- correct rather than a gap, because the lease flow (A2,
--      SPEC-flows.md) legitimately creates a party from a document that names no ת.ז. The *file
--      format* requires one where the schema does not (SPEC-register.md): no identifier, no
--      idempotence, and a row without one is a reject with its line number.
--
-- A non-numeric identifier -- a passport -- is normalised for case and separators only and never
-- padded, because padding it would be inventing a fact about a registry we are not reading.
--
-- Every function here is IMMUTABLE, which is what GENERATED ... STORED requires: regexp_replace
-- removes the separators a spreadsheet and a person put in, lower flattens the Latin half, lpad
-- restores the zeros the export dropped. 0005 learned the ordering lesson this follows -- normalise
-- *before* the separator is added, never after.
ALTER TABLE party
  ADD COLUMN IF NOT EXISTS national_id_key text  -- pii: a normalised ת.ז. / ח.פ., not an
  -- enforcement column carrying no fact. That is where it differs from building.address_key, and it
  -- is why the marker is here: the same admin-only, access-logged standing national_id itself has
  -- (SPEC.md, Security defaults) applies to anything derived from it.
  GENERATED ALWAYS AS (
    CASE
      WHEN national_id IS NULL THEN NULL
      ELSE party_kind || ':' ||
        CASE
          WHEN regexp_replace(lower(national_id), '[\s\-./]', '', 'g') ~ '^[0-9]{1,9}$'
            THEN lpad(regexp_replace(lower(national_id), '[\s\-./]', '', 'g'), 9, '0')
          ELSE regexp_replace(lower(national_id), '[\s\-./]', '', 'g')
        END
    END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS party_natural_key ON party (national_id_key);

-- ------------------------------------------------------------------------------------------------
-- party_contact -- a conflict target, which is the whole of what this one is.
-- ------------------------------------------------------------------------------------------------
--
-- Less a decision about the domain than one the upsert forces: `ON CONFLICT` needs a unique
-- constraint as its target, and 2.1's `contact_value_resolves_to_one_party` is an EXCLUDE constraint,
-- which cannot be one. Without this key the importer cannot upsert a contact at all -- it can only
-- insert one and catch 23P01, which is a reject where a re-run should be a no-op.
--
-- It sits *inside* the exclusion constraint rather than competing with it: one party, one channel,
-- one value, one start date is a pair the exclusion constraint already rejects, so this adds a
-- target and no new rule. Measured rather than assumed -- against 0008 the duplicate was rejected
-- as 23P01 by the exclusion constraint, and the two now agree on 23505 (tasks/evidence/2.4.md).
--
-- `is_primary` deliberately gets nothing. "At most one primary contact per party per channel" is a
-- plausible rule the workbook does not state, and as a partial unique index it would fail an import
-- that touched two rows in the wrong order, on a rule nobody asked for. 2.1 said to decide it here
-- if the export carried the fact; the register carries one contact per row and does not.
CREATE UNIQUE INDEX IF NOT EXISTS party_contact_natural_key
  ON party_contact (party_id, channel, value, valid_from);

-- ------------------------------------------------------------------------------------------------
-- terms_profile -- identified by its name.
-- ------------------------------------------------------------------------------------------------
--
-- 2.2 landed this table with identity and one column, which is E1 `project`'s move at 1.9: identity
-- now, fields when we know what they must carry. The importer has to look a profile up idempotently
-- and a register names one by its name, so the name is the key -- and against 0008 a second run
-- added a second profile called the same thing on every import.
--
-- **What identifies a profile is not the same question as how many are in force**, which is week 5's
-- and stays open. A lease naming no profile is a reject with its line number rather than a row
-- defaulted to 'standard': `tenancy.terms_profile_id` is NOT NULL precisely so the question reaches
-- the client instead of reaching week 6's responsibility matrix as an assumption.
CREATE UNIQUE INDEX IF NOT EXISTS terms_profile_natural_key ON terms_profile (name);
