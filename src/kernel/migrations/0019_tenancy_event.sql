-- Slice 4.3. TenancyEvent — append-only log beside the mutable tenancy row.
--
-- Pulled forward from week 5 because promotion has nowhere else to record old → new, who
-- approved it, and which document caused it. Week 5 still owns Obligation, ObligationType, and
-- clock-driven kinds (terminated with no document). This file: kind = amended only, and that
-- kind always names a source document.
--
-- Deliberately not event sourcing — state is never replayed from this table. The register's
-- upsertTenancy does not write here. at comes from the injected clock; no DEFAULT now().

CREATE TABLE IF NOT EXISTS tenancy_event (
  tenancy_event_id uuid PRIMARY KEY,
  tenancy_id uuid NOT NULL REFERENCES tenancy (tenancy_id),
  at timestamptz NOT NULL,
  -- pii -- the operator who approved the change, a snapshot until week 5 has staff.
  actor text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('amended')),
  field text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  source_document_id uuid REFERENCES document (document_id),
  extracted_field_id uuid REFERENCES extracted_field (extracted_field_id),
  CONSTRAINT amended_names_its_document CHECK (
    kind <> 'amended' OR source_document_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS tenancy_event_tenancy
  ON tenancy_event (tenancy_id);

CREATE OR REPLACE FUNCTION tenancy_event_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'tenancy_event is append-only'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenancy_event_is_append_only ON tenancy_event;
CREATE TRIGGER tenancy_event_is_append_only
  BEFORE UPDATE OR DELETE ON tenancy_event
  FOR EACH ROW EXECUTE FUNCTION tenancy_event_is_append_only();
