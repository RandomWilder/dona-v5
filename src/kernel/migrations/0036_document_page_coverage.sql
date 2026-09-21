-- #137. How much of a long scan the readers actually opened.
--
-- Slice 6.8 put pagesRead on the audit line for the verdict. Extraction and
-- passages inherited those same pages, so a value on page 20 was a miss for
-- the wrong reason. These columns carry the coverage onto the document row
-- so a screen can say so, and so the remainder reader can stop when the two
-- numbers meet. Null on both is the archive: rows filed before this knew
-- nothing of the count. Code branches on the shortfall (whether to OCR the
-- rest); a view may display the pair and may not treat unread pages as an
-- absence in the paper.

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS pages_read integer;

ALTER TABLE document
  DROP CONSTRAINT IF EXISTS document_page_coverage_check;

ALTER TABLE document
  ADD CONSTRAINT document_page_coverage_check
  CHECK (
    (page_count IS NULL AND pages_read IS NULL)
    OR (
      page_count IS NOT NULL
      AND page_count > 0
      AND pages_read IS NOT NULL
      AND pages_read >= 0
      AND pages_read <= page_count
    )
  );
