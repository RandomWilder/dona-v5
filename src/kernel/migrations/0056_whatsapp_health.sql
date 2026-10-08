-- #193. The coexistence phone. last_echo_at is the health clock: seven days
-- without an echo from the receptionist's phone is the warning on the
-- קריאות tab, ahead of Meta disconnecting a primary device inactive for
-- about fourteen days. watching_since starts that clock when the adapter
-- is configured, before the first echo.

CREATE TABLE whatsapp_health (
  health_id text PRIMARY KEY CHECK (health_id = 'whatsapp'),
  last_echo_at timestamptz,
  watching_since timestamptz NOT NULL
);
