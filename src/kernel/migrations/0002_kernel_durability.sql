-- Slice 1.4. The kernel's own tables, and only the kernel's.
--
-- v3's *domain* migrations do not cross over -- they encode the three shapes v5 examined and
-- rejected (docs/from-v3.md Tier 3), and the estate spine is written fresh from the workbook at
-- slice 1.9. What does cross over is the durability substrate the kernel is built on: audit,
-- durable work and settings. Without it seven kernel suites skip locally and fail in CI from 1.6,
-- which sets REQUIRE_POSTGRES=1 -- and a suite that only ever skips is the failure mode SPEC.md's
-- testing section exists to refuse.
--
-- No `DEFAULT now()` anywhere below: every timestamp is written by the caller from the injected
-- clock (SPEC.md, "Time comes from the injected clock"). A column default is a second source of
-- truth no test can see.
--
-- **Slice 5.0-cut removed `idempotency_keys` and `outbox` from this file** rather than dropping
-- them in a later migration. Both were written at 1.4 ahead of a caller and five weeks later still
-- had none: `createEventBus` and `createIdempotency` were imported by nothing but their own tests,
-- and `src/register/internal/importer.ts:9` had already recorded that there is no caller-supplied
-- intent key anywhere in this system. With no real data in any environment a migration is still
-- editable (docs/from-v3.md), and an ALTER undoing a table this repository never used would be the
-- theatre the audit_log comment below refuses. They come back into this file, unchanged, on the day
-- something publishes an event or replays a command.

-- A table, not a log. SPEC.md's "PII never in logs" governs log output; command inputs are stored
-- here deliberately, because this is the system of record for who did what.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('tenant', 'staff', 'agent', 'system')),
  actor_id text,
  -- What permitted the action, as opposed to who took it. Nullable, and no CHECK: tenant, agent
  -- and system actors hold no role, and the kernel does not know any module's role vocabulary
  -- (SPEC-kernel.md). v3 added this in a later migration; here it is inline, because an ALTER
  -- correcting a column this repository never shipped would be theatre.
  actor_role text,
  action text NOT NULL,
  subject_id text,
  inputs jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error')),
  error_code text,
  error_message text
);

CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_subject ON audit_log (subject_id, at DESC);

-- Work outlives the process. `intent_key` is UNIQUE so scheduling twice on the same business
-- intent returns the existing job rather than a duplicate -- the same rule commands follow.
CREATE TABLE IF NOT EXISTS scheduled_work (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  intent_key text UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  done_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS scheduled_work_due ON scheduled_work (run_at) WHERE done_at IS NULL;

-- SPEC.md rule 8 -- a tunable is a row, never a constant. jsonb rather than text so a value keeps
-- its type: 1536 comes back a number, not a string every reader has to parse. The admin screen for
-- these is month two -- slice 5.8; until then a row is changed by hand, which is the honest state
-- rather than a hidden one (SPEC-kernel.md, "Settings").
CREATE TABLE IF NOT EXISTS config_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
