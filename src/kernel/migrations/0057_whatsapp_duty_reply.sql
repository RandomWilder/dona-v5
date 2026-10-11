-- #194. One duty reply per WhatsApp call. The inbound message keeps Meta's
-- id once the send is accepted, so a retry stores the timeline row and does
-- not send a second message. The call records that the reply is stored.

ALTER TABLE message
  ADD COLUMN IF NOT EXISTS duty_reply_id text;

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS duty_reply_at timestamptz;
