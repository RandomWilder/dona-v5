# SPEC — Dona Dom tenant service platform (shared conventions)

Living document. Every `SPEC-<module>.md` inherits these conventions and does not repeat them.
Governing documents, in their own hierarchy: [docs/README.md](docs/README.md) — the Data Model is the
authority on what the system is, the Rollout Cadence on schedule. Process: [docs/pipeline.md](docs/pipeline.md).
Decisions: [docs/decisions/](docs/decisions/). Month one's tables: [docs/model/](docs/model/), which is a
specification and not a description.

## Objective

An operations system of record for ~1,500 long-term rental apartments under דירה להשכיר tenders,
with a WhatsApp agent on **both ends** of a service call. Routine calls complete with no human in
them; the office supervises exceptions. North star: share of calls closed with no human involvement.

## Foundation rules

Invariants. Cut features, never these. The first five came from the client and are not designed
around; the rest are what makes them enforceable.

1. **Tenant isolation is absolute.** A tenant receives only information derived from their own
   documents and the global knowledge base — never anything about or for another tenant. Enforced as
   a temporal join in SQL **before any model call**:
   `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`.
   **The scope is a view, never a column.** No `current_tenant` column exists anywhere; a migration
   introducing one fails the build. A model that misbehaves cannot widen a scope it never held.
2. **Money never touches the agent.** No tenant-facing price and no balance — ever, not just v1.
   Financials stay in the Priority ERP behind read-only keys. A question about money is answered by
   refusal and handoff, never by an estimate.
3. **No AI in the responsibility decision or the state machine.** Both are inspectable, versioned and
   defensible in a dispute a year later, and a dispute only ever asks about the past. Every resolved
   call snapshots the `policy_version_id` that decided it; rules supersede by `effective_from` and
   never overwrite. Neither may be tested through the agent — see *Testing*.
4. **Responsibility is ternary** — tenant / operator / **contractor** — because of תקופת הבדק. A
   binary model of it is wrong. With `asset_in_warranty` true the answer is the contractor.
5. **Emergency calls never reach the agent.** An 02:00 burst pipe bypasses triage and reaches the duty
   phone with no model call in between: a policy row plus a routing rule, live before the first real
   message.
6. **A building is a set of Spaces**, one of `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING ·
   STORAGE`. Anything that can break is an **Asset** in exactly one Space; a Unit is the leasable kind
   of Space (`Unit.unit_id = Space.space_id`). **Responsibility falls out of location**, and `UNIT` is
   the only kind that can ever be the tenant's.
7. **A guarantor (ערב) never receives service information.** `is_service_contact` is *forced* false
   when `role = GUARANTOR` — a database constraint, not a form default. No toggle exists.
8. **Capture is open; promotion is governed** ([tasks/plan.md](tasks/plan.md) A8). A document type is a row and a field is a
   row — new ones cost no migration and no deploy, and the value is citable the moment it is
   extracted. An extracted value becoming a *typed column* costs a migration and a reviewed mapping,
   because those columns are what the isolation join, the responsibility matrix and the state machine
   read. Nothing deterministic reads an `ExtractedField` value directly; a contract test asserts it.
   Two instances of the same split are already settled in the workbook and bind the schema:
   **`ObligationType` is an admin-managed catalogue** — deactivated, never deleted, with
   `responsible_party` copied onto the obligation at creation so editing the catalogue cannot rewrite
   history — and **`asset_type` is guarded, not admin-editable**, because the responsibility matrix
   keys on it, so editing it edits policy.
9. **Modular monolith, one deployable.** Modules are bounded contexts exposing commands and events;
   nothing imports another module's internals, only its `contract.ts`. The kernel imports from no
   domain module, and a grep proves it.
10. **The agent is a client, not a brain.** It acts solely through documented module commands, and
    every call is audited. Model, prompt and channel changes never touch business logic.
11. **Specs gate code.** The module spec is updated before the code, in the same change. Contract
    tests, the policy suite and the golden set run in CI and block merges.

## Module map

Follows the workbook's entities, not v3's ([docs/from-v3.md](docs/from-v3.md) Tier 3 says why).

| Module | Entities | Depends on |
|---|---|---|
| `kernel` | — | — |
| `staff` | — | kernel |
| `estate` | E1–E4, E11 — Project · Building · Space · Unit · Asset | kernel |
| `parties` | E5, E6 — Party · PartyContact | kernel |
| `tenancy` | E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType | estate, parties |
| `evidence` | E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField · ExtractedField · FieldPromotion | estate, parties, tenancy |
| `scope` | — the isolation join and nothing else | parties, tenancy, estate |
| `policy` | responsibility matrix · SLA · escalation | estate, tenancy |
| `calls` | ServiceCall · Visit · the state machine | scope, policy |
| `channel` | Conversation · Message · the WhatsApp adapter | scope, calls |

No cycles. `Project` sits above `Building` and is optional (`Building.project_id` nullable).

## Code conventions

`AGENTS.md` carries the commands, the directory map and the standing instructions, and is capped at
30 lines ([docs/pipeline.md](docs/pipeline.md) §3). Everything else it would otherwise repeat lives
here:

- **Migrations are append-only.** DDL and backfill in separate files, never one. PII columns are
  commented `-- pii`. No migration introduces a `current_tenant` column — rule 1, enforced by a grep.
- **Time comes from the injected clock.** No `Date.now()` in logic and no `DEFAULT now()` in SQL: a
  timestamp the tests cannot control is a test that fails on a Tuesday.
- **UI is self-contained HTML plus `/ui/tokens.css`, and nothing else.** No bundler, no framework.
  Hebrew is RTL through logical properties (`margin-inline-start`, never `margin-left`), so one
  stylesheet serves both directions.

## Error shape

One shape everywhere: `{ code, message, details? }`. Codes: `not_found` · `not_allowed` · `conflict`
· `invalid` · `unavailable`. Never return null for an error; never leak internals. The refusal says
`not_allowed` and nothing more — an operator learns what they may do from the board, not by probing.

## Testing

- **`tests/policy/` is the gate for everything no model may decide** — isolation, responsibility, the
  state machine. Required from commit one, before there is an agent. **Every case is proved red
  before it passes**; a case that was green before and after the change it was written for tested
  nothing.
- **A policy case written before its schema is *pending*, never skipped and never `todo`.** The case
  runs the real query; if a relation it needs does not exist yet, it asserts the error is exactly
  Postgres `42P01` on a relation the query *declares* it reads, names that relation in a diagnostic,
  and returns. Any other failure fails the build. The branch disarms itself the moment the last table
  lands, so the case starts asserting for real with no edit and nothing to remember — which a skip and
  a `todo` do not (slice 1.7).
- **`evals/golden/` is the gate for the agent** — trajectory, not final-text matching. `rankAtMost`
  is a ratchet set to what retrieval achieves today, so the gate blocks regression while staying
  green. **No assertion is ever on a distance**: provider embeddings are not bit-identical between
  runs, and a committed distance is a gate that fails for weather. Distances live in `tasks/evidence/`.
- **The golden set's subject and corpus are placeholders, and say so in the file.** There is no agent
  and no ingestion path yet, so `evals/subject.ts` answers from a stub and `evals/corpus.ts` indexes
  nine authored Hebrew passages into a **TEMP** `vector(n)` table — through the real config rows, the
  real embedder and pgvector's own ordering, because a corpus that needed neither a database nor a
  key would make both `REQUIRE_*` switches decorative. What is real from commit one is the *grading*.
  `runCases` takes a `Subject` and a `Retriever`, so the real agent and the real search replace them
  one at a time, and the harness never has to be introduced late (slice 1.8).
- **A skip is a failure wherever a gate runs.** `REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` are
  set on the jobs that must not pass by grading nothing; locally, absent either, the cases that need
  them skip and say so in the count.
- **Never test a deterministic constraint through the agent.** An eval that fails to reach another
  tenant's data proves the model behaved, not that the join is sound.
- Contract tests per module, through public commands only. Race, timeout and restart tests for
  durable work. Clock and ids injected — no sleeps.

## Security defaults

- Fail-closed verification: no personal data before server-side possession proof.
- Isolation enforced at the query layer, in `src/scope/` and nowhere else, proven by tests that
  attempt to cross it.
- `national_id` (ת.ז. / ח.פ.) is **admin-only, unreachable by any agent tool, and access-logged**. It
  never appears in the response shape of an agent tool; the policy suite asserts this.
- **Every scoped read of tenant data is logged**, not only every command.
- PII columns are commented `-- pii`. PII never in logs. Parameterised queries. Validate at the edge.
- Secrets live in Secret Manager and enter through `infra/set-secret.sh` — never in the repo, a log, a
  prompt or an argv (ADR-0003). IAM is bound per secret and per bucket, never at project level.
- **Third parties that see tenant text are named here before they are called**, not discovered later
  (ADR-0004). Personal data reaching a model provider is a decision with a legal basis owed, not a
  side effect.

## The corpus, in three tiers

Only one of them is ours, and it is the one no gate runs against.

1. **Specimen documents** — the published דירה להשכיר standard lease, פרוטוקול מסירה, ערבות בנקאית,
   ארנונה and insurance specimens. State-regulated, real in structure and in Hebrew legalese,
   containing no real person. **Committed to the repo; the substrate every gate runs against.**
2. **Real documents from Dona Dom** — they measure accuracy against scans, handwriting and
   signatures, and they do nothing else. They live in a dated bucket of their own with a lifecycle
   rule, a tested deletion path and a removal date recorded on `tasks/fuses.md` the day they land.
   **Never in this repo.**
3. **Synthetic register rows** — the tenant / unit / phone table, designed for coverage of the cases
   that break things. The data request sent to Dona Dom is *derived from* it rather than dictating it.

No slice ever stalls on someone else's inbox, and no gate is ever green because it was measured
against a document we authored to pass it.

## Status

Kernel live at slice 1.4, on 1.3's toolchain: Node 24 type stripping, Biome, `node --test`, Postgres
16 + pgvector on `docker compose`, and a `/health` skeleton that asserts `db:up`. `src/kernel/` is
lifted from v3 and holds ids, clock, errors, validate, config, db, the migration runner,
idempotency, audit, outbox, durable work, object storage, pdf, embeddings, extraction and the RTL
token layer; `src/app.ts` and `src/serve.ts` are the composition root above it. `src/kernel/
boundary.test.ts` proves the kernel imports from no domain module.

**Migrations live in `src/kernel/migrations/`**, one ordered sequence for the whole system, applied
by `kernel/migrate.ts` under an advisory lock. Four exist: `0001`–`0003` are the kernel's own —
`vector`, the durability tables, their settings seed — and `0004_estate.sql` is the first domain
migration, the E1–E4 spine landed at slice 1.9. `src/estate/` and `src/scope/` are the two module
directories: estate holds its schema contract tests and no code yet, scope the isolation join and its
contract, landed early at 1.7 with no tables underneath it. `party`, `party_contact`, `tenancy` and
`tenancy_party` arrive at 2.1 and 2.2, and until they do the seven policy cases report pending
against `party`. Every other module spec is a stub until its build week
([tasks/roadmap.md](tasks/roadmap.md)), and a stub gaining content is the signal its build started.

**Where the build is: kernel 1.4 · GCP 1.5 · CI and staging 1.6 · the policy suite and both grep
guards 1.7 · the evals harness 1.8 · the estate schema 1.9.** The project is still org-less (fuse F7). Both gates are wired
from week 1 and both are required contexts on `main`: `tests/policy/` runs inside the `gate` job with
the guards, and `evals/` runs in an `evals` job of its own — a job rather than a step because it is
the only thing in this repository that calls a paid third party. This paragraph is the single status
line; `AGENTS.md` points here rather than repeating it.
