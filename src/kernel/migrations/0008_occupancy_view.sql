-- Slice 2.3. `occupancy` -- R6's view, and the one place the five hops are named.
--
-- Foundation rule 1 says who lives in a unit is resolved, never stored. R6 in the workbook says the
-- same thing in the modelling vocabulary: occupancy is a VIEW and never a column, computed on every
-- load from `today` and the tenancy dates. Guard one enforces the second half of that sentence over
-- every file in this directory, and it is absolute -- so the forbidden column name is not written
-- here even in prose, which slice 2.2 learned by tripping it.
--
-- **This view carries no temporal predicate, no status filter and no CURRENT_DATE, and that is the
-- design rather than an omission.** The view is the shape; src/scope/internal/isolation-join.ts is
-- the rule. Three things force the split and each is sufficient on its own:
--
--   1. A view cannot take a parameter. The only way to put `today` inside one is CURRENT_DATE, which
--      breaks SPEC.md's clock rule: a temporal predicate the tests cannot control is a test that
--      fails on a Tuesday.
--   2. Guard two scans this directory. src/kernel/migrations/ is not src/scope/, so a view holding
--      the tenancy-active predicate fails the build. The alternative was to add this directory to
--      the guard's exclusion list, and scripts/guards.ts says why not: an exclusion list that grows
--      is how a guard dies.
--   3. It is the truer line. What the guard protects is not the join's text but the decision about
--      *when* a contact or a tenancy counts, and that decision now has exactly one home. A question
--      that is not about today -- the unit screen's tenancy history, Panel 6 -- reads this same view
--      rather than needing a second one.
--
-- Nothing else may read this view directly: applying the day means writing the predicate, which puts
-- it in a second file and fails guard two. Callers ask src/scope/ instead, which is the guard
-- working rather than an inconvenience (SPEC-scope.md).
--
-- **national_id is deliberately not a column here.** SPEC.md's security defaults make it admin-only
-- and unreachable by any agent tool, and this view is the surface an agent's scope is built from.
-- Its absence is asserted in src/scope/scope.test.ts against information_schema rather than left to
-- intention.

CREATE OR REPLACE VIEW occupancy AS
SELECT
  u.unit_id,
  u.unit_number,
  t.tenancy_id,
  -- **The dated columns keep their base names, and that is load-bearing.** Guard two's patterns are
  -- written against `start_date`/`end_date` and `valid_from`/`valid_to`, so a view that renames them
  -- to `tenancy_start` and `contact_valid_to` leaves the join's own text matching nothing -- and the
  -- next module to copy it escapes the guard entirely. This was written with the aliases first and
  -- caught by tests/policy/guards.test.ts, which builds its violating fixture out of the real join,
  -- so the canonical copy failing to trip the guard is a red test rather than a discovery in week 9.
  -- Tenancy and party_contact name disjoint columns, so verbatim costs nothing.
  t.start_date,
  t.end_date,
  t.status,
  t.terms_profile_id,
  -- Q1 shows a guarantor and marks them unreachable; Q2 must not resolve one at all. Both read this
  -- column, from opposite sides, and the constraint that forces it false for a guarantor is 0007's.
  tp.role,
  tp.is_service_contact,
  p.party_id,
  -- pii -- marked at its source in 0006_parties.sql and marked again here, because the column a
  -- reader meets is the one on the view. Guard three is not extended to view aliases on purpose: a
  -- view stores nothing, so there is no new place for personal data to accumulate, and a guard with
  -- a false positive is one people learn to work around.
  p.full_name,
  p.preferred_language,
  pc.contact_id,
  pc.channel,
  -- pii -- a real person's phone number or email address.
  pc.value AS contact_value,
  pc.valid_from,
  pc.valid_to
FROM unit u
JOIN tenancy t ON t.unit_id = u.unit_id
JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
JOIN party p ON p.party_id = tp.party_id
-- LEFT, because Q1 is "who lives in unit 12" and a tenant whose number we do not have still lives
-- there. An inner join would drop them from the unit screen entirely, which is a filing failure
-- disguised as an empty panel. Q2 supplies `channel` and a value, so the null rows fall away on
-- their own and the isolation join is unaffected.
LEFT JOIN party_contact pc ON pc.party_id = p.party_id;
