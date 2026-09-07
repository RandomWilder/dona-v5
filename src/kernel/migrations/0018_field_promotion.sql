-- Slice 4.3. FieldPromotion and the stamp on ExtractedField — A8's governed half.
--
-- The CHECK on target is the migration cost: a new typed column the isolation join or the
-- responsibility matrix could read cannot be added by seeding a catalogue field. Mapping rows
-- themselves are seed data (they point at document_type_field_id, which exists after
-- seed:doctypes). There is no promotes_to on E15 or E16.
--
-- Stamp columns are nullable until a promotion succeeds. A trigger refuses a stamp written
-- without dona.promoting = on, and refuses DELETE of a stamped row. Direct writes to
-- tenancy.start_date stay legal — the register importer writes those without a document.

CREATE TABLE IF NOT EXISTS field_promotion (
  field_promotion_id uuid PRIMARY KEY,
  document_type_field_id uuid NOT NULL REFERENCES document_type_field (document_type_field_id),
  target text NOT NULL CHECK (
    target IN ('tenancy.start_date', 'tenancy.end_date')
  ),
  CONSTRAINT field_promotion_one_mapping UNIQUE (document_type_field_id)
);

ALTER TABLE extracted_field
  ADD COLUMN IF NOT EXISTS promoted_to text,
  -- pii -- the operator who signed the copy onto a typed column. Snapshot, not a staff FK;
  -- week 5's identity must not be able to rewrite who approved it.
  ADD COLUMN IF NOT EXISTS promoted_by text,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

CREATE OR REPLACE FUNCTION extracted_field_promotion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.promoted_at IS NOT NULL THEN
      RAISE EXCEPTION
        'a promoted extracted_field row may not be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF current_setting('dona.promoting', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.promoted_to IS NOT NULL
         OR NEW.promoted_by IS NOT NULL
         OR NEW.promoted_at IS NOT NULL THEN
        RAISE EXCEPTION
          'extracted_field promotion stamp is set only through promote'
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.promoted_to IS DISTINCT FROM OLD.promoted_to
         OR NEW.promoted_by IS DISTINCT FROM OLD.promoted_by
         OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at THEN
        RAISE EXCEPTION
          'extracted_field promotion stamp is set only through promote'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS extracted_field_promotion_guard ON extracted_field;
CREATE TRIGGER extracted_field_promotion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON extracted_field
  FOR EACH ROW EXECUTE FUNCTION extracted_field_promotion_guard();
