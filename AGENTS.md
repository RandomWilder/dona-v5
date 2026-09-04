# dona-v5 — Dona Dom tenant service platform

## Commands
- Test: `npm test` · Typecheck: `npm run typecheck` · Lint: `npm run lint` · Format: `npm run format`
- **Two required gates:** `npm run test:policy` (everything no model may decide) and `npm run evals`
  (the agent). CI sets `REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` — a silent skip is a failure.
  `npm run measure` is the instrument beside the gate, never the gate.
- Dev: `npm run db:up && npm run dev` → `http://127.0.0.1:3000/health`, which asserts `db:up` too.
- Node 24 runs `.ts` directly by type stripping. No build step.
- Deploy: merge to `main` → CI green → staging on `workflow_run`, **never on push**; prod on a `v*`
  tag only. `infra/bootstrap.sh <env>` provisions (idempotent, never by hand) · `infra/rollback.sh`.

## Architecture
- Modular monolith, one deployable, `me-west1`. `src/<module>/`: estate · parties · tenancy ·
  evidence · scope · policy · calls · channel · staff. Shared `src/kernel/` imports from no module.
- A module imports another's `contract.ts` only — never its `internal/`.
- **`src/scope/` is the only place the isolation join is written.** A CI grep guard enforces it.
- Read `SPEC.md` first; before touching a module read `SPEC-<module>.md`, and update that spec in the
  same change as the code, before the code.
- Policies are data rows superseded by `effective_from`, never constants in code.

## Code style
- TypeScript, erasable syntax only; explicit `.ts` on relative imports; `import type` for types.
- Biome: single quotes, semicolons, trailing commas. Tests beside code (`*.test.ts`).
- **Parameterised queries. Validate every input at the edge. No new runtime dependency without a
  stated reason in the commit body.**
- Time comes from the injected clock — no `Date.now()` in logic, no `DEFAULT now()` in SQL.
- Migrations append-only, DDL and backfill in separate files, PII columns commented `-- pii`.
- UI: self-contained HTML + `/ui/tokens.css` only; Hebrew RTL with logical properties; no bundler.

## Boundaries
- Plan mode before: the kernel, a migration, auth, the policy layer, or two or more modules.
- Secrets enter only through `infra/set-secret.sh` — never in code, a log, a prompt or an argv.
- **Real tenant documents never enter this repo.** Development runs on tier-1 specimens (`SPEC.md`).
- Now: `tasks/todo.md` · Plan: `tasks/plan.md` · Process: `docs/pipeline.md` · `docs/decisions/`

**Status: scaffolded at slice 1.1.** Toolchain lands in 1.3, kernel 1.4, CI 1.6 — a command above may
not exist yet.
