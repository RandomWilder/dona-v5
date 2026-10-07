-- #189. The door identifies a sender from the address, with no staff account.
-- The timeline names that match. A person identifying by hand still names
-- their account, and still writes no contact.

ALTER TABLE service_call_transition
  DROP CONSTRAINT IF EXISTS service_call_transition_setter_known;
ALTER TABLE service_call_transition
  ADD CONSTRAINT service_call_transition_setter_known CHECK (
    (
      kind = 'IDENTIFIED'
      AND (
        (actor_id IS NOT NULL AND setter IS NULL)
        OR (setter = 'ADDRESS' AND actor_id IS NULL)
      )
    )
    OR (
      kind IN (
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
