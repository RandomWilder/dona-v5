-- #256. A reply sent on an EMAIL call is a timeline row. It names the
-- staff account, the text that went out, and whether that text was the
-- stored draft or an edit of it. A send does not close the call.

ALTER TABLE service_call_transition
  ADD COLUMN IF NOT EXISTS reply_mark text;

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
      'CLEARED',
      'REPLIED'
    )
  );

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
    OR (
      kind = 'REPLIED'
      AND actor_id IS NOT NULL
      AND setter IS NULL
    )
  );

ALTER TABLE service_call_transition
  DROP CONSTRAINT IF EXISTS service_call_transition_reply_mark;
ALTER TABLE service_call_transition
  ADD CONSTRAINT service_call_transition_reply_mark CHECK (
    (
      kind = 'REPLIED'
      AND reply_mark IN ('edited', 'as_written')
      AND note IS NOT NULL
    )
    OR (
      kind <> 'REPLIED'
      AND reply_mark IS NULL
    )
  );
