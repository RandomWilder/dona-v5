-- #156. One gate rule may be waived: the handover protocol, for one letting, with a reason.
--
-- The table is otherwise unchanged. The CHECK is the enforcement — lease, start_reached,
-- within_term and unit_free stay refused here, not by the form that records a waiver.

ALTER TABLE tenancy_completeness_exception
  DROP CONSTRAINT tenancy_completeness_exception_rule_check;

ALTER TABLE tenancy_completeness_exception
  ADD CONSTRAINT tenancy_completeness_exception_rule_check
  CHECK (rule IN ('guarantor', 'handover_protocol'));
