-- #251. A new version ends the old one. SPEC-policy.md.
--
-- The in-force predicate lives in one function so the מדיניות tab and an as-of
-- search call it instead of restating the half-open interval. effective-to is
-- the day the next version starts, and that day is already the next version's.
--
-- The one update on a document is setting effective_to, once, from empty.
-- Passages stay on the append-only trigger from 0069.
--
-- btree_gist, for `=` on uuid and text beside a range, was installed by
-- 0006_parties.sql. '[)' is the same interval the function answers.

ALTER TABLE policy_document
  ADD COLUMN IF NOT EXISTS effective_to date;

ALTER TABLE policy_document DROP CONSTRAINT IF EXISTS policy_document_version_is_ordered;
ALTER TABLE policy_document ADD CONSTRAINT policy_document_version_is_ordered
  CHECK (effective_to IS NULL OR effective_to > effective_from);

CREATE OR REPLACE FUNCTION policy_document_in_force(
  effective_from date,
  effective_to date,
  on_date date
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT effective_from <= on_date
     AND (effective_to IS NULL OR on_date < effective_to);
$$;

CREATE OR REPLACE FUNCTION policy_document_close_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'policy_document is never updated or deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.effective_to IS NOT NULL
     OR NEW.effective_to IS NULL
     OR NEW.effective_to <= OLD.effective_from
     OR NEW.policy_document_id IS DISTINCT FROM OLD.policy_document_id
     OR NEW.policy_section_id IS DISTINCT FROM OLD.policy_section_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.storage_uri IS DISTINCT FROM OLD.storage_uri
     OR NEW.file_hash IS DISTINCT FROM OLD.file_hash
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.ingested_at IS DISTINCT FROM OLD.ingested_at
  THEN
    RAISE EXCEPTION 'policy_document is never updated or deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_document_is_append_only ON policy_document;
CREATE TRIGGER policy_document_is_append_only
  BEFORE UPDATE OR DELETE ON policy_document
  FOR EACH ROW EXECUTE FUNCTION policy_document_close_only();

ALTER TABLE policy_document DROP CONSTRAINT IF EXISTS policy_versions_do_not_overlap;
ALTER TABLE policy_document ADD CONSTRAINT policy_versions_do_not_overlap
  EXCLUDE USING gist (
    policy_section_id WITH =,
    title WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );
