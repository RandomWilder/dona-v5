-- #188. The Outlook delta cursor. One row. A restart reads this link and
-- neither replays a page already handed to the door nor skips one that was
-- not. last_success_at is the health clock: an hour without a successful
-- read is the warning on the קריאות tab. watching_since starts that clock
-- before the first success.

CREATE TABLE email_cursor (
  cursor_id text PRIMARY KEY CHECK (cursor_id = 'outlook'),
  delta_link text,
  last_success_at timestamptz,
  watching_since timestamptz NOT NULL
);
