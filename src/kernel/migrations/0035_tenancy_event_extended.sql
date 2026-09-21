-- #135. Person-driven TenancyEvent kind: a tenant takes the option.
--
-- 0031 added activated with no paper. An option exercise is honestly either a
-- signed notice or a phone call, so this kind names a document when there is
-- one and does not when there is not. amended_names_its_document,
-- terminated_has_no_document and activated_has_no_document stay as they are.

ALTER TABLE tenancy_event DROP CONSTRAINT tenancy_event_kind_check;

ALTER TABLE tenancy_event ADD CONSTRAINT tenancy_event_kind_check
  CHECK (kind IN ('amended', 'terminated', 'activated', 'extended'));
