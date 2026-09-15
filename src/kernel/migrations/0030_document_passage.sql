-- #103. One row per page of a filed document: the text as printed, and the
-- embedding the boot-welded model produced from it.
--
-- The reading that produced this text happened once (`readForVerdict`). This
-- table is the store that keeps it. Identifiers stay in `body`; masking is a
-- later read, never a write — a masked body would both hide a tenant's own
-- identifier from them and corrupt the vector.
--
-- **No vector index.** Sequential scan until a measured row count justifies
-- one. That deferral is ADR-0009, not an oversight. btree uniques below are
-- uniqueness, not similarity search.
--
-- Width is compiled in: `embeddingColumnDimensions` in src/kernel/config.ts
-- is 1536, and changing it is this migration plus a re-embed. DDL and
-- backfill never share a file; documents filed before this table exist with
-- no passages until #105.

CREATE TABLE IF NOT EXISTS document_passage (
  document_passage_id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES document (document_id) ON DELETE CASCADE,

  -- 1-based, the number a citation shows a human, matching extracted_field.page.
  page integer NOT NULL CHECK (page >= 1),
  -- 0-based order among this document's passages. One passage per page today,
  -- so ordinal is page - 1; the column exists so a later chunker does not have
  -- to rename page to mean something else.
  ordinal integer NOT NULL CHECK (ordinal >= 0),

  -- pii -- the page as printed, identifiers included. Guard three matches the
  -- qualified name document_passage.body because a bare `body` would fire on
  -- every other body column this schema ever grows.
  body text NOT NULL,

  embedding vector(1536) NOT NULL,

  CONSTRAINT document_passage_page UNIQUE (document_id, page),
  CONSTRAINT document_passage_ordinal UNIQUE (document_id, ordinal)
);
