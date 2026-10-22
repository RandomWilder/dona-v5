-- #274. Every code names the channel that delivered it.

ALTER TABLE portal_sign_in_code ALTER COLUMN channel SET NOT NULL;
