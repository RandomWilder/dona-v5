-- #277. A building is in the portal only when an administrator has switched it on.
-- False for every building that already exists. The portal reads this column
-- on the request that needs it; it is not copied onto the tenant session.

ALTER TABLE building
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;
