-- Slice 7.4. A promotion copies a reading a person signed, or it does not happen.
--
-- **Not 0020.** tasks/todo.md scoped this slice as "Migration 0020", written before 0020 was
-- `0020_tenancy_completeness.sql`; 7.3 made the same correction for 0019 → 0028. The number is the
-- next free one and the todo bullet carries the correction.
--
-- **What was half true until today.** 4.3 governed the *mapping* — which declarations may reach a
-- typed column at all, widened only by a migration that extends 0018's CHECK — and left the *value*
-- ungoverned: an unapproved reading could be copied onto `tenancy.start_date` with an operator's
-- name in `promoted_by`. Those two columns are what `src/scope/`'s isolation join and `src/tenancy/`'s
-- obligation state machine are computed from, and SPEC.md says neither is ever decided by a model.
-- 7.3 built the approval stamp and made the promotion *prefer* it (`COALESCE`); this makes it a
-- requirement, which is the half that matters.
--
-- **A third trigger, not a rewrite of the first two.** 0028 stated the argument when it added the
-- second: each carries its own reason, and a CREATE OR REPLACE of 0018's function would restate
-- 4.3's whole body to add one line to it. All three fire BEFORE each row and all three must pass.
--
-- **Only a row that is *gaining* the stamp.** A row promoted before this migration is not
-- re-examined, and a later UPDATE that touches other columns is not refused because of history that
-- was lawful when it was written. A rule can honestly only be about new promotions.
--
-- No column, no CHECK change, no data change.

CREATE OR REPLACE FUNCTION extracted_field_promotion_needs_approval() RETURNS trigger AS $$
BEGIN
  IF NEW.promoted_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.promoted_at IS NULL)
     AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION
      'a reading that has not been approved may not be promoted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS extracted_field_promotion_needs_approval ON extracted_field;
CREATE TRIGGER extracted_field_promotion_needs_approval
  BEFORE INSERT OR UPDATE ON extracted_field
  FOR EACH ROW EXECUTE FUNCTION extracted_field_promotion_needs_approval();
