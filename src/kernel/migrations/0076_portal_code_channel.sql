-- #274. Which sender delivered the code. The code screen names it, and a resend
-- during the wait keeps it. WhatsApp is the default when both senders are on.

ALTER TABLE portal_sign_in_code ADD COLUMN IF NOT EXISTS channel text;

UPDATE portal_sign_in_code SET channel = 'whatsapp' WHERE channel IS NULL;

ALTER TABLE portal_sign_in_code ALTER COLUMN channel SET NOT NULL;

ALTER TABLE portal_sign_in_code DROP CONSTRAINT IF EXISTS portal_sign_in_code_channel;

ALTER TABLE portal_sign_in_code
  ADD CONSTRAINT portal_sign_in_code_channel
  CHECK (channel IN ('whatsapp', 'sms'));
