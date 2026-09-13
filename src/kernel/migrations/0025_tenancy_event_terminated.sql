-- Slice 5.6. Clock-driven TenancyEvent kind: a tenancy ends because a date passed.
--
-- 0019 locked kind to amended and required a source document for that kind, because a promotion
-- that changed a value without naming the paper is the claim this system refuses. terminated has
-- no paper by construction. The column relaxes for that kind only. amended_names_its_document
-- is not dropped.

ALTER TABLE tenancy_event DROP CONSTRAINT tenancy_event_kind_check;

ALTER TABLE tenancy_event ADD CONSTRAINT tenancy_event_kind_check
  CHECK (kind IN ('amended', 'terminated'));

ALTER TABLE tenancy_event ADD CONSTRAINT terminated_has_no_document CHECK (
  kind <> 'terminated'
  OR (source_document_id IS NULL AND extracted_field_id IS NULL)
);
