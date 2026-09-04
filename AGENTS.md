# dona-v5 — Dona Dom tenant service platform

## Commands
- `npm test` · `npm run typecheck` · `npm run lint` · `npm run format` · `npm run db:up && npm run dev`
  → `/health`, which asserts `db:up`. Node 24 runs `.ts` by type stripping; there is no build step.
- **Two required gates:** `npm run test:policy` (everything no model may decide) and `npm run evals`
  (the agent). CI sets `REQUIRE_POSTGRES=1`/`REQUIRE_EMBEDDINGS=1` — a silent skip is a failure.
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
  stated reason in the commit body.** Migrations, clock and UI conventions: `SPEC.md`.

## Boundaries
- `.claude/hooks/` has teeth: destructive shell commands are blocked, and a write under
  `src/<module>/` runs that module's tests and reports the failures back.
- Secrets only through `infra/set-secret.sh`; **real tenant documents never enter this repo**.
- Now: `tasks/todo.md` · Plan: `tasks/plan.md` · Process: `docs/pipeline.md` · `docs/decisions/`

**Status: toolchain live at slice 1.3** — kernel 1.4, CI 1.6, gates 1.7–1.8. `test:policy`/`evals` do not exist yet.
