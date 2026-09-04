-- Slice 1.4. pgvector, ahead of the first vector column.
--
-- Safe rather than a gamble: local and CI both run pgvector/pgvector:pg16, and v3 measured staging
-- on 2026-08-26 and found `vector` 0.8.5 already installed with the runtime user a member of
-- cloudsqlsuperuser (docs/from-v3.md). A migration needing a permission the app lacks fails at boot,
-- which is a deployed revision that will not start -- so the permission is checked before the line
-- is written, not after.
CREATE EXTENSION IF NOT EXISTS vector;
