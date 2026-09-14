-- Slice 7.3. The approval stamp — the verb 4.3 did not have.
--
-- A promotion says *this value is now business truth on a typed column*: it needs a mapping row, it
-- moves another module's row, and it reaches two targets. An approval says something smaller and
-- more useful — *a person looked at what the reader produced and it is correct* — and every captured
-- row can carry one, including the four lease fields that have nowhere to be promoted to.
--
-- **`value` is never overwritten, and that is the point of the slice.** What the reader produced and
-- what a person affirmed are two columns; the difference between them is the per-field accuracy
-- dataset this track exists to produce, and one column would destroy it on the first correction.
-- SPEC-evidence.md, "Approval — the stamp that is not a promotion", is the specification.
--
-- No DEFAULT now() -- approved_at comes from the injected clock, as every date here does.

ALTER TABLE extracted_field
  -- pii -- the value a person affirmed. It is a name, an address or a ת.ז., exactly as `value` is.
  ADD COLUMN IF NOT EXISTS approved_value text,
  -- pii -- the operator who signed the reading. Snapshot, not a staff FK, exactly as `promoted_by`:
  -- what it records is who signed at that moment, not a row that can later be disabled.
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- A half-written stamp is not a state this table has. `approved_value` is written even when the
-- reader was right -- equal to `value` -- so a stamped row says what was affirmed without a join,
-- and the delta query is `approved_value <> value` rather than a null-aware expression nobody reads
-- correctly at a glance.
ALTER TABLE extracted_field
  DROP CONSTRAINT IF EXISTS extracted_field_approval_complete;
ALTER TABLE extracted_field
  ADD CONSTRAINT extracted_field_approval_complete CHECK (
    num_nonnulls(approved_value, approved_by, approved_at) IN (0, 3)
  );

-- A second trigger beside 0018's, not a rewrite of it. Two BEFORE row triggers both fire; keeping
-- them apart means the promotion guard's argument stays where 4.3 wrote it and this one carries its
-- own.
CREATE OR REPLACE FUNCTION extracted_field_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION
        'an approved extracted_field row may not be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF current_setting('dona.approving', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.approved_value IS NOT NULL
         OR NEW.approved_by IS NOT NULL
         OR NEW.approved_at IS NOT NULL THEN
        RAISE EXCEPTION
          'extracted_field approval stamp is set only through approve'
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.approved_value IS DISTINCT FROM OLD.approved_value
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
        RAISE EXCEPTION
          'extracted_field approval stamp is set only through approve'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS extracted_field_approval_guard ON extracted_field;
CREATE TRIGGER extracted_field_approval_guard
  BEFORE INSERT OR UPDATE OR DELETE ON extracted_field
  FOR EACH ROW EXECUTE FUNCTION extracted_field_approval_guard();
