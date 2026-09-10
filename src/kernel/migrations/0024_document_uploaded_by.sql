-- Slice 5.4. Who filed this document, now that an authenticated actor exists.
--
-- Held from 3.1 because a provenance column holding a placeholder for six weeks is worse than one
-- that arrives with the identity it names. Nullable: rows ingested before this slice, and callers
-- with no session (seed, importer), have no operator to name. No backfill. Not -- pii: it is a
-- staff id, like the other foreign keys to staff_account.
--
-- A re-ingest of the same hash keeps the first uploader (COALESCE in ingestDocument). file_hash and
-- storage_uri stay the only columns the immutability trigger freezes.

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES staff_account (staff_account_id);
