-- #182. A ServiceCall is a request that reached the office. The source channel is set
-- once, at intake, and the trigger below is what makes "never changed" a refusal
-- rather than a command we have not written yet.
--
-- Manual entry (PHONE, WALK_IN) is the only writer in this migration's ticket.
-- WHATSAPP and EMAIL are in the check because those channels are the same column,
-- written later by the intake door, not a second table.
--
-- States are SPEC-calls.md's machine. This ticket only inserts NEW.

CREATE TABLE IF NOT EXISTS service_call (
  service_call_id uuid PRIMARY KEY,
  source_channel text NOT NULL CHECK (
    source_channel IN ('WHATSAPP', 'EMAIL', 'PHONE', 'WALK_IN')
  ),
  state text NOT NULL CHECK (
    state IN (
      'NEW',
      'IDENTIFIED',
      'TRIAGED',
      'RESPONSIBILITY_SET',
      'WINDOWS_COLLECTED',
      'OFFERED',
      'SCHEDULED',
      'CLOSED'
    )
  ),
  description text NOT NULL,
  -- pii — the name the office typed, or null when they marked the sender unknown.
  sender_label text,
  sender_unknown boolean NOT NULL,
  opened_at timestamptz NOT NULL,
  opened_by uuid NOT NULL REFERENCES staff_account (staff_account_id),

  CONSTRAINT service_call_description_present CHECK (length(btrim(description)) > 0),
  CONSTRAINT service_call_sender_is_chosen CHECK (
    (sender_unknown AND sender_label IS NULL)
    OR (
      NOT sender_unknown
      AND sender_label IS NOT NULL
      AND length(btrim(sender_label)) > 0
    )
  )
);

CREATE OR REPLACE FUNCTION service_call_reject_channel_change() RETURNS trigger AS $$
BEGIN
  IF NEW.source_channel IS DISTINCT FROM OLD.source_channel THEN
    RAISE EXCEPTION
      'service_call.source_channel is set at intake and cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_call_channel_is_fixed ON service_call;
CREATE TRIGGER service_call_channel_is_fixed
  BEFORE UPDATE ON service_call
  FOR EACH ROW EXECUTE FUNCTION service_call_reject_channel_change();
