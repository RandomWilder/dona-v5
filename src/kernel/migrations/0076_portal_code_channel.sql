-- #274. Which sender delivered the code. Nullable here so the backfill is its
-- own file. A CHECK allows null; 0078 refuses a row with no channel.

ALTER TABLE portal_sign_in_code ADD COLUMN IF NOT EXISTS channel text;

ALTER TABLE portal_sign_in_code DROP CONSTRAINT IF EXISTS portal_sign_in_code_channel;

ALTER TABLE portal_sign_in_code
  ADD CONSTRAINT portal_sign_in_code_channel
  CHECK (channel IN ('whatsapp', 'sms'));
