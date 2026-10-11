-- #187. The sorter's model, read per call. Same standing as extraction.model:
-- a model the account cannot serve is fixed with a row, not a deploy. The
-- prompt version is code, beside the prompt, and is not a row.
--
-- Seeded at the extraction model because that is the one this account is
-- already known to serve. A shorter message does not need a different default
-- until the golden set says it does.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('sorter.model', '"gpt-5.6-luna"', now())
ON CONFLICT (key) DO NOTHING;
