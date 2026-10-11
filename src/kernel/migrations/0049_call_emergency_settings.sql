-- #185. The duty contact and the emergency terms, seeded as placeholders
-- until Dona Dom supplies theirs. A later change is a settings write.
--
-- The terms are phrases, not bare roots. A match is a substring, so גז on
-- its own would flag ארגז, and קצר on its own would flag ordinary words.
--
-- The UPDATE corrects a placeholder that named those bare roots, and only
-- while the row is still that placeholder. An edit at /settings is left alone.

INSERT INTO config_settings (key, value, updated_at) VALUES
  (
    'calls.emergency_terms',
    '"הצפה\nשריפה\nדליפת גז\nתקוע במעלית\nקצר חשמלי"',
    now()
  ),
  ('calls.duty_phone', '"000-000-0000"', now()),
  ('calls.duty_hours', '"טרם נקבעו"', now())
ON CONFLICT (key) DO NOTHING;

UPDATE config_settings
SET
  value = '"הצפה\nשריפה\nדליפת גז\nתקוע במעלית\nקצר חשמלי"',
  updated_at = now()
WHERE key = 'calls.emergency_terms'
  AND value = '"הצפה\nשריפה\nגז\nתקוע במעלית\nקצר"';
