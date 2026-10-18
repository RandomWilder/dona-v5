-- #255. A draft reply is a turn on the call's thread. kind marks it; rendering
-- is the Hebrew beside a draft that is not already in Hebrew. Existing turns
-- stay unmarked. No backfill.

ALTER TABLE call_turn
  ADD COLUMN kind text,
  ADD COLUMN rendering text;

ALTER TABLE call_turn
  ADD CONSTRAINT call_turn_kind CHECK (kind IS NULL OR kind = 'draft');

ALTER TABLE call_turn
  ADD CONSTRAINT call_turn_rendering CHECK (
    rendering IS NULL OR kind = 'draft'
  );
