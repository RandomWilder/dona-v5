-- Slice 5.2. One index, and the reason it is a migration rather than an accepted scan.
--
-- The per-caller upload cap counts audit_log rows for one actor, one action, over a rolling day
-- (src/kernel/audit.ts, countActions). audit_log has had two indexes since 0002_ -- (at DESC) and
-- (subject_id, at DESC) -- and neither answers that question: the first reads the whole window
-- across every actor, and the second is about the row a command touched rather than the operator
-- who ran it.
--
-- Without this the cap turns every upload into a scan whose cost grows with the age of the system,
-- which is the shape of thing that is invisible for six weeks and then is the incident. The count
-- runs before the bytes are read, so it is on the hot path of the one route in this system that is
-- allowed to be slow for a legitimate reason -- and a slow route that is slow for two reasons is a
-- route nobody can measure.
--
-- Column order is (actor_id, action, at DESC): equality on the first two, range on the third.
CREATE INDEX IF NOT EXISTS audit_log_actor_action
  ON audit_log (actor_id, action, at DESC);
