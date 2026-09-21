-- Ticket #129. The extraction default moves from `none` to `medium`.
--
-- 0003 seeded `none` from v3's measured timeout: five sequential calls at the
-- provider's default effort died inside Cloud Run's 300-second limit. That was
-- the right start for reading a table of terms. It is the wrong start for a
-- lease whose deposit is printed as months of rent plus maintenance -- a reader
-- given no room to work cannot check its own answer against the identity beside
-- it, which is the same arithmetic the scorer from #127 asserts.
--
-- A new file rather than an edit of 0003, because migrations are append-only.
-- Only the historical default is rewritten: a row an operator has already
-- moved stays where they put it, which is the whole point of a setting rather
-- than a constant. The live path reads this per call, so walking it back is
-- another row, not a deploy.

UPDATE config_settings
   SET value = '"medium"',
       updated_at = now()
 WHERE key = 'extraction.reasoning_effort'
   AND value = '"none"';
