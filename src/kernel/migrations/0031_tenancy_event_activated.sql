-- #106. Person-driven TenancyEvent kind: a draft becomes live because someone said so.
--
-- 0025 added terminated for the clock. Activation is the other direction and is never a clock:
-- kind = activated, no paper on the event (the documents are already on the letting), actor is
-- the person who invoked the command.

ALTER TABLE tenancy_event DROP CONSTRAINT tenancy_event_kind_check;

ALTER TABLE tenancy_event ADD CONSTRAINT tenancy_event_kind_check
  CHECK (kind IN ('amended', 'terminated', 'activated'));

ALTER TABLE tenancy_event ADD CONSTRAINT activated_has_no_document CHECK (
  kind <> 'activated'
  OR (source_document_id IS NULL AND extracted_field_id IS NULL)
);
