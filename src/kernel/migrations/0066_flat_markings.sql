-- Four more facts a developer sheet carries. SPEC-estate.md, "Four more facts a developer sheet
-- carries".
--
-- Made on 13 Oct 2026 for Beit Shemesh (BSM-MSK): its sheet marks 9 garden flats with their garden
-- areas, 6 sukkah balconies, 12 storage rooms attached to a flat with no number, and 18 numbered
-- storage rooms above the parking. The 12 Oct seed had nowhere to put any of them.

-- A garden flat and its garden area. A garden is not a balcony; null is not a garden flat.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS garden_sqm numeric CHECK (garden_sqm >= 0);

-- A balcony open to the sky that a sukkah may stand on.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS sukkah_balcony boolean NOT NULL DEFAULT false;

-- A storage room that belongs to the flat and has no number, reached from its garden or balcony. A
-- fact on the flat, not a STORAGE Space: it cannot be assigned or let apart from the flat.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS attached_storage text
  CHECK (attached_storage IN ('GARDEN', 'BALCONY'));

-- A numbered storage room built above the parking. Its number is its own and names no bay.
ALTER TABLE space ADD COLUMN IF NOT EXISTS over_parking boolean NOT NULL DEFAULT false;
ALTER TABLE space DROP CONSTRAINT IF EXISTS space_over_parking_only_storage;
ALTER TABLE space ADD CONSTRAINT space_over_parking_only_storage
  CHECK (NOT over_parking OR space_kind = 'STORAGE');
