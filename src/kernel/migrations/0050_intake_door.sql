-- #186. The intake door stores a message once, then a call or a filtered
-- message. PHONE and WALK_IN still name the staff account that logged them.
-- EMAIL and WHATSAPP are opened by the door, which is not a staff account,
-- so opened_by may be null — and only on those two channels.

ALTER TABLE service_call ALTER COLUMN opened_by DROP NOT NULL;

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_manual_names_who_opened;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_manual_names_who_opened CHECK (
    source_channel NOT IN ('PHONE', 'WALK_IN') OR opened_by IS NOT NULL
  );

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS to_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sorter_label text,
  ADD COLUMN IF NOT EXISTS sorter_summary text,
  ADD COLUMN IF NOT EXISTS proposed_category_id uuid REFERENCES call_category (category_id),
  ADD COLUMN IF NOT EXISTS predecessor_id uuid REFERENCES service_call (service_call_id),
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES staff_account (staff_account_id),
  ADD COLUMN IF NOT EXISTS office_label text;

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_sorter_label_known;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_sorter_label_known CHECK (
    sorter_label IS NULL OR sorter_label IN ('call', 'unsure', 'noise')
  );

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_predecessor_is_another;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_predecessor_is_another CHECK (
    predecessor_id IS NULL OR predecessor_id <> service_call_id
  );

-- Returned is not an Exit. The call stays out of the closed figures, and the
-- office's label sits beside the sorter's. Both halves of the mark are
-- present, or neither is.
ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_returned_is_marked;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_returned_is_marked CHECK (
    (
      returned_at IS NULL
      AND returned_by IS NULL
      AND office_label IS NULL
    )
    OR (
      returned_at IS NOT NULL
      AND returned_by IS NOT NULL
      AND office_label = 'returned'
      AND state <> 'CLOSED'
    )
  );

CREATE TABLE IF NOT EXISTS conversation (
  conversation_id uuid PRIMARY KEY,
  source_channel text NOT NULL CHECK (source_channel IN ('WHATSAPP', 'EMAIL')),
  external_thread_id text NOT NULL,
  UNIQUE (source_channel, external_thread_id)
);

CREATE TABLE IF NOT EXISTS message (
  message_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversation (conversation_id),
  source_channel text NOT NULL CHECK (source_channel IN ('WHATSAPP', 'EMAIL')),
  external_message_id text NOT NULL,
  -- pii — the address the message arrived from, before anyone identifies a Party.
  sender_address text NOT NULL,
  received_at timestamptz NOT NULL,
  -- pii — a subject line is tenant text.
  subject text,
  -- pii — the message as it arrived.
  body_original text NOT NULL,
  body_he text,
  is_echo boolean NOT NULL,
  -- pii — a file name can name a person.
  attachments jsonb NOT NULL,
  service_call_id uuid REFERENCES service_call (service_call_id),
  sorter_label text,
  sorter_summary text,
  proposed_category_id uuid REFERENCES call_category (category_id),
  UNIQUE (source_channel, external_message_id),
  CONSTRAINT message_sorter_label_known CHECK (
    sorter_label IS NULL OR sorter_label IN ('call', 'unsure', 'noise')
  )
);

CREATE INDEX IF NOT EXISTS message_conversation
  ON message (conversation_id);

CREATE INDEX IF NOT EXISTS message_call
  ON message (service_call_id)
  WHERE service_call_id IS NOT NULL;

-- The duplicate exit moves the messages in the same write as the close.
-- calls cannot import channel, and a move that commits on its own would
-- survive an exit that then rolled back. The trigger is that one write.
CREATE OR REPLACE FUNCTION message_follows_its_duplicate() RETURNS trigger AS $$
BEGIN
  IF NEW.exit_kind = 'DUPLICATE'
     AND NEW.duplicate_of IS NOT NULL
     AND OLD.exit_kind IS DISTINCT FROM NEW.exit_kind
  THEN
    UPDATE message
       SET service_call_id = NEW.duplicate_of
     WHERE service_call_id = NEW.service_call_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_follows_its_duplicate ON service_call;
CREATE TRIGGER message_follows_its_duplicate
  AFTER UPDATE OF exit_kind ON service_call
  FOR EACH ROW EXECUTE FUNCTION message_follows_its_duplicate();
