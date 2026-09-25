-- #154. Person-driven TenancyEvent kind: a letting ends before its contractual end.
--
-- terminated stays the clock's kind and still forbids a document. An early end
-- is honestly either a signed notice or a phone call, the same shape extended
-- already has, so this kind names a document when there is one and does not
-- when there is not. terminated_has_no_document is not relaxed.

ALTER TABLE tenancy_event DROP CONSTRAINT tenancy_event_kind_check;

ALTER TABLE tenancy_event ADD CONSTRAINT tenancy_event_kind_check
  CHECK (kind IN (
    'amended', 'terminated', 'activated', 'extended', 'reassigned', 'ended_early'
  ));
