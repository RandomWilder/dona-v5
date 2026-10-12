-- Tenure, and three facts a developer sheet carries. SPEC-estate.md, "Tenure, and what a developer
-- sheet adds to a flat".
--
-- Made on 12 Oct 2026 for the first real building, Ramle 103: its developer sheet marks 13 of 105
-- flats for sale, gives each flat a layout code and a balcony area, each storage room an area, and
-- one bay as a disabled bay.

-- Whether Dona lets the flat. FOR_SALE is still lettable and can be withdrawn; SOLD is terminal.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS tenure text NOT NULL DEFAULT 'FOR_RENT'
  CHECK (tenure IN ('FOR_RENT', 'FOR_SALE', 'SOLD'));

-- The developer's layout code (A, BG, P1). Free text: every developer has their own.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS flat_type text;
ALTER TABLE unit ADD COLUMN IF NOT EXISTS balcony_sqm numeric CHECK (balcony_sqm >= 0);

-- A storage room is its own Space, so its area is the Space's, and only a storage room has one here.
ALTER TABLE space ADD COLUMN IF NOT EXISTS area_sqm numeric;
ALTER TABLE space ADD COLUMN IF NOT EXISTS disabled_bay boolean NOT NULL DEFAULT false;

ALTER TABLE space DROP CONSTRAINT IF EXISTS space_area_only_storage;
ALTER TABLE space ADD CONSTRAINT space_area_only_storage
  CHECK (area_sqm IS NULL OR (space_kind = 'STORAGE' AND area_sqm >= 0));
ALTER TABLE space DROP CONSTRAINT IF EXISTS space_disabled_only_parking;
ALTER TABLE space ADD CONSTRAINT space_disabled_only_parking
  CHECK (NOT disabled_bay OR space_kind = 'PARKING');

-- Sold does not revert, and a let flat cannot be sold. FOR_SALE over an ACTIVE letting is allowed:
-- selling with a tenant in place is ordinary.
CREATE OR REPLACE FUNCTION unit_tenure_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.tenure = 'SOLD' AND NEW.tenure <> 'SOLD' THEN
    RAISE EXCEPTION 'a sold flat stays sold'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tenure = 'SOLD' AND OLD.tenure <> 'SOLD' AND EXISTS (
    SELECT 1 FROM tenancy WHERE unit_id = NEW.unit_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'a flat with an active letting cannot be sold'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS unit_tenure_is_guarded ON unit;
CREATE TRIGGER unit_tenure_is_guarded
  BEFORE UPDATE OF tenure ON unit
  FOR EACH ROW EXECUTE FUNCTION unit_tenure_guard();

-- No DRAFT or ACTIVE letting on a sold flat. ENDED and TERMINATED_EARLY are history from before the
-- sale and stay fileable. Every writer of a tenancy row is refused here without having to remember.
CREATE OR REPLACE FUNCTION tenancy_not_on_sold_flat() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('DRAFT', 'ACTIVE') AND EXISTS (
    SELECT 1 FROM unit WHERE unit_id = NEW.unit_id AND tenure = 'SOLD'
  ) THEN
    RAISE EXCEPTION 'a sold flat takes no letting'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenancy_refuses_sold_flat ON tenancy;
CREATE TRIGGER tenancy_refuses_sold_flat
  BEFORE INSERT OR UPDATE OF status, unit_id ON tenancy
  FOR EACH ROW EXECUTE FUNCTION tenancy_not_on_sold_flat();
