# Roadmap — sixteen weeks

> The schedule is [rollout-cadence.html](../docs/rollout-cadence.html)'s and is never renegotiated
> here; this file decomposes it. The process each slice runs through is
> [pipeline.md](../docs/pipeline.md) §8. Decisions, risks and open questions are in
> [plan.md](plan.md).
>
> **Weeks 1–4 are at slice level with acceptance criteria. Weeks 5–16 are at week level** — each
> monthly gate hands the next month its detail, which is what M1–M4 are for.
>
> Every slice: one focused session, half a day or less. **Done when** is the acceptance bar;
> **Verify** is the command or check that proves it — no self-certification. Sizes are S / M / L.
> Week 1 carries more slices than any later week because roughly half of it is a **verbatim lift**
> from v3 with no design decisions in it.

---

## The calendar

**Week 1 starts Sunday 6 September 2026.** The working week is **Sun–Thu**; holidays are worked
through and are not modelled in the schedule. Four build days (Sun–Wed), which is what sizes a week
at six or seven slices.

| W | Sun–Thu | | W | Sun–Thu | | W | Sun–Thu | | W | Sun–Thu |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6–10 Sep | | 5 | 4–8 Oct | | 9 | 1–5 Nov | | 13 | 29 Nov – 3 Dec |
| 2 | 13–17 Sep | | 6 | 11–15 Oct | | 10 | 8–12 Nov | | 14 | 6–10 Dec |
| 3 | 20–24 Sep | | 7 | 18–22 Oct | | 11 | 15–19 Nov | | 15 | 13–17 Dec |
| **4** | 27 Sep – **1 Oct · M1** | | **8** | 25–29 Oct · **M2** | | **12** | 22–26 Nov · **M3** | | **16** | 20–24 Dec · **M4** |

## Standing, every week

- **Sunday** — rewrite [todo.md](todo.md) for the week with the declared demo kind at the top, and
  pick up the asks from Thursday's demo.
- **Wednesday** — freeze. The last merge that reaches staging lands Wednesday.
- **Thursday** — demo off staging, same URL as last week. Three slides, one of them asks. Thursday is
  the last working day, so the asks it generates are picked up on Sunday — a known three-day gap,
  accepted so the demo day stays where all four published documents say it is.
- **Once a week** — walk [fuses.md](fuses.md). Anything unlit or overdue goes on the asks slide.

**Prod tagging starts at week 12.** Before the pilot is live, staging *is* the delivered artifact.
The one exception is deliberate and happens in week 1, while nothing depends on it.

---

# MONTH ONE · The record exists, and you can trust it → **M1**

## Week 1 · Sun 6 – Thu 10 Sep — A URL, a schema, and a filed application

**Demo kind:** Software · **You show:** a live link stakeholders open on their own phones, showing
Shoham's building and its units, plus the timestamped Meta verification submission.

**Also this week:** put the three success numbers ([plan.md](plan.md)) to the client for agreement,
and take delivery of the real document corpus — **behind the controls in 1.12, which are built
first** (**R4**).

> **Before any slice: light every fuse in [fuses.md](fuses.md).** They burn while the scaffolding
> gets built; nothing below is on their critical path. Meta was lit 2026-08-21 under the correct
> entity — the row records the confirmed status, not a fresh filing.

### Slice 1.1 — Repo, branch protection, context layer
Create the repository and the files agents read before anything else exists to read them.
`AGENTS.md` (20–30 lines: commands, style, directory map, and the standing instructions —
parameterised queries, validate at the edge, no new dependency without a reason), `CLAUDE.md` as a
pointer to it, `SPEC.md` with the foundation rules, empty `SPEC-<module>.md` per A3, and
`docs/decisions/` re-adopting v3's ADR-0001–0004 by reference rather than re-argument.
- **Done when:** a clean clone gives an agent `AGENTS.md` and `SPEC.md`, and a PR to `main` cannot
  merge without the required checks.
- **Verify:** `gh api repos/:owner/:repo/branches/main/protection` lists the checks; a throwaway PR
  reports `mergeStateStatus: BLOCKED`.
- **Deps:** none · **Size:** M

### Slice 1.2 — Guardrails with teeth
Lift `.claude/hooks/guard-bash.mjs` and `after-write.mjs` from v3; wire `SessionStart` to print
branch and failing tests; write the permissions allowlist so tests, lint and `git status` never
prompt while deploys and destructive commands always do.
- **Done when:** `rm -rf /`, a force push, raw `psql` against prod and `DROP DATABASE` are each
  blocked with exit 2; a write under `src/<module>/` runs that module's tests.
- **Verify:** attempt each of the four; paste the block into the evidence file.
- **Deps:** 1.1 · **Size:** S

### Slice 1.3 — Toolchain and a walking skeleton
Node 24 with type stripping, `tsconfig.json`, `biome.json`, `node --test`, `docker-compose` Postgres
16 + pgvector, `npm run dev` serving a health page, one passing test.
- **Done when:** a clean clone reaches a running server in under five minutes; `/health` returns
  `ok:true` **and** `db:up`.
- **Verify:** time it from `git clone` on a second checkout; record the number.
- **Owed by 1.2:** `npm test` includes `.claude/hooks/hooks.test.mjs` — 34 cases that nothing
  currently runs — and `after-write.mjs` gains the Biome format-and-lint step
  ([pipeline.md](../docs/pipeline.md) §4), which it could not have before Biome existed.
- **Deps:** 1.1 · **Size:** M

### Slice 1.4 — Kernel lift (Tier 1, verbatim)
Copy `src/kernel/` whole and rename nothing: `clock` · `ids` · `errors` · `config` · `db` ·
`migrate` (the runner; **not** v3's migrations) · `idempotency` · `events` · `work` · `objects` ·
`pdf` · `embeddings` · `validate` · `pg-support` · `audit` · `ui/tokens.css` + Heebo subsets. Sized
by decisions, not files: there are none. The Hebrew RTL token layer is real work not to be redone.
- **Done when:** the kernel's own tests pass in v5, and the kernel imports nothing from any domain
  module.
- **Verify:** `npm test`; a grep over `src/kernel/**` finds no import from a sibling module.
- **Owed by 1.3 — four hand-written stand-ins for the kernel to take back.** 1.3 kept `src/` free of
  modules so this lift lands in clean space. (a) `src/app.ts`'s inline `{ code, message }` 503 body
  becomes `kernel/errors.ts`'s `KernelError` / `httpStatus` / `toErrorBody`, with the
  `setNotFoundHandler` / `setErrorHandler` 1.3 deliberately did not write twice. (b)
  `src/app.test.ts`'s four-line `REQUIRE_POSTGRES` check becomes `kernel/pg-support.ts`'s
  `migratedPoolOrNull()`. (c) **`src/db.ts` is deleted here and its `pool.on('error')` handler must
  survive** — v3's `kernel/db.ts` has none, and a clean verbatim lift silently reintroduces a bug
  that kills the process on any database restart ([from-v3.md](../docs/from-v3.md) records it;
  `src/db.test.ts` is the case that catches it). (d) `docker-compose.yml` stays on **port 5434**
  so `kernel/pg-support.ts`'s default connection string needs no edit — do not renumber it.
- **Deps:** 1.3 · **Size:** M

### Slice 1.5 — `infra/bootstrap.sh` against the new project
Run it with `PROJECT` and `GITHUB_REPO` changed and **`REGION` left at `me-west1`**. Provisions APIs,
Artifact Registry, Cloud SQL with `--edition=ENTERPRISE`, the database user with its password written
straight into Secret Manager, both service accounts, per-secret IAM, the docs bucket created closed
and re-closed on every run, and Workload Identity Federation with the `assertion.repository`
condition. The project is created **under an organisation** (R8).
- **Done when:** a second run is a no-op, no long-lived service-account key exists anywhere, and the
  staging runtime cannot read prod's connection URL.
- **Verify:** re-run and diff; `gcloud iam service-accounts keys list` is empty of user-managed keys;
  attempt the cross-environment secret read and get denied.
- **Deps:** 1.1 · **Size:** M

### Slice 1.6 — CI, staging, release
`ci.yml` (typecheck · lint · tests against a real Postgres service container · evals as a separate
job), `deploy.yml` firing on `workflow_run` after CI succeeds — **never on push** — and `release.yml`
on a `v*` tag only, re-running the full gate against the tagged commit and refusing a tag that is not
an ancestor of `main`.
- **Done when:** a red commit cannot reach staging even by a direct push to `main`.
- **Verify:** push a red commit directly to `main`; staging does not move.
- **Owed by 1.1:** branch protection requires the check contexts **`gate`** and **`evals`** by those
  exact names. A job named anything else leaves every PR blocked forever with no check reporting —
  name the jobs to match or change protection in the same commit, and prove it with a PR that goes
  green rather than by reading the YAML.
- **Owed by 1.3:** the `gate` job is three steps — `npm run typecheck`, `npm run lint`, `npm test` —
  and `npm test` is `test:code && test:hooks`. The hooks half is the only thing that runs
  `.claude/hooks/hooks.test.mjs`, so a `gate` that shortcuts to `test:code` silently drops 41 cases.
  Set `REQUIRE_POSTGRES=1` against a real Postgres service container, or `src/app.test.ts` and
  `src/db.test.ts` skip green with no database. `infra/smoke.sh` asserts `/health` returns `ok:true`
  **and** `db:up` — the endpoint 1.3 built for it, proved degrading to 503 and recovering.
- **Owed by 1.1, closing here rather than at 1.10:** `enforce_admins: true` on `main`, as the last
  act of the slice. It was `false` only so this Verify could push red to `main`; once that is done
  the reason is spent, and every slice after this one merges inside a gate that is real.
- **Deps:** 1.3, 1.5 · **Size:** M

### Slice 1.7 — The policy suite, red before the schema exists
`tests/policy/` as a required check from commit one. Write **case 1** (the five-hop isolation join,
both temporal predicates asserted) and **case 2** (a recycled phone number resolves to nobody) now,
against tables that do not exist yet. Wire **both grep guards**: no migration may introduce a
`current_tenant` column; only `src/scope/` may construct the join's temporal predicate.
- **Done when:** both cases fail for the right reason, and each guard trips on a deliberate
  violation.
- **Verify:** two commits that each trip one guard, both blocked, both reverted; the red output of
  the two cases in the evidence file.
- **Owed by 1.3:** `npm run test:code` already names a `tests/**/*.test.ts` glob, and a glob that
  matches nothing is silent. Confirm by **case count** that the policy suite is collected — a suite
  the runner never found is indistinguishable from one that passed.
- **Deps:** 1.6 · **Size:** M

### Slice 1.8 — The evals harness, from commit one
Lift `evals/runner.ts` · `case.ts` · `subject.ts` · `measure.ts` and the three case kinds. Three
trivial cases, one per kind, so the gate is never introduced late. `REQUIRE_POSTGRES=1` and
`REQUIRE_EMBEDDINGS=1` on the evals job.
- **Done when:** `npm run evals` gates merges, and a missing database **fails** the job instead of
  skipping it green.
- **Verify:** unset the database URL in CI once and watch the job go red.
- **Owed by 1.3:** the `evals/**/*.test.ts` glob in `test:code` needs the same confirmation by count
  as 1.7's. `REQUIRE_POSTGRES=1` is honoured by `src/app.test.ts` and `src/db.test.ts` already; the
  evals job adds `REQUIRE_EMBEDDINGS=1`.
- **Deps:** 1.6 · **Size:** M

### Slice 1.9 — Estate schema: Project · Building · Space · Unit
The new spine, from the workbook's FIELDS sheet — E1–E4, 32 columns. `Building.project_id` nullable
with `project_code` on Project; `Space.space_kind` as the six-value enum; `Unit.unit_id =
Space.space_id` as a shared key, not a foreign key to a surrogate. Natural keys do the work:
`address_key` for a building.
- **Done when:** an apartment is a Space with a Unit extension and a lobby is a Space with none, both
  enforced by the schema rather than by convention.
- **Verify:** contract tests for R1, R2 and R15; an insert of a Unit with no Space is rejected.
- **Deps:** 1.4, 1.7 · **Size:** M

### Slice 1.10 — Prove the pipeline in both directions, on purpose
Break a test → PR blocked. Fix → merge → staging live. Tag `v0.1.0` → prod. **Roll prod back** with
`infra/rollback.sh`, then confirm the next deploy still takes traffic. The one week this is free is
the week nothing depends on it.
- **Done when:** the round trip is complete and the post-rollback deploy serves 100%, not 0%.
- **Verify:** revision list with traffic percentages at each step, times recorded.
- **Confirms 1.6's flip:** this is the first slice that runs entirely inside the enforced gate, so
  its break→blocked leg doubles as the proof that `enforce_admins: true` took. Still `false` here
  means 1.6 did not finish.
- **Deps:** 1.6 · **Size:** S

### Slice 1.11 — The Shoham fixture and the week-1 surface
A fixture we designed for coverage — Shoham's building, its spaces and its 72 units — seeded through
the importer path rather than by hand, and a buildings/units list screen on the RTL token layer.
- **Done when:** a stakeholder opens the staging URL on their own phone and sees the building and its
  units.
- **Verify:** the owner browses it in a browser, not a screenshot.
- **Deps:** 1.9 · **Size:** M

### Slice 1.12 — The corpus, both tiers, and the controls the second one needs
**Built before the real documents land, not after** (**R4**). Two jobs in one slice because they are
the same decision.
*Tier 1, committed to the repo:* the published specimen corpus — the **דירה להשכיר standard lease**,
the standard פרוטוקול מסירה, ערבות בנקאית forms, ארנונה and insurance certificate specimens. Real
structure, real Hebrew legalese, no real person. This is what functionality is built and gated
against.
*Tier 2, controls first:* the real corpus from Dona Dom in a **dated bucket of its own** — lifecycle
rule, a tested deletion path, `-- pii` column comments as a `SPEC.md` convention, access logging on
every scoped read, and a removal date recorded the day it arrives. Its own bucket so the F5
organisation move stays an admin task rather than a data-custody event (**R8**).
- **Done when:** the specimen corpus is in the repo and a named real document can be permanently
  removed by a documented command that has actually been run.
- **Verify:** run the deletion path against a throwaway object and confirm it is gone from the bucket
  and from the row; the removal date is written into [fuses.md](fuses.md).
- **Owed by 1.2:** the bash guard covers the **Bash tool only** — Write, Edit and every MCP tool
  reach the filesystem without passing it. Nothing in this slice may lean on it; `.gitignore`, bucket
  IAM and the policy suite are what hold.
- **Owed by 1.1:** close **F6** in [fuses.md](fuses.md). Tier 2 is the first real personal data in
  the system, and ADR-0004 owes its legal basis and its named third parties *before* it lands.
- **Deps:** 1.5 · **Size:** S

> **Week-1 cut line.** If the week runs hot, cut in this order: the third and second eval cases in
> 1.8 (one is enough to prove the gate exists); the unit *detail* screen in 1.11 (the demo needs the
> list). **Do not cut** 1.7, 1.10 or 1.12 — the first two are cheap now and expensive to retrofit,
> and the third has to exist before the data does.
>
> **Note on the cadence's week-1 line.** "Real names, real addresses" is met at the address and unit
> level, which are structural facts; tenant names stay fixtures until the week-2 import under the
> corpus policy (A7). Say so in the room rather than letting it be noticed.

---

## Week 2 · Sun 13 – Thu 17 Sep — All 1,500 units, from the register

**Demo kind:** Real data · **You show:** the same screen, now with every building across Shoham, Beit
Shemesh, Ashdod, Lod and Ashkelon — units, tenancies, parties, searchable.
**Depends on:** the Priority read-only keys fuse. **Closes:** open question 3 in [plan.md](plan.md).

### Slice 2.1 — Party and PartyContact, temporally dated
E5 and E6 — 13 columns. `PartyContact` carries `valid_from` / `valid_to` because Israeli mobile
numbers get recycled, and `language` is a locked field on Party.
- **Done when:** the same phone number can belong to two parties over two non-overlapping periods,
  and to only one on any given day.
- **Verify:** **policy case 2 goes green** — a recycled number resolves to nobody. It was red in 1.7.
- **Deps:** 1.9 · **Size:** M

### Slice 2.2 — Tenancy, TenancyParty, and the guarantor constraint
E7 and E8. `TenancyParty.role` ∈ tenant · co_tenant · guarantor · occupant, and
**`is_service_contact` is forced false for `GUARANTOR` by a database constraint** — no toggle, no
import path, no agent override.
- **Done when:** the insert is *rejected*, not defaulted politely.
- **Verify:** **policy case 3 goes green**, asserting the rejection; write it red first.
- **Deps:** 2.1 · **Size:** M

### Slice 2.3 — `src/scope/` — the isolation join, written once
The five hops, in SQL, before any model call. The current-occupancy VIEW (R6) alongside it:
`today ∈ [start_date, end_date]`, computed on every load.
- **Done when:** Q1 and Q2 from the workbook's ADMIN VIEWS sheet are each one query, and no other
  module contains the join's temporal predicate.
- **Verify:** **policy case 1 goes green**; grep guard 2 stays green with the join in exactly one
  file; guard 1 confirms no `current_tenant` column was introduced.
- **Deps:** 2.2 · **Size:** M

### Slice 2.4 — The importer
Idempotent, re-runnable, reports rejects rather than failing whole. Natural keys do the work —
`address_key` for a building, `(unit_id, start_date)` for a tenancy — so a re-run is a no-op instead
of a duplicate, with no caller-supplied intent key anywhere.
- **Done when:** running it twice changes nothing the second time, and a malformed row is reported
  with its line number instead of aborting the file.
- **Verify:** run, re-run, diff row counts; feed it a deliberately broken file.
- **Deps:** 2.3 · **Size:** M

### Slice 2.5 — Import the real register
The Priority export into staging: 1,500 units, their tenancies and their parties.
- **Done when:** counts reconcile against the export and ten `resolveByPhone` spot-checks return the
  party the export names — including one party on two tenancies and one ended tenancy reading as a
  vacancy.
- **Verify:** the ten spot-checks, listed individually in the evidence file.
- **Deps:** 2.4 · **Size:** M

### Slice 2.6 — Browse at portfolio scale
Buildings list, unit grid, search, and the occupancy chip — **derived on every load, never stored**.
- **Done when:** search across 1,500 units returns in under a second and Q5 (leases ending in the
  next 60 days, whole portfolio) is one indexed query.
- **Verify:** timed queries at full row count, recorded as numbers.
- **Deps:** 2.5 · **Size:** M

> **Cut line:** the obligations strip and the compliance tab — both are month two. Do not cut 2.3.

---

## Week 3 · Sun 20 – Thu 24 Sep — Documents filed against units

**Demo kind:** Software · **You show:** pull a real lease off the Drive, then find it again in four
seconds. Hashed, dated, attached to unit and tenancy, immutable. Nothing is read yet — this is a
filing cabinet with a search box, and it is already a business win over the status quo.
**Depends on:** the Google Drive access fuse. **Governed by:** A8 — capture is open, promotion is
governed; A9 — the catalogue is dynamic now, its screen is month two; A10 — in bulk, convention
proposes and a human confirms.

### Slice 3.0 — Workbook pass: the document-schema catalogue
**Spec before code.** The workbook is the specification for month one's tables and it currently has
`Document` at eight fields with no catalogue behind it. Add **E15 `DocumentType`** and **E16
`DocumentTypeField`** with **R17** and **R18** — appended, never inserted, because R1–R16 are cited
in the frozen Hebrew file. Edit `build_model.py` and re-run it; the `.xlsx` is a build output. The
Hebrew workbook stays frozen unless asked.
- **Done when:** the FIELDS sheet specifies every column of both new entities, and the DECISIONS
  sheet carries A8 as the rule it creates and why that rule holds.
- **Verify:** re-run the generator; relationship numbers R1–R16 unchanged; open the workbook.
- **Deps:** none · **Size:** M

### Slice 3.1 — Document, DocumentLink, and the type catalogue
E12, E13, E15, E16. One document, several bindings, because a signed lease is evidence about the
tenancy *and* the unit *and* both signatories — six nullable foreign keys works until the seventh
entity needs documents. `file_hash` at ingest; immutable thereafter. `DocumentType` seeded with the
eight from the Data Model and **deactivated, never deleted**; `DocumentTypeField` versioned by
`effective_from`.
- **Done when:** adding a ninth document type with four fields of its own is a seed row and a
  re-deploy of data — **no migration**.
- **Verify:** add one in a test, extract nothing, and confirm no DDL was needed; contract test on
  R13, R17, R18; the same file ingested twice is one document with two links.
- **Deps:** 3.0, 2.2 · **Size:** M

### Slice 3.2 — Object storage and the path convention
The docs bucket with uniform access, public-access prevention and versioning, re-applied on every
bootstrap run. The runtime account gets `objectViewer` + `objectCreator` and deliberately **not**
`objectAdmin`, so the application cannot destroy a signed contract. Object paths carry the **place
and never the people**, keyed by id rather than a transliterated address — two streets that
transliterate alike would file one flat's lease under another's, a correctness failure with isolation
flavour, arriving quietly. (The retention and deletion controls landed in 1.12.)
- **Done when:** the app can write and read a contract and cannot delete one.
- **Verify:** attempt the delete as the runtime account and get denied.
- **Deps:** 3.1, 1.5, 1.12 · **Size:** S

### Slice 3.3 — Declared-type upload, with a verification guard
The interactive path: the flow already knows what it asked for ("upload the lease for unit 14"), so
**type is declared, not detected** and classification — the riskiest ingestion step — simply does not
exist. What remains is the cheap guard for the real error: right slot, wrong file.
- **Done when:** uploading an ארנונה bill into the lease slot is caught before it is filed.
- **Verify:** the wrong-file case, both directions, against tier-1 specimens.
- **Deps:** 3.1 · **Size:** M

### Slice 3.4 — Drive ingestion, and the bulk review queue
Copy and hash at ingest; keep `drive_file_id` as provenance and the folder path as a **hint that
pre-fills a binding**. The path is never itself the binding — if isolation resolved through a folder
name, someone tidying Drive on a Tuesday would break the client's absolute constraint. The bulk form
of A10: convention **proposes** a type and a binding, the guard checks the file matches the slot, and
a **confidence-ranked review queue** puts a human between the proposal and the filing. The obvious
ones clear in bulk; the ambiguous ones get looked at.
- **Done when:** a folder rename in Drive changes nothing about what any document is bound to, and
  nothing reaches a unit's document panel without a person having confirmed its type.
- **Verify:** rename a folder between two ingest runs and assert the bindings are identical; confirm
  the queue is the only write path into filed documents from bulk ingest.
- **Deps:** 3.2, 3.3 · **Size:** M

### Slice 3.5 — Assets, seeded from handover protocols
E11 — 14 columns, the widest entity in the workbook. `Asset.space_id` as a single non-null FK,
`warranty_end_date` and `warranty_provider_id` for תקופת הבדק, `source_document_id` so each asset
remembers the page it came from, `compliance_regime` for the inspection tab. **`asset_type` is
guarded, not admin-editable** — the responsibility matrix keys on it, so editing it edits policy.
- **Done when:** Q3 (what is overdue for inspection in this building) and Q7 (which bay is assigned to
  unit 12, and who serviced its gate motor) are each one query.
- **Verify:** both queries against the fixture; R3, R11, R12 and R14 as contract tests.
- **Deps:** 3.1, 1.9 · **Size:** M

### Slice 3.6 — Find it in four seconds
Document search and the documents panels on the building and unit screens, grouped by type.
- **Done when:** a named lease is on screen within four seconds of deciding to look for it.
- **Verify:** timed, by the owner, on staging.
- **Deps:** 3.4 · **Size:** S

> **Cut line:** the compliance tab's visual treatment (the query is what matters this week), and the
> review queue's bulk-approve affordance — one-at-a-time confirmation still proves the design. **Do
> not cut 3.0** — a migration written ahead of the workbook is the anti-pattern this project already
> named.

---

## Week 4 · Sun 27 Sep – Thu 1 Oct — The machine reads a lease, and shows its work → **M1**

**Demo kind:** Software, with an Evidence number attached · **You show:** drop in a real Hebrew lease.
Rent, dates, parties and clauses appear as fields. Click any value and the page image scrolls to the
pixels it came from, with a confidence score.

### Slice 4.1 — Document AI OCR adapter
The **general OCR processor, not Form Parser** — the schema is already declared, so Google needn't
infer structure, at roughly a twentieth of the cost. Hebrew print and handwriting, word boxes,
per-word confidence.
- **Done when:** a scanned Hebrew lease yields word-level boxes and confidences, and the residency
  position is recorded in the evidence file rather than assumed.
- **Verify:** boxes rendered over the page image for one document; a scan and a native PDF both
  handled.
- **Deps:** 3.4 · **Size:** M

### Slice 4.2 — Comprehension into the declared schema — **the open half of A8**
The model maps OCR output into the fields **that document type's schema declares**, read from
`DocumentTypeField` at run time rather than from code. **Two engines, deliberately:** a language
model asked for coordinates produces plausible coordinates; an OCR engine measures them. Output is a
generic `ExtractedField` row per value — `(document_id, type_field_id, value, page, bbox, confidence,
model, schema_version_id)`.
- **Done when:** adding a field to a document type and re-running extraction produces that field,
  with **no code change and no migration** — and every value's `(page, bbox, confidence)` came from
  the OCR engine, never from the model.
- **Verify:** add a field to a specimen type mid-test and re-extract; a contract test asserts no bbox
  in the system originates from a model response.
- **Deps:** 4.1, 3.1 · **Size:** M

### Slice 4.3 — Promotion, with provenance — **the governed half of A8**
Copying an extracted value onto a **typed column** of the business record, keeping `(document_id,
page, bbox, confidence, promoted_by, promoted_at)`. The mapping from a type field to a business column
is `FieldPromotion` and it costs a migration on purpose: those columns are what the isolation join,
the responsibility matrix and the state machine read. The operator proposes-and-promotes flow; the
append-only `TenancyEvent` records old → new, who approved it, and which document caused it.
- **Done when:** no extracted value reaches a business record without a named promoter, a source and
  a mapping — and an unmapped field is capturable, visible and searchable while being **incapable**
  of becoming business truth.
- **Verify:** attempt a direct write to a promoted column outside the promotion path; it fails. A
  contract test asserts no policy input, isolation predicate or state-machine guard reads an
  `ExtractedField` value directly (**R9**).
- **Deps:** 4.2 · **Size:** M

### Slice 4.4 — Click a value, see the pixels
The provenance viewer: the page image scrolls to the box the value came from.
- **Done when:** every promoted field on the unit screen is clickable through to its pixels.
- **Verify:** demonstrated live on three different documents.
- **Deps:** 4.3 · **Size:** M

### Slice 4.5 — The accuracy number
Per-field accuracy across ~40 real leases. **This is the number that decides how much human review
the backfill needs**, and it is the one place a specimen cannot serve — tier 1 has the structure but
not the scans, the handwriting or the signatures (A7; the controls for tier 2 were built in 1.12).
- **Done when:** a per-field accuracy table exists with its sample size, its failure modes named, and
  a stated removal date for the source documents.
- **Verify:** the run is reproducible from a script, and the numbers are in `tasks/evidence/`, never
  in a document as an assertion.
- **Deps:** 4.4, 3.2 · **Size:** M

### **Checkpoint · M1**
- [ ] A system of record for 1,500 units; every value traces to the paper it came from
- [ ] Policy cases 1, 2 and 3 green, each having been red first; both grep guards live
- [ ] Meta verification landed or its status confirmed on the asks slide
- [ ] The three success numbers agreed with the client, not proposed
- [ ] Weeks 5–8 decomposed to slice level, in this file, before week 5's Monday

---

# MONTH TWO · The rules are explicit → **M2**

> The most valuable point in the plan. By the end of it, an operator console covering all 1,500 units
> that depends on **no agent, no Meta and no model behaving** — and that is the negotiating position
> for everything after it.

| Week | Demo kind | Deliverable | Workstreams | Depends on |
|---|---|---|---|---|
| **5** | Real data | **Paper becomes truth.** An amendment arrives for a real unit; the tenancy updates; the change log records old → new, who approved it, which document caused it. Then a tenancy ends because a date passed, with no document at all. | Promotion at scale · tenancy reconciliation · `TenancyEvent` · Obligation + ObligationType (E9, E10) · **the settings screen: the `ObligationType` and `DocumentType` catalogues, admin-managed at last (A9) — one screen, one pattern, and `asset_type` deliberately absent from it** · staff MFA and the `national_id` field guard | W4 · **closes open question 2 — how many `terms_profile`s are in force, which sizes week 6** |
| **6** | Software | **Who pays for this, and why.** Pick a category and a unit; get tenant / operator / contractor with the clause and the policy version behind it. Then edit the table live and watch the answer change. | `policy` module: the responsibility matrix as versioned, admin-editable data · `asset_in_warranty` fed by week 3's asset register · rules supersede by `effective_from` and never overwrite · `policy_version_id` snapshotted on every resolution | W5, W3.5 · sized by question 2 |
| **7** | Software | **A ticket, start to finish, by hand.** Walk the canonical states in the console — NEW · IDENTIFIED · TRIAGED · RESPONSIBILITY SET · WINDOWS COLLECTED · OFFERED · SCHEDULED · CLOSED — plus the three exits. Watch the SLA clock run and the escalation fire. No WhatsApp, no agent. | `calls` module: state machine · SLA policies · timers · escalation · **the emergency bypass, live and tested here** because it must exist before the agent takes its first real message in week 10 · **the async negotiation engine starts and runs underneath for six weeks** | W6 |
| **8** | Evidence | **Try to break tenant isolation, live.** Query as one tenant's phone and attempt to reach another tenant's documents, unit or history — through the console, through the API, and by asking the model. Every path returns nothing. | Policy suite cases 4 and 5 (`UNIT` is the only kind that can be the tenant's; a live warranty moves responsibility to the contractor, and re-resolving after a policy change still returns the snapshot) · `national_id` unreachable by any agent tool · audit on every scoped read | W7 |

### **Checkpoint · M2**
- [ ] The console is usable on its own — if the agent were cancelled tomorrow, this is still a product
- [ ] All five policy cases green, each red first; the two extra constraints covered
- [ ] Weeks 9–12 decomposed to slice level before week 9's Monday

---

# MONTH THREE · The agent takes the call → **M3 · go/no-go**

| Week | Demo kind | Deliverable | Workstreams | Depends on |
|---|---|---|---|---|
| **9** | Software | **Message the number from your own phone.** It replies with your name, your unit and your tenancy — after a one-time code delivered through WhatsApp itself. | `channel` module: Cloud API webhooks both directions · phone → party binding through `src/scope/` · Conversation and Message tables · **OTP over WhatsApp first, SMS only as fallback** (Twilio closed and working; Hebrew is missing from Verify's default locales — needs custom templates or an Israeli fallback) | **Meta verification** · W8 |
| **10** | Software | **"Who fixes my dripping tap?"** A tenant describes a fault in plain Hebrew; the agent triages, answers from their own lease and the knowledge base, and either resolves it or opens a ticket. | Tenant-facing agent, scoped tools only · retrieval over the tenant's own documents and the global knowledge base · the golden set grows from three cases toward fifty · **the agent reads the responsibility matrix; it never decides responsibility** · no prices, ever | W9 |
| **11** | Software | **Both sides of the switchboard.** Two phones on the table: tenant reports, agent collects windows, agent WhatsApps a provider with address and slots, provider counter-proposes, tenant accepts, visit booked. Neither human sees an app. | The hard part surfacing: `WINDOWS COLLECTED → OFFERED` is two-sided asynchronous negotiation — **roughly seventy percent of the engineering lives between those two states** · provider-side thread bound to the same ServiceCall · timeouts, retries, no delivery guarantee | W10 · in-house crew availability (question 5) |
| **12** | Evidence | **Live, with real tenants and real tradesmen.** The 72-unit building is on the agent; a week of history; every number measured against the three agreed in week 1. | Pilot cutover · escalation queue staffed daily by the pilot owner · **prod tagging starts here** — from now a `v*` tag is cut for every change that reaches real tenants | W11 |

### **Checkpoint · M3 · go / no-go**
- [ ] The loop is closed end to end on one building
- [ ] The decision is not "does it work" — it is whether the three numbers justify month four
- [ ] Weeks 13–16 decomposed before week 13's Monday

---

# MONTH FOUR · It survives contact with reality → **M4 · scale decision**

| Week | Demo kind | Deliverable | Workstreams |
|---|---|---|---|
| **13** | Evidence | **What happens when the plumber goes quiet.** A deliberate chaos run: a provider ghosts for 36 hours, a tenant stops replying mid-thread, a message fails to deliver. Show the timeouts firing, the retries, the fallback provider, and escalation reaching a human at the right moment. | The unglamorous three-quarters of the negotiation engine. **Announced as an evidence week on Monday — there is no new screen, and that is fine.** |
| **14** | Software | **Voice notes and five languages.** A tradesman replies with a 20-second voice note; the agent understands it; the console shows both the original and the Hebrew. A Russian-speaking tenant is served in Russian while the provider side stays Hebrew. | Transcription (**voice notes are day-one table stakes** — Israeli tradesmen answer in them) · `body_original` + `body_he` · he/ru/ar/fr/en · **חוק התקשורת: service and marketing on separate rails** |
| **15** | Real data | **The pilot dashboard, with four weeks of history.** Resolution rate, time-to-booked, escalation rate by cause, self-service share, cost per call — from actual traffic, not projections. Plus the audit trail behind any single ticket. | Built early and cheaply; by week 15 it fills itself. Both a demo and the evidence base for M4. |
| **16** | Evidence | **Pilot review and the scale decision.** One month on 72 units, measured: what the agent handled alone, what it escalated and why, what it cost, and what breaks first at 200 units and at 1,500. **The ask: which building goes second, and on what date.** | — |

### **Checkpoint · M4**
- [ ] A scale-out decision made on measured data rather than on confidence
- [ ] Sixteen weeks of demos behind it that nobody has to take on faith
