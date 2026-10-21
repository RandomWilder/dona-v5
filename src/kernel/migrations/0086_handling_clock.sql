-- #287. Handling thresholds in business days, and the non-working dates
-- the count skips. Placeholders until Dona Dom supplies the thresholds.
-- A later change is a settings write, and this insert does not overwrite one.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('calls.handling_amber_days', '2', now()),
  ('calls.handling_red_days', '5', now()),
  ('calls.non_working_dates', '[]', now())
ON CONFLICT (key) DO NOTHING;
