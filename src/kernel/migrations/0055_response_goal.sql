-- #191. The internal response goal, amber then red, in whole minutes.
-- Placeholders until Dona Dom supplies theirs. A later change is a settings
-- write, and this insert does not overwrite one.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('calls.response_amber_minutes', '240', now()),
  ('calls.response_red_minutes', '1440', now())
ON CONFLICT (key) DO NOTHING;
