-- Slice 1.4. The settings rows 0002's table exists to hold.
--
-- Its own file because SPEC.md is explicit: migrations are append-only, and DDL and backfill never
-- share one. v3 seeded these inside the DDL migrations that created their columns; separating them
-- is the one place this lift follows v5's convention over v3's habit.
--
-- `now()` here is the single exception to "no DEFAULT now() in SQL". A seed running inside a
-- migration is not a domain write and there is no injected clock at migration time; the ban exists
-- so a *business* timestamp is never written by a source the tests cannot control.

-- The embedding model and the width it is requested at. text-embedding-3-large at 1536 rather than
-- its native 3072: hnsw caps at 2000 dimensions, and the wider vector would force halfvec. The
-- width is schema as well as config -- a vector(n) column compiles it in -- so config.ts asserts
-- this row agrees with the column and refuses to embed when it does not (SPEC-kernel.md, "The
-- dimension is config *and* schema").
INSERT INTO config_settings (key, value, updated_at) VALUES
  ('embedding.model', '"text-embedding-3-large"', now()),
  ('embedding.dimensions', '1536', now())
ON CONFLICT (key) DO NOTHING;

-- The extraction model and how hard it is asked to think. Both seeded at the values v3 arrived at
-- by measurement rather than argument: its first staging press sent five sequential calls at the
-- provider's *default* reasoning effort and none of them finished inside Cloud Run's 300-second
-- request timeout. `none` is the documented latency baseline and the right start for reading a
-- table of terms out of clauses that were already selected deterministically; `low` is the next
-- rung if a field comes back wrong rather than slow.
--
-- Rows rather than constants precisely so that rung costs no deploy. `omit` is a value of ours and
-- not the provider's -- send no reasoning_effort field at all -- for a model that refuses an
-- unknown parameter rather than ignoring it.
INSERT INTO config_settings (key, value, updated_at) VALUES
  ('extraction.model', '"gpt-5.6-luna"', now()),
  ('extraction.reasoning_effort', '"none"', now())
ON CONFLICT (key) DO NOTHING;
