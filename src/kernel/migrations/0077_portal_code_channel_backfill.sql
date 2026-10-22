-- #274. Rows written before the channel existed went by the dev sender, which
-- speaks WhatsApp.

UPDATE portal_sign_in_code SET channel = 'whatsapp' WHERE channel IS NULL;
