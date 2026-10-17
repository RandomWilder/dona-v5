-- #250. The Policy library. Sections are rows; the two that exist today are seeded,
-- not inserted here, because a third section has to be a row and not a migration.
--
-- A Policy document is never updated and never deleted. A later version is a new
-- row (#251). The trigger is the rule. The application also offers no edit.
--
-- Passages live here and not in document_passage. That table is tenant paper, and
-- a portfolio search must not return a law as a lease. Each passage carries the
-- section, copied from the document at insert, so a later read does not have to
-- join to know which section the text belongs to.
--
-- No DEFAULT now(). ingested_at comes from the injected clock.
-- No vector index. ADR-0009: sequential scan until a measured row count justifies one.

CREATE TABLE IF NOT EXISTS policy_section (
  policy_section_id uuid PRIMARY KEY,
  section_key text NOT NULL UNIQUE,
  label_he text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_document (
  policy_document_id uuid PRIMARY KEY,
  policy_section_id uuid NOT NULL REFERENCES policy_section (policy_section_id),
  title text NOT NULL,
  effective_from date NOT NULL,
  storage_uri text NOT NULL,
  file_hash text NOT NULL,
  -- The staff account that uploaded it. Not a foreign key: the document cannot
  -- be deleted, and withdrawing the account must not be blocked by it or be
  -- forced to rewrite this row.
  uploaded_by uuid NOT NULL,
  ingested_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS policy_document_section
  ON policy_document (policy_section_id);

CREATE TABLE IF NOT EXISTS policy_passage (
  policy_passage_id uuid PRIMARY KEY,
  policy_document_id uuid NOT NULL REFERENCES policy_document (policy_document_id),
  -- The section, carried on the passage itself.
  policy_section_id uuid NOT NULL REFERENCES policy_section (policy_section_id),
  page integer NOT NULL CHECK (page >= 1),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  -- not-pii: the printed text of a law or a company policy. The library holds
  -- no tenant's data (ADR-0017). A name does not belong in this column.
  body text NOT NULL,
  embedding vector(1536) NOT NULL,
  CONSTRAINT policy_passage_page UNIQUE (policy_document_id, page),
  CONSTRAINT policy_passage_ordinal UNIQUE (policy_document_id, ordinal)
);

CREATE OR REPLACE FUNCTION policy_library_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is never updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_document_is_append_only ON policy_document;
CREATE TRIGGER policy_document_is_append_only
  BEFORE UPDATE OR DELETE ON policy_document
  FOR EACH ROW EXECUTE FUNCTION policy_library_is_append_only();

DROP TRIGGER IF EXISTS policy_passage_is_append_only ON policy_passage;
CREATE TRIGGER policy_passage_is_append_only
  BEFORE UPDATE OR DELETE ON policy_passage
  FOR EACH ROW EXECUTE FUNCTION policy_library_is_append_only();
