-- Slice 3.5. The natural key on Asset: one of each type in a space.
--
-- 0012 declares UNIQUE (space_id, asset_type) on CREATE TABLE. CREATE TABLE IF NOT EXISTS
-- will not add that unique to a table that already exists, so the key is also an index
-- here, idempotent, which is what a re-runnable import and a second A6 confirm both need.
CREATE UNIQUE INDEX IF NOT EXISTS asset_one_type_per_space ON asset (space_id, asset_type);
