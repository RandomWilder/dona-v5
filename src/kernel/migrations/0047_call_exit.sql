-- #184. An Exit closes a call before a Visit, from any state before SCHEDULED.
-- Each kind requires its reason, and a closed call is never moved.
--
-- The reason lives on the call. A transition row records who closed it; the
-- check below is what makes "no reason, not closed" a refusal rather than a
-- command we have not written yet. Messages on a duplicate move when the
-- intake door exists. A call logged by hand carries none, so the link is the
-- whole of that exit until then.

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS exit_kind text,
  ADD COLUMN IF NOT EXISTS exit_note text,
  ADD COLUMN IF NOT EXISTS exit_department text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES service_call (service_call_id),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES staff_account (staff_account_id);

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_exit_kind_known;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_exit_kind_known CHECK (
    exit_kind IS NULL
    OR exit_kind IN ('ANSWERED', 'FORWARDED', 'DUPLICATE', 'CANCELLED')
  );

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_closed_names_its_exit;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_closed_names_its_exit CHECK (
    (
      state <> 'CLOSED'
      AND exit_kind IS NULL
      AND exit_note IS NULL
      AND exit_department IS NULL
      AND duplicate_of IS NULL
      AND closed_at IS NULL
      AND closed_by IS NULL
    )
    OR (
      state = 'CLOSED'
      AND exit_kind IS NOT NULL
      AND closed_at IS NOT NULL
      AND closed_by IS NOT NULL
      AND (exit_note IS NULL OR length(btrim(exit_note)) > 0)
      AND (exit_department IS NULL OR length(btrim(exit_department)) > 0)
      AND (
        (
          exit_kind IN ('ANSWERED', 'CANCELLED')
          AND exit_note IS NOT NULL
          AND exit_department IS NULL
          AND duplicate_of IS NULL
        )
        OR (
          exit_kind = 'FORWARDED'
          AND exit_note IS NOT NULL
          AND exit_department IS NOT NULL
          AND duplicate_of IS NULL
        )
        OR (
          exit_kind = 'DUPLICATE'
          AND duplicate_of IS NOT NULL
          AND duplicate_of <> service_call_id
          AND exit_department IS NULL
        )
      )
    )
  );

CREATE INDEX IF NOT EXISTS service_call_duplicate_of
  ON service_call (duplicate_of)
  WHERE duplicate_of IS NOT NULL;

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
      'CANCELLED'
    )
  );

ALTER TABLE service_call_transition
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES service_call (service_call_id);

CREATE OR REPLACE FUNCTION service_call_closed_stays_closed()
RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'CLOSED' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'a closed call cannot change state'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'CLOSED'
     AND OLD.state IS DISTINCT FROM 'CLOSED'
     AND OLD.state NOT IN (
       'NEW',
       'IDENTIFIED',
       'TRIAGED',
       'RESPONSIBILITY_SET',
       'WINDOWS_COLLECTED',
       'OFFERED'
     )
  THEN
    RAISE EXCEPTION 'an exit closes a call only from a state before it is scheduled'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_call_closed_stays_closed ON service_call;
CREATE TRIGGER service_call_closed_stays_closed
  BEFORE UPDATE ON service_call
  FOR EACH ROW EXECUTE FUNCTION service_call_closed_stays_closed();
