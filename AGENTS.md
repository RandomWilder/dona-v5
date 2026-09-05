# dona-v5 — Dona Dom tenant service platform

## Commands
- `npm test` · `npm run typecheck` · `npm run lint` · `npm run format` · `npm run db:up && npm run dev`
  → `/health`, which asserts `db:up`. Node 24 type-strips `.ts`; no build step. `npm run migrate`
  applies `src/kernel/migrations/` — a deploy runs it as a Cloud Run job before the revision serves.
- **Two required gates** plus `npm run guards`: `test:policy` (nothing a model may decide) and `evals`
  (the agent; `npm run measure` beside it). CI sets `REQUIRE_*=1` — a silent skip is a failure.
- Merge to `main` → CI green → staging on `workflow_run`, **never on push**; prod on a `v*` tag only.
  `infra/bootstrap.sh <env>` provisions (idempotent, never by hand) · `infra/rollback.sh`.

## Architecture
- Modular monolith, one deployable, `me-west1`. `src/<module>/`: estate · parties · tenancy ·
  evidence · scope · policy · calls · channel · staff. Shared `src/kernel/` imports from no module.
- A module imports another's `contract.ts`, never its `internal/`, and **`src/scope/` is the only
  place the isolation join is written**. A CI grep guard enforces both.
- Read `SPEC.md` first; a module's `SPEC-<module>.md` is updated before its code, in the same change.

## Code style
- TypeScript, erasable syntax only; explicit `.ts` on relative imports; `import type` for types.
- Biome owns formatting — read `biome.json`, don't argue with it. Tests sit beside code (`*.test.ts`).
- **Parameterised queries. Validate every input at the edge. No new runtime dependency without a
  stated reason in the commit body.** Migrations (`src/kernel/migrations/`), clock, UI: `SPEC.md`.

## Boundaries
- `.claude/hooks/` has teeth: destructive shell commands are blocked, and a write under
  `src/<module>/` runs that module's tests and reports the failures back.
- Secrets only through `infra/set-secret.sh`; **real tenant documents never enter this repo**.
- Now: `tasks/todo.md` · Process: `docs/pipeline.md` · `docs/decisions/` · What exists: `SPEC.md` Status
