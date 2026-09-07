-- Slice 4.2. ExtractedField: one value read off paper, pointing at the declaration that
-- governed it. A8's open half. FieldPromotion (promoted_to / promoted_by / promoted_at) is 4.3
-- and is not here. There is no schema_version_id: document_type_field_id *is* the version
-- (effective_from on that row). Two names for one fact is a pair that can disagree.
--
-- The workbook FIELDS sheet does not yet list this table; SPEC-evidence.md is the specification.
-- No DEFAULT now() -- extracted_at comes from the injected clock.

CREATE TABLE IF NOT EXISTS extracted_field (
  extracted_field_id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES document (document_id) ON DELETE CASCADE,
  document_type_field_id uuid NOT NULL REFERENCES document_type_field (document_type_field_id),

  -- pii -- names, addresses and other values printed on the form. Guard three matches the
  -- qualified name extracted_field.value because a bare `value` would fire on config_settings.
  value text NOT NULL,

  page integer NOT NULL CHECK (page >= 1),
  -- Top-down page space, the same coordinates pdfjs and the OCR adapter already use.
  bbox jsonb NOT NULL CHECK (
    jsonb_typeof(bbox) = 'object'
    AND bbox ? 'x' AND bbox ? 'y' AND bbox ? 'width' AND bbox ? 'height'
  ),
  confidence real CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  -- The mapping model, not the measuring engine. Geometry never originates here.
  model text NOT NULL,
  extracted_at timestamptz NOT NULL
);

-- Two tenants on one lease are two rows of the same declaration. No unique on
-- (document_id, document_type_field_id).
CREATE INDEX IF NOT EXISTS extracted_field_document
  ON extracted_field (document_id);
