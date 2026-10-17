-- #252. The call brief's switch and its model. Rows, so either changes
-- without a deploy. The switch defaults on: a missing row means the same.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('calls.brief', '"on"', now()),
  ('calls.brief.model', '"gpt-5.6-luna"', now())
ON CONFLICT (key) DO NOTHING;
