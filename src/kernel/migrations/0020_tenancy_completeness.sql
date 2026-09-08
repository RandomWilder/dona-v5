-- Slice 4.8. Completeness exception — A4's recorded exception, not a status on tenancy.
--
-- The rule is *a tenancy must have at least one guarantor*, evaluated over saved rows. A NOT NULL
-- or a CHECK on tenancy_party would refuse the lease that A3's addendum is meant to complete.
-- This table is the other resolution: an operator records that this tenancy is excepted from
-- that rule. Completeness itself stays a query (SPEC-flows.md A4).
--
-- at comes from the injected clock; no DEFAULT now(). actor is a snapshot until week 5 has staff.

CREATE TABLE IF NOT EXISTS tenancy_completeness_exception (
  tenancy_id uuid NOT NULL REFERENCES tenancy (tenancy_id),
  rule text NOT NULL CHECK (rule IN ('guarantor')),
  at timestamptz NOT NULL,
  -- pii -- the operator who recorded the exception, a snapshot until week 5 has staff.
  actor text NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (tenancy_id, rule)
);
