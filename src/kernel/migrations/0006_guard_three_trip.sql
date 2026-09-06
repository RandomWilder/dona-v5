-- DELIBERATE VIOLATION, slice 1.12. Reverted in the next commit.
--
-- Guard three is a required step of `gate`, which is a required context on `main` with
-- enforce_admins true. docs/pipeline.md §6 says a guard is proved by a commit that trips it, so
-- this is that commit: a person-shaped column with no `-- pii` marker, which is exactly the shape
-- 0006_parties.sql will have at slice 2.1 if the marker is forgotten.
CREATE TABLE IF NOT EXISTS guard_three_trip (
  party_id uuid PRIMARY KEY,
  phone text NOT NULL
);
