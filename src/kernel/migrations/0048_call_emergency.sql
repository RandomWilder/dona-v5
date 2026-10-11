-- #185. An emergency flag records who or what set it.
--
-- A flagged call names its setter: the terms, with no staff account, or a
-- staff account. An unflagged call names nobody. The transition for a terms
-- flag has no actor, which is why actor_id may be null — every other kind
-- still names the staff account. The duty-contact rows are the next file.

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS emergency boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_by text,
  ADD COLUMN IF NOT EXISTS emergency_actor uuid REFERENCES staff_account (staff_account_id);

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_emergency_names_who_set_it;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_emergency_names_who_set_it CHECK (
    (
      NOT emergency
      AND emergency_by IS NULL
      AND emergency_actor IS NULL
    )
    OR (
      emergency
      AND emergency_by = 'TERMS'
      AND emergency_actor IS NULL
    )
    OR (
      emergency
      AND emergency_by = 'STAFF'
      AND emergency_actor IS NOT NULL
    )
  );

ALTER TABLE service_call_transition
  ADD COLUMN IF NOT EXISTS setter text;

ALTER TABLE service_call_transition
  ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE service_call_transition
  DROP CONSTRAINT IF EXISTS service_call_transition_kind_check;
ALTER TABLE service_call_transition
  ADD CONSTRAINT service_call_transition_kind_check CHECK (
    kind IN (
      'IDENTIFIED',
      'TRIAGED',
      'ANSWERED',
      'FORWARDED',
      'DUPLICATE',
      'CANCELLED',
      'FLAGGED',
      'CLEARED'
    )
  );

ALTER TABLE service_call_transition
  DROP CONSTRAINT IF EXISTS service_call_transition_setter_known;
ALTER TABLE service_call_transition
  ADD CONSTRAINT service_call_transition_setter_known CHECK (
    (
      kind IN (
        'IDENTIFIED',
        'TRIAGED',
        'ANSWERED',
        'FORWARDED',
        'DUPLICATE',
        'CANCELLED'
      )
      AND actor_id IS NOT NULL
      AND setter IS NULL
    )
    OR (
      kind = 'FLAGGED'
      AND (
        (setter = 'TERMS' AND actor_id IS NULL)
        OR (setter = 'STAFF' AND actor_id IS NOT NULL)
      )
    )
    OR (
      kind = 'CLEARED'
      AND actor_id IS NOT NULL
      AND setter IS NULL
    )
  );
