-- #288. The reply target, in business days, and whether tenants are shown it.
-- Off until an administrator switches it on. A later change is a settings
-- write, and this insert does not overwrite one.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('calls.reply_target_days', '2', now()),
  ('calls.reply_target_shown', 'false', now())
ON CONFLICT (key) DO NOTHING;
