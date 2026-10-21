-- #281. The portal reads a visit's time when a call is scheduled. Both ends
-- are set, or neither is, and the end is after the start. The visit flow is
-- what writes them. Nothing in this migration does.

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS visit_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_ends_at timestamptz;

ALTER TABLE service_call DROP CONSTRAINT IF EXISTS service_call_visit_is_a_span;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_visit_is_a_span CHECK (
    (visit_starts_at IS NULL AND visit_ends_at IS NULL)
    OR (
      visit_starts_at IS NOT NULL
      AND visit_ends_at IS NOT NULL
      AND visit_ends_at > visit_starts_at
    )
  );
