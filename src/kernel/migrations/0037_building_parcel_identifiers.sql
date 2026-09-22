-- #143. Typed parcel identifiers on a building.
--
-- A lease recites gush, helka and a building number; a tabu extract or a plan is what
-- establishes them. They are copied onto A11, not extracted, and they are not promotion
-- targets. All three are nullable text. None is unique: two buildings may share a גוש,
-- helka is a list whose order varies by page, and building_number is meaningful inside
-- one project and collapses on a standalone building. Blank on A11 is null. Existing
-- rows stay null until an operator types them.

ALTER TABLE building
  ADD COLUMN IF NOT EXISTS gush text,
  ADD COLUMN IF NOT EXISTS helka text,
  ADD COLUMN IF NOT EXISTS building_number text;
