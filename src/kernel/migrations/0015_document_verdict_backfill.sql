-- Slice 3.6. Backfill verification_verdict, then make the column a fact.
--
-- 0014 added the column nullable so existing filings (3.3, already on staging) are not
-- rejected. This file fills them from the audit line fileDocument already wrote, forces
-- remaining test-helper rows to unguarded (they never went through the door), then refuses
-- a missing or invented verdict from here on.
--
-- The CHECK is here rather than on 0014 because a CHECK on an unfilled column would pass
-- (NULL satisfies CHECK) and look like the constraint was doing work it was not. The
-- constraint arrives with the NOT NULL, after every row has a real value.

UPDATE document AS d
   SET verification_verdict = a.verdict
  FROM (
    SELECT DISTINCT ON ((inputs ->> 'documentId'))
           inputs ->> 'documentId' AS document_id,
           inputs ->> 'verdict' AS verdict
      FROM audit_log
     WHERE action = 'evidence.file_document'
       AND outcome = 'ok'
       AND inputs ->> 'documentId' IS NOT NULL
       AND inputs ->> 'verdict' IN ('verified', 'unverified', 'unguarded')
     ORDER BY inputs ->> 'documentId', at DESC
  ) AS a
 WHERE d.document_id::text = a.document_id
   AND d.verification_verdict IS NULL;

-- Rows that never went through the door (ingestDocument called from a test helper) have no
-- audit line. unguarded is the honest value: nothing checked them.
UPDATE document
   SET verification_verdict = 'unguarded'
 WHERE verification_verdict IS NULL;

ALTER TABLE document
  ADD CONSTRAINT document_verification_verdict_is_filed
  CHECK (verification_verdict IN ('verified', 'unverified', 'unguarded'));

ALTER TABLE document
  ALTER COLUMN verification_verdict SET NOT NULL;
