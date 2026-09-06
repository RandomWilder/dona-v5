-- Slice 1.11. The natural keys the estate spine was deliberately left without.
--
-- 1.9 shipped E1-E4 with nothing unique but the primary keys, because the workbook's FIELDS sheet
-- specifies no natural key and 1.9 had no importer in front of it to say what one should be. It has
-- one now, and the defect is measured rather than argued: the same fixture applied twice against
-- 0004 alone produced 2 buildings, 368 spaces and 144 units (tasks/evidence/1.11.md). A natural key
-- is what makes a re-run of an import a no-op instead of a second building.
--
-- DDL only, no backfill (SPEC.md). Every environment holds zero estate rows today, so nothing here
-- can fail on data that already exists -- which is also the reason to land it in week 1 rather than
-- in week 2 with 1,500 units underneath it.

-- The דירה להשכיר tender code. It is the identifier the client already uses for a project, so one
-- code is one project by definition rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS project_code_unique ON project (project_code);

-- An address is what identifies a building to everyone who is not a database, and address text
-- arrives from every export with inconsistent spacing and casing. Normalising it in a generated
-- column rather than in the importer means **every** writer gets it: an application-level normaliser
-- is one that the next caller has to remember to use.
--
-- This column is enforcement and not a fact, exactly as unit's three constant discriminators are.
-- Nothing writes it -- it is GENERATED ALWAYS -- and nothing reads it but the index below;
-- address_line and city remain the facts, and this is derived from them and cannot disagree.
--
-- Every function in the expression is IMMUTABLE, which is what GENERATED ... STORED requires:
-- regexp_replace collapses runs of whitespace, btrim removes the ends, lower flattens the case of
-- the Latin half (Hebrew has none, and this key has to serve both). Each part is normalised
-- *before* the separator is added rather than after: trimming the concatenation leaves the space
-- that followed the '|' in place, which is a key that still differs from the same address typed
-- without it -- the exact failure this column exists to prevent, and it was seen once here.
ALTER TABLE building
  ADD COLUMN IF NOT EXISTS address_key text
  GENERATED ALWAYS AS (
    lower(
      btrim(regexp_replace(city, '\s+', ' ', 'g'))
      || '|'
      || btrim(regexp_replace(address_line, '\s+', ' ', 'g'))
    )
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS building_address_unique ON building (address_key);

-- A space is identified inside its building by what it is and what it is called. The kind is in the
-- key because a parking bay and an apartment may both be called '12', and because a name changing
-- kind is a different space rather than a renamed one.
--
-- `unit` gets no key of its own on purpose. R2 already settled it: Unit.unit_id = Space.space_id, so
-- a unit's natural key *is* its space's, and a second one could only ever disagree with the first.
CREATE UNIQUE INDEX IF NOT EXISTS space_natural_key ON space (building_id, space_kind, name);
