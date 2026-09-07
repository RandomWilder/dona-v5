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

**The dates above are the plan and are never rewritten.** A week closes when its slices close and its
demo has been given, not when its Thursday arrives; the next week starts the same day. The gap
between a slice's promised week here and the date on its evidence file is the measurement of how the
project actually ran, and it is only a measurement if neither side moves to meet the other. Week 1
closed **6 Sep 2026** ([evidence/week-1.md](evidence/week-1.md)).

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
- **Lifted four scripts rather than one.** `bootstrap.sh` · `set-secret.sh` · `smoke.sh` ·
  `rollback.sh` — all Tier 1, all verbatim apart from the `PROJECT` default. `rollback.sh` invokes
  `smoke.sh`, `bootstrap.sh` prints a `set-secret.sh` command, and `AGENTS.md` already points at
  `set-secret.sh`; lifting one of the four leaves the repo referencing three files that do not
  exist. Only `bootstrap.sh` is run in this slice.
- **R8 is not satisfied, and no slice this week can satisfy it.** `dona-v5` is **org-less** and
  `gcloud organizations list` returns 0 items — creating an organisation means a Cloud Identity Free
  tenancy on a domain we control plus DNS verification, which is a signup rather than a script.
  Provisioned org-less deliberately: a project move preserves project id, resources, data and IAM
  whenever it happens, and nothing this week depends on it. The ordering that *is* absolute — an
  identity on the destination domain before the move, and the move before real tenant data — is now
  **fuse F7**, and `bootstrap.sh` prints it on every run against an org-less project rather than
  leaving it in a document.
- **Dropped from the lift: the four staff seed secrets.** v3 created `staff-seed-email/password` and
  `staff-viewer-email/password` here. v5 has no `src/staff/` and no seeding code, and the auth gap it
  must close is Identity Platform with enforced MFA ([from-v3.md](../docs/from-v3.md) Tier 2), so v3's
  email+password pair may never be built at all — a generated credential in Secret Manager that
  nothing reads and no rotation flow owns is worse than an absent one. Carried into the **week-5**
  staff-MFA row below.
- **Deps:** 1.1 · **Size:** M

### Slice 1.6 — CI, staging, release
`ci.yml` (typecheck · lint · tests against a real Postgres service container · evals as a separate
job), `deploy.yml` firing on `workflow_run` after CI succeeds — **never on push** — and `release.yml`
on a `v*` tag only, re-running the full gate against the tagged commit and refusing a tag that is not
an ancestor of `main`.
- **Done when:** a red commit cannot reach staging even by a direct push to `main`.
- **Verify:** push a red commit directly to `main`; staging does not move.
- **Owed by 1.1, re-scoped at 1.3:** branch protection *required* the check contexts **`gate`** and
  **`evals`** by those exact names from 1.1, with no workflow behind either. A required context that
  never reports is not pending, it is failing: PRs #2 and #3 were both `BLOCKED` on an empty rollup
  and only `--admin` got through, which is how a guardrail becomes background noise. Required status
  checks were **removed from `main` on 2026-09-04**; no-force-push, no-deletion and
  required-conversation-resolution stayed. **This slice re-arms `gate`**: name the job exactly
  `gate`, let one PR go green with it, *then* add the context back, and prove it with a second PR
  rather than by reading the YAML. `evals` is 1.8's to re-arm — it cannot be honest before the
  golden set exists, and a job that exits 0 on an empty suite is a green check that proves nothing.
- **Owed by 1.3:** the `gate` job is three steps — `npm run typecheck`, `npm run lint`, `npm test` —
  and `npm test` is `test:code && test:hooks`. The hooks half is the only thing that runs
  `.claude/hooks/hooks.test.mjs`, so a `gate` that shortcuts to `test:code` silently drops 41 cases.
  Set `REQUIRE_POSTGRES=1` against a real Postgres service container, or `src/app.test.ts` and
  `src/db.test.ts` skip green with no database. `infra/smoke.sh` asserts `/health` returns `ok:true`
  **and** `db:up` — the endpoint 1.3 built for it, proved degrading to 503 and recovering.
- **Owed by 1.1, closing here rather than at 1.10:** `enforce_admins: true` on `main`, as the last
  act of the slice. It was `false` only so this Verify could push red to `main`; once that is done
  the reason is spent, and every slice after this one merges inside a gate that is real.
- **Owed by 1.4 — the deploy must run the migrations, and nothing can run them yet.** 1.4 brought
  `kernel/migrate.ts` and three migrations, but the only caller is `pg-support.ts` inside the test
  run: there is no `npm run migrate` and no CLI entry point, so a deployed revision would serve
  `/health` against a database with no tables. `deploy.yml` and `release.yml` both need one, between
  the deploy and the smoke (pipeline §5). It is built here.
- **Owed by 1.5 — the exact values to wire, and two scripts that need no lift.** `smoke.sh` and
  `rollback.sh` came in at 1.5, so this slice consumes them. `deploy.yml` and `release.yml` need: WIF
  provider `projects/681282581055/locations/global/workloadIdentityPools/github-pool/providers/github-provider`,
  whose `assertion.repository` condition pins it to `RandomWilder/dona-v5` — if the repository moves,
  the condition and both workflows change together · deploy SA
  `deploy-<env>@dona-v5.iam.gserviceaccount.com` · runtime SA `app-<env>@dona-v5.iam.gserviceaccount.com`
  · Cloud SQL `dona-v5:me-west1:dona-<env>` · secret `<env>-database-url` · image
  `me-west1-docker.pkg.dev/dona-v5/dona/…` · docs bucket `gs://dona-v5-<env>-docs`. The Cloud Run
  service does not exist yet and bootstrap deliberately does not create it — the first deploy does.
- **Owed by 1.4:** `REQUIRE_POSTGRES=1` now decides **23** cases rather than 2 — the whole kernel
  durability suite. Without it, against a real Postgres service container, `gate` goes green having
  touched no database at all. Runtime dependencies are now four: `pdfjs-dist` and
  `google-auth-library` arrived with the kernel and `npm ci --omit=dev` installs both — `pdfjs-dist`
  alone is 35 MB unpacked, so the image and the build time both grow.
- **Done 2026-09-05** ([evidence](evidence/1.6.md)). Staging live at
  `https://dona-staging-681282581055.me-west1.run.app`; image 330 MiB, a whole deploy under two
  minutes. Red commit `ed92f87` pushed straight to `main` → CI failed in 25 s, `Deploy` concluded
  **skipped**, staging stayed on the previous revision. `gate` armed after it reported green, proved
  from a second PR's rollup rather than from the YAML; `enforce_admins` now `true`.
  `REQUIRE_POSTGRES=1` decides **24** cases, not 23 — this slice added one. Migrations run as a
  Cloud Run job from the deployed image as the **runtime** account, **before** the revision serves:
  the connection URL is bound to `app-<env>` alone, so migrating from the runner would have handed
  the CI identity prod's connection string. [pipeline.md](../docs/pipeline.md) §5's arrow was
  corrected in the same change. `evals` deliberately not written: 1.8 owns it.
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
- **Owed by 1.4 — the guard's path is wrong in every document that names it.** Migrations live at
  **`src/kernel/migrations/*.sql`**, not root `migrations/`. Pipeline §6 and this file both wrote
  the `current_tenant` guard against `migrations/*.sql`, which matches nothing: a guard that passes
  because it read no files, which is 1.3's silent-glob finding arriving in CI instead of in a test
  runner. Point it at the real path, and prove it by tripping it.
- **Owed by 1.6 — the guards go inside `gate`.** `ci.yml` has exactly one job and it is a
  **required** context on `main` from 2026-09-05, so a guard added as a step in it blocks merges the
  moment it lands — trip each one deliberately on a branch rather than discover it on `main`. With
  `enforce_admins` true there is no admin merge past a guard that fires.
- **Closed 2026-09-05** ([evidence](evidence/1.7.md)). 14 policy cases; 7 report **pending** against
  a named missing relation rather than skipping or going `todo`, and the branch is unreachable the
  moment the last table lands. A deliberately-red required check cannot be committed — `gate` is
  required and admin-enforced — so the red was proved and recorded instead. The disarm was proved
  against a throwaway database with the seven tables in it (14 green, no pending lines), and every
  predicate was then deleted from the join in turn, which **rewrote two cases**: an `ENDED` tenancy
  is excluded by the status filter, so the date predicate tested nothing, and both recycled-number
  cases ended the tenancy, so the contact dating tested nothing. Both guards tripped in CI
  (`8c67318` → `33965072969`, `f9eb13a` → `33965119613`), both `BLOCKED`, both reverted; both fail
  when they scanned zero files, and guard one now greps the real path. `src/scope/` landed here
  rather than at 2.3, holding the join and nothing else.
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
- **Owed by 1.3 — re-arm `evals` on `main`.** Required from 1.1 with nothing behind it, removed on
  2026-09-04 (see 1.6). This is the first slice that can satisfy it honestly, so as its closing act:
  watch the job go green on a PR **and** go red with the database URL unset, then add `evals` back as
  a required context. Re-arming on a job that has only ever passed repeats 1.1's mistake.
- **Owed by 1.6 — what to add, and the one thing that does not exist yet.** A second job in
  `ci.yml` named exactly **`evals`**, with its own `pgvector/pgvector:pg16` service container,
  `REQUIRE_POSTGRES=1` **and** `REQUIRE_EMBEDDINGS=1`, plus a repository secret `OPENAI_API_KEY` —
  a **CI-only** key, deliberately not staging's or prod's, which live in Secret Manager and reach
  only their own service account. No such repository secret exists today. Re-arm by PATCHing both
  contexts in at once, `{"contexts":["gate","evals"]}`, keeping `strict: true`.
- **Closed 2026-09-05** ([evidence](evidence/1.8.md)). Three cases, one per kind, plus 17 harness
  tests inside `npm test` (163 → 180, which is 1.3's `evals/**/*.test.ts` glob confirmed by count).
  `evals` was seen red **twice** before being armed, for both reasons it can be red: no key (run
  `33973148375`) and no database (`b40e02b` → run `33973760443`, the Verify step, reverted in
  `9447ff9`). Contexts are `["gate","evals"]`, `strict: true`, `enforce_admins: true`. The structural
  call is `evals/corpus.ts`, the one file not lifted from v3: v3 built its corpus through
  `occupancy` · `catalog` · `channel`, none of which exist here, and a corpus needing neither a
  database nor a key would make both `REQUIRE_*` switches decorative — so nine authored Hebrew
  passages are indexed into a **TEMP** `vector(1536)` table through the real config rows, the real
  embedder and pgvector's own ordering. `rankAtMost: 1` and the grounding cutoff (0.62 → **0.59**)
  were set from a measurement run rather than chosen. `release.yml` gained `secrets: inherit`, and a
  red `evals` now stops staging too through `deploy.yml`'s conclusion check.
- **Deps:** 1.6 · **Size:** M

### Slice 1.9 — Estate schema: Project · Building · Space · Unit
The new spine, from the workbook's FIELDS sheet — E1–E4, **28 stored columns** (5 · 8 · 6 · 9) plus
two that are deliberately derived and never stored. `Building.project_id` nullable with
`project_code` on Project; `Space.space_kind` as the six-value enum; `Unit.unit_id = Space.space_id`
as a shared key, not a foreign key to a surrogate.
- **Done when:** an apartment is a Space with a Unit extension and a lobby is a Space with none, both
  enforced by the schema rather than by convention.
- **Verify:** contract tests for R1, R2 and R15; an insert of a Unit with no Space is rejected.
- **Owed by 1.4:** the DDL appends from **`0004_`**. `0001`–`0003` are the kernel's own — the
  `vector` extension, the durability tables, their settings seed — and estate is the first domain
  table in this repository.
- **Owed by 1.7 — the pending diagnostic moves from `building` to `party` the day this lands.**
  `tests/policy/fixtures.ts` already writes `building`, `space` and `unit` from the workbook's E1–E4,
  against tables that do not exist. Any column it guessed wrong surfaces as a not-null or
  undefined-column failure **in one file**: extend the builder, never the cases.
- **Closed 2026-09-05** ([evidence](evidence/1.9.md)). Two claims in this entry were wrong and are
  corrected above: E1–E4 is 28 columns and not 32, and **no policy case stops being pending here** —
  all seven reach `party` through `seedOccupancy` and clear at 2.2. The entry also said "natural keys
  do the work: `address_key` for a building". **No natural key was created**: the FIELDS sheet
  specifies none, nothing yet re-runs against this schema, and the real need is an importer that can
  run twice — carried to 1.11, which is the first slice with real addresses in front of it. R2 and
  D3 are enforced as composite foreign keys rather than triggers, via `UNIQUE (space_id, space_kind)`
  on `space` and three constant discriminators on `unit`; all four rejections were proved red first
  against the same DDL without that key.
- **Deps:** 1.4, 1.7 · **Size:** M

### Slice 1.10 — Prove the pipeline in both directions, on purpose
Break a test → PR blocked. Fix → merge → staging live. Tag `v0.1.0` → prod. **Roll prod back** with
`infra/rollback.sh`, then confirm the next deploy still takes traffic. The one week this is free is
the week nothing depends on it.
- **Done when:** the round trip is complete and the post-rollback deploy serves 100%, not 0%.
- **Verify:** revision list with traffic percentages at each step, times recorded.
- **Owed by 1.5 — the cost lever, pulled here.** Prod's Cloud SQL instance is idle from the end of
  this slice until week 12, when prod tagging starts (pipeline §8): between the deliberate round trip
  above and the pilot there is nothing in prod to serve and nobody to serve it. Close the slice with
  `gcloud sql instances patch dona-prod --activation-policy=NEVER`, which stops compute billing while
  keeping the instance, its storage and its data, and is reversed by one command. The project also
  carries a ₪250/month budget filtered to it alone, with a forecasted-spend alert.
- **Owed by 1.5:** `infra/rollback.sh` is already in the repo, and it ends by calling
  `infra/smoke.sh`. So the rollback leg fails closed if the revision it lands on is not actually
  serving — the proof is the script's exit code, not a traffic percentage read off a list. It also
  prints the roll-forward command, which is what turns "confirm the next deploy still takes traffic"
  into a step rather than a memory.
- **Owed by 1.6 — `release.yml` exists and has never run.** The first `v*` tag creates **both** the
  `dona-prod` service and the `dona-prod-migrate` job, exactly as 1.6's first deploy created
  staging's, so the tag leg is a first run rather than a redeploy — budget for it. The gate is
  re-run against the tagged commit through `workflow_call`, and a tag that is not an ancestor of
  `main` is refused.
- **Confirms 1.6's flip:** this is the first slice that runs entirely inside the enforced gate, so
  its break→blocked leg doubles as the proof that `enforce_admins: true` took — it was flipped on
  2026-09-05 at the end of that slice.
- **Owed by 1.8 — the first tag is the first execution of two lines.** The gate `release.yml` re-runs
  is **two jobs** from 1.8, so a red `evals` stops the release before prod; and the call carries
  `secrets: inherit`, added at 1.8 because a called workflow inherits none by default and the evals
  job would otherwise fail on a key it was never handed. Neither has ever run.
- **Closed 2026-09-05** ([evidence](evidence/1.10.md)). The round trip as traffic percentages:
  `v0.1.0` → `dona-prod-00001` 100% · `v0.1.1` → `00002` 100% · `rollback.sh prod` → `00001` 100%
  **pinned**, the traffic entry having lost its `latestRevision` flag · `v0.1.2` → `00003` 100% with
  the flag restored, which is the acceptance bar and the one failure in this chain that would have
  reported success while changing nothing. PR #15 was opened red deliberately and **`gh pr merge
  --admin` was refused** — 1.1's last carry proved from the outside. The first release created
  `dona-prod` and `dona-prod-migrate` and applied **four** migrations to a virgin database as
  `app-prod`; three releases took 2 m 20 s – 2 m 30 s. **Three tags rather than one**, because
  `rollback.sh` walks to the ready revision after the one serving and a rollback needs somewhere to
  go. The cost lever was **two** commands, not the one this entry named: the database stopped *and*
  `--min-instances 0`, since `release.yml` deploys prod with `--min-instances 1`. The ₪250/month
  budget this entry asserted does exist. **Found here:** `environment: production` was created
  implicitly by the first release with **no protection rules** — carried to week 12 below.
- **Deps:** 1.6 · **Size:** S

### Slice 1.11 — The Shoham fixture and the week-1 surface
A fixture we designed for coverage — Shoham's building, its spaces and its 72 units — seeded through
the importer path rather than by hand, and a buildings/units list screen on the RTL token layer.
- **Done when:** a stakeholder opens the staging URL on their own phone and sees the building and its
  units.
- **Verify:** the owner browses it in a browser, not a screenshot.
- **Owed by 1.9 — the importer needs a natural key, and 1.9 did not invent one.** Nothing in
  `0004_estate.sql` is unique but the primary keys, so seeding the Shoham fixture twice creates the
  building twice. The `address_key` idea belonged to 1.9's entry and is answered here instead,
  against real addresses rather than against a guess. It costs a migration (`0005_`).
- **Owed by 1.4:** v3's `kernel/ui/tokens.test.ts` was deliberately **not** lifted — it asserts
  against module HTML shells that v5 does not have yet. It is the guard keeping a hex colour, a
  `fonts.googleapis` URL and a physical `left:`/`right:` out of a screen, and it fails on the HTML
  rather than the CSS because that is where the discipline erodes. It lands with this screen.
- **Closed 2026-09-06** ([evidence](evidence/1.11.md)). Staging serves it: revision `00014-vtx`,
  `/` → `/estate` → the building → its 72 units, zero `<script>` tags, every measure off
  `/ui/tokens.css`. `0005_` carries three keys — `project (project_code)`, `space (building_id,
  space_kind, name)` and `building (address_key)`, a generated column rather than a unique constraint
  over the two address columns, because a second export types the same address differently. `unit`
  gets none: R2 already made its identity its space's. The red was measured, not asserted — 2
  buildings, 368 spaces, 144 units from one fixture applied twice against `0004`. **The token guard
  lifted from v3 was broken**: its pattern misses `padding-left`, `border-left-width` and
  `text-align: left`, found by tripping it. `npm run seed` is in **no workflow** on purpose; staging
  was seeded by a Cloud Run job as `app-staging` and run twice to show `created: 0`. The fixture is
  ours top to bottom — see the corrected week-1 demo note below. **The slice shipped one defect and
  the gate caught it** on its own closing PR: the import report counted whole tables rather than the
  plan's own rows, which is a number another suite or a developer's seed can move. It counts from
  `(xmax = 0)` per upsert now, and every estate suite is scoped to a city of its own — fixed inside
  the slice, not carried out of it.
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
- **Owed by 1.5 — the bucket, and the fuse that binds here.** The corpus does **not** go into
  `gs://dona-v5-<env>-docs`; 1.5 created that for the application, with `objectViewer` +
  `objectCreator` and deliberately not `objectAdmin`. This slice creates its own dated bucket so a
  removal is one bucket rather than a search. And **F7 binds here**: `dona-v5` is org-less, and the
  move into an organisation has to happen *before* real tenant data lands or it stops being an admin
  task. Either the move happens first, or the corpus stays in its dated bucket with a removal date
  recorded — decided in this slice, not discovered in week 4.
- **Owed by 1.2:** the bash guard covers the **Bash tool only** — Write, Edit and every MCP tool
  reach the filesystem without passing it. Nothing in this slice may lean on it; `.gitignore`, bucket
  IAM and the policy suite are what hold.
- **Owed by 1.1:** close **F6** in [fuses.md](fuses.md). Tier 2 is the first real personal data in
  the system, and ADR-0004 owes its legal basis and its named third parties *before* it lands.
- **Owed by 1.8 — two things, one of them a naming obligation.** The golden set is graded against
  **nine authored Hebrew passages** in `evals/fixtures/specimen-clauses.ts`, standing in for the
  tier-1 specimens because those do not exist until this slice: swap them in here and re-measure the
  ranks rather than assuming them. And the CI-only `OPENAI_API_KEY` means an external model provider
  receives text from this repository on every PR — authored fixture text with no personal data in
  it, so nothing is owed today, but ADR-0004's obligation is to name third parties *before* they see
  tenant text, and this is the slice that writes that list.
- **Closed 2026-09-06** ([evidence](evidence/1.12.md)). **Tier 1 landed and tier 2 did not, which is
  the order R4 asks for.** `docs/corpus/` holds six Hebrew specimens and 71 clauses, and this entry's
  own premise is corrected in it: they are text **authored to the published forms' structure**, not
  copies of the published PDFs — the gate needs text it can chunk today and the path that turns a PDF
  into text is week 3's, and republishing a third party's document is the director's call. The
  published PDFs are carried to **3.4**, beside the authored text and not over it, because swapping
  the substrate under a ratchet silently re-baselines it. `evals/fixtures/specimen-clauses.ts` became
  a **loader** over that directory rather than a second copy; 9 passages → 71, and the ranks were
  re-measured in CI (run `34015648330`) rather than assumed. `rankAtMost` stays **1** because that is
  what retrieval achieves in a corpus eight times larger; the grounding cutoff moved **0.59 → 0.56**,
  which is the midpoint of the measured gap — 0.59 still separated answers from refusals and had
  stopped being between them. The deletion path was proved **both ways**: against a probe bucket left
  on Cloud Storage's default 7-day soft-delete window it **failed**, printing the object still
  recoverable, and against the real bucket it exited 0. That is the whole reason the bucket sets
  versioning off and the soft-delete window to zero — without them "permanently removed" is false
  while every listing a person reads says otherwise. **Guard three** (`-- pii` on a person-shaped
  column) was built here against zero violations and is carried to **2.1**, and its own test caught
  its `ALTER TABLE` form anchored wrong before it ever ran on a real migration. **F6 is lit and half
  discharged** — every third party that sees text from this system is named in `SPEC.md`, Anthropic
  included, and the DPA and the disclosure stay the owner's. Scoped the same day, after the slice
  closed: the remaining ask is **three named acts, not five negotiations** — OpenAI's DPA (a form),
  confirming Google Cloud's (incorporated by reference), and publishing the notice to data subjects
  (drafted at [../docs/data-subject-notice.draft.md](../docs/data-subject-notice.draft.md)). Meta's
  and Twilio's arrive with week 9; Anthropic needs none. ADR-0004 moved `proposed` → **accepted** at
  the same time: an outstanding deliverable belongs on a fuse, which has an owner and a weekly walk,
  not in a status field, which has neither. **F7 is decided:** the organisation move
  does not go first; the corpus gets a dated bucket instead, so the rule becomes *before tier 2 lands
  or after it is removed*.
- **Deps:** 1.5 · **Size:** S

> **Week-1 cut line.** If the week runs hot, cut in this order: the third and second eval cases in
> 1.8 (one is enough to prove the gate exists); the unit *detail* screen in 1.11 (the demo needs the
> list). **Do not cut** 1.7, 1.10 or 1.12 — the first two are cheap now and expensive to retrofit,
> and the third has to exist before the data does.
>
> **Note on the cadence's week-1 line — corrected at 1.11.** This said "real names, real addresses"
> is met at the address and unit level. **It is not, and was not going to be.** The director's
> decision this week is that functionality is established against mock addresses and example leases
> and real data is applied to it afterwards — [pipeline.md](../docs/pipeline.md) §1 principle 5, and
> the right call. So week 1's demo is a fixture designed for coverage, top to bottom: the address,
> the unit numbers and the names alike. What is real is the schema underneath it and the importer
> that will take the real register in week 2. **Say that in the room**, in those words, rather than
> letting someone notice that רקפת 12 is not one of their buildings.

---

## Week 2 · Sun 13 – Thu 17 Sep — All 1,500 units, from the register

**Demo kind:** Real data · **You show:** the same screen, now with every building across Shoham, Beit
Shemesh, Ashdod, Lod and Ashkelon — units, tenancies, parties, searchable.
**Owed by 1.11 — two things this week inherits.** `GET /` is a 302 to `/estate` because `/estate` was
the only screen in the system; the week that a second screen exists, the root becomes an index rather
than a redirect. And the real addresses arrive here: they go in through `importEstate` and
`building.address_key`, which normalises exactly the spacing and casing variation a Priority export
brings — so the import is re-runnable from the first attempt rather than after the first duplicate.
**Depends on:** the Priority read-only keys fuse. **Closes:** open question 3 in [plan.md](plan.md).

> **Closed 2026-09-07** ([evidence](evidence/week-2.md)). **Five slices of six**, 2.1 – 2.4 and 2.6;
> the cut line was never reached. **2.5 moved out of the week on 6 Sep, before it started**, when the
> project adopted a method that puts the real register at step 4 — so the declared kind was
> re-declared from *Real data* to **Software** in advance, with four planned build days still on the
> clock, and F3 left month one's critical path. Demoed off staging at `e6c4375` on **7 Sep**, ten
> calendar days ahead of the planned window: 1,500 units, 37 buildings, five cities, search, the
> occupancy chip and Q5, from a **generated** register imported with zero rejects. Search runs in
> 2.35 ms against a bar of one second. Stakeholder comments were about the UI and none of them block
> week 3; they are carried to the **M1 checkpoint**, where a design pass either earns a slice or does
> not. **Open question 3 does not close here** — what the Priority export actually contains is a fact
> about a file nobody has opened, and it moved to the pilot-preparation step with 2.5 rather than
> being answered by a register we generated ourselves. 346 tests on every merge, up from 326.

### Slice 2.1 — Party and PartyContact, temporally dated
E5 and E6 — 13 columns. `PartyContact` carries `valid_from` / `valid_to` because Israeli mobile
numbers get recycled, and `language` is a locked field on Party.
- **Done when:** the same phone number can belong to two parties over two non-overlapping periods,
  and to only one on any given day.
- **Verify:** **policy case 2 goes green** — a recycled number resolves to nobody. It was red in 1.7.
- **Owed by 1.12 — the first migration guard three was built for.** `0006_` is the first DDL in this
  repository with a person in it, and `scripts/guards.ts` fails the build if `phone`, `email`,
  `national_id`, a name or a birth date arrives without `-- pii` on its line or in the comment block
  above it. The escape is `-- not-pii: <why>` and it costs a sentence. The guard has been green
  against five migrations since 1.12 and has never fired; **this is the slice where it either fires
  or the marker was written**, and either outcome is the control working.
- **Owed by 1.7 — three cases, not one, and the sharpest is the third.** `tests/policy/` holds
  *"resolves to nobody once the tenancy and the contact have both closed"*, *"resolves to the new
  holder's own unit and never to the previous one"*, and — the one that matters — *"stops a stranger
  reaching a unit whose tenancy is still running"*. Only the third makes the contact dating
  load-bearing: in the other two the ended tenancy does the work, which mutation testing at 1.7 found
  the hard way. Extend `tests/policy/fixtures.ts` for `party` and `party_contact`; do not edit the
  cases.
- **Closed 2026-09-06** ([evidence](evidence/2.1.md)). **This entry's own Verify was wrong and is
  corrected here**, in the same way 1.9's was and for the same reason: *"policy case 2 goes green"*
  does not happen at 2.1. All seven cases reach `party` through `seedOccupancy`, which also writes
  `tenancy` and `tenancy_party`, so they clear at **2.2**. What this slice changes is the whole
  signal and is visible — **the pending diagnostic moved from `party` to `tenancy`, on all seven**.
  `tests/policy/fixtures.ts` needed **no edit**: its column lists came from the workbook, which is
  what the DDL was written from. The acceptance bar is enforced by an **exclusion constraint** rather
  than by application code — `EXCLUDE USING gist (channel WITH =, value WITH =,
  daterange(valid_from, valid_to, '[]') WITH &&)` over `btree_gist` — because "at most one party on
  any given day" is a statement about overlap, and the alternative is a rule every future writer has
  to remember. `'[]'` matches the join's own inclusive day-grained reading, and a null `valid_to` is
  unbounded, so an open contact blocks every later one. Two CHECKs sit beside it: `phone_is_e164`,
  because a number stored one way and asked for another resolves to nobody and that is
  indistinguishable from correct isolation; and `validity_is_ordered`, whose entire value is turning
  the `daterange()` constructor's unnamed **22000** into a named **23514**, which the red-first probe
  established rather than the commit message asserting it. **Proved on staging**, which is the one
  thing a local container could not do: `0006_` is the first migration since `0001` to add an
  extension, and `dona-staging-migrate-zxcqv` applied it against Cloud SQL as the runtime account
  before revision `00021-wh2` served — `{"ok":true,"version":"e3681ff","db":"up"}`. Seven rejections were proved red against
  the same DDL with only their own constraint removed; six were simply accepted and the seventh is
  the 22000 above. **Both remaining grep guards fired in this slice and neither was worked around.**
  Guard three could not see `party_contact.value` — a bare `value` on its list would fire on
  `config_settings.value` — so it learned **table-qualified names**, which is its own comment's rule
  ("a column this list misses is added to it when it is met") honoured rather than bent. Guard two
  fired on `validity_is_ordered`, its **first firing on work that was not a violation**: its pattern
  could not tell a comparison of `valid_to` against the other column of the same row from one against
  the day being asked about. Tightened so it says which it means, with the exception safe by
  construction — a comparison true of every well-formed row cannot express "valid on day D" — and
  the fix caught two bugs of its own on the way, a backtracking hole in the lookahead and this
  slice's own test file becoming the second copy the guard exists to catch. 259 tests on every merge,
  up from 238. **No natural key on `party`**, deliberately, and carried into 2.4 below.
- **Deps:** 1.9 · **Size:** M

### Slice 2.2 — Tenancy, TenancyParty, and the guarantor constraint
E7 and E8. `TenancyParty.role` ∈ tenant · co_tenant · guarantor · occupant, and
**`is_service_contact` is forced false for `GUARANTOR` by a database constraint** — no toggle, no
import path, no agent override.
- **Done when:** the insert is *rejected*, not defaulted politely.
- **Verify:** **policy case 3 goes green**, asserting the rejection; write it red first.
- **Owed by 1.7 — two things this slice has to supply.** The isolation join already carries
  `tp.is_service_contact`, so the constraint built here is *spent* at the front door rather than
  merely stored: the 1.7 case *"never resolves a guarantor to the unit they guarantee"* asserts it
  from the other side and goes green with the table. And **`Tenancy.terms_profile_id` is a NOT NULL
  foreign key in the workbook and is deliberately absent from `tests/policy/fixtures.ts`**, because
  `TermsProfile` is modelled nowhere yet — add it to the builder here, in one place, rather than in
  each case.
- **Closed 2026-09-06** ([evidence](evidence/2.2.md)). `0007_tenancy.sql` — E7 and E8's 12 columns,
  and a minimal `terms_profile` table beside them, because the workbook makes `terms_profile_id` a
  **NOT NULL** foreign key and a NOT NULL foreign key needs a target that exists. That is E1
  `project`'s move at 1.9 — identity now, fields when we know what they must carry — and it is
  deliberate that the column did not become nullable instead: which maintenance annex governs a lease
  is what the responsibility decision keys on, so a null there is a week-6 matrix with no input, and
  the cost is that the importer has to say which profile each lease is on. **Carried into 2.4 and
  2.5.**
  **The whole signal, and it is what this slice was for: all seven policy cases now assert.** Zero
  pending diagnostics, and the count still the same 26 as the day before — measured before this slice
  added its own four cases, because a case that stopped reporting pending and also stopped running
  looks identical in a green summary. That reading is no
  longer a human's job: `tests/policy/relations.test.ts` fails the build if any relation the suite
  declares is missing, which turns the warning 2.1 wrote down into a check. The pending branch itself
  stays, because weeks 5 and 6 write cases before their tables exist.
  **Policy case 3 was proved red against the real constraint**, dropped from the local database
  rather than only against a rebuilt DDL: the guarantor insert was **accepted and stored**, and the
  case failed on `actual: undefined`. Eleven further rejections were proved red against the same DDL
  with only their own constraint removed. Two findings the probe produced rather than the commit
  message asserting them: an inverted period on an **ACTIVE** row fails inside the exclusion
  constraint's `daterange()` as an unnamed **22000** — 2.1's finding, repeated — while the same row
  as **DRAFT** is simply *accepted*, because a partial index does not apply to it. So
  `tenancy_period_is_ordered` is both the thing that names the error and the only defence a non-active
  row has.
  **Two calls made here rather than deferred.** The workbook's *"no overlap allowed on one unit"* is
  an **exclusion constraint partial on `ACTIVE`** — blanket would reject correct history, because a
  `TERMINATED_EARLY` lease keeps its contractual `end_date` while `actual_move_out` records reality,
  and the next tenancy legitimately starts before it. And the natural key `(unit_id, start_date)`
  landed with the table rather than at 2.4: 1.9 shipped the estate spine keyless and 1.11 measured
  the cost in duplicate rows. **No index on `end_date`** — Q5 is 2.6's, decided at full row count.
  **Both firing guards were the slice's own comments, and neither was worked around.** Guard one
  fired on the forbidden column name written in prose — it is absolute, and a match in a comment
  fails as readily as one in DDL — and guard two on a comment *quoting* the tenancy-active predicate,
  which is the identical mistake 2.1's evidence recorded, caught again one slice later. Both were
  fixed by rewriting the comment.
  **The pending branch was hiding a broken fixture.** `seedUnit` inserted a second building at the
  same address, which 1.11's `building_address_unique` has rejected since week 1; it was invisible
  because the first `seedOccupancy` aborted the transaction on 42P01 before a second was attempted.
  The builder now shares one building, which is also the truer model — the neighbour in the isolation
  case lives next door. 279 tests on every merge, up from 259.
- **Deps:** 2.1 · **Size:** M

### Slice 2.3 — `src/scope/` — the isolation join, written once
The five hops, in SQL, before any model call. The current-occupancy VIEW (R6) alongside it:
`today ∈ [start_date, end_date]`, computed on every load.
- **Done when:** Q1 and Q2 from the workbook's ADMIN VIEWS sheet are each one query, and no other
  module contains the join's temporal predicate.
- **Verify:** **policy case 1 goes green**; grep guard 2 stays green with the join in exactly one
  file; guard 1 confirms no `current_tenant` column was introduced.
- **Owed by 1.7 — the join already exists; this slice finishes the module around it.** 1.7 landed
  `src/scope/internal/isolation-join.ts` and `contract.ts` because the policy cases could not be
  honest without them. Three things it deliberately did not build, all recorded in `SPEC-scope.md`:
  the **current-occupancy VIEW** in a migration, with the resolver reading it instead of the base
  tables; the **scoped-read audit line**, which `SPEC.md`'s security defaults require and
  `kernel/audit.ts` already supports — **re-confirmed as this slice's at 1.12**, which delivered
  access logging for the tier-2 corpus as a Cloud Audit Logs config on the bucket and could not
  deliver the application half, because a scoped read returns nothing until `party` and
  `tenancy_party` exist; and **E.164 normalisation at the edge**, because a number
  stored in one format and asked in another resolves to nobody, which looks exactly like correct
  isolation. Guard 2 matches the join's *predicates*, not its table names, so moving the join text
  into a view is a change it will notice.
- **Closed 2026-09-06** ([evidence](evidence/2.3.md)). **This entry's own Verify was wrong, in the
  way 1.9's and 2.1's were:** *"policy case 1 goes green"* happened at **2.2**, with the other six.
  What this slice proves is the stronger claim — the join moved off the five base tables and onto
  `occupancy`, and **all thirty policy cases stayed green with no file in `tests/policy/` edited**.
  `0008_occupancy_view.sql` carries **no temporal predicate, no status filter and no `CURRENT_DATE`**:
  the view is the shape and `internal/isolation-join.ts` is the rule. Three things force that and
  each is sufficient alone — a view cannot take `today` as a parameter and `CURRENT_DATE` inside one
  breaks the clock rule; `src/kernel/migrations/` is not `src/scope/`, so guard two scans it and a
  view holding the tenancy-active predicate fails the build, with adding the directory to the guard's
  exclusion list being how a guard dies; and what the guard protects is the decision about *when* a
  contact or a tenancy counts, which now has exactly one home. **The view very nearly defanged guard
  two.** Written first with the columns aliased — the natural thing for a view of two tables — which
  left the **canonical** join in `src/scope/` matching neither pattern, so every later copy would
  have passed. Caught by `tests/policy/guards.test.ts`, whose violating fixture has been the real
  join since 1.7, and fixed by keeping the base tables' column names rather than by widening the
  guard. **Two defects found by probes rather than by review.** Renaming the view out from under the
  resolver was supposed to prove it reads the view; it did, and it also showed the audit line written
  in a `finally` replacing a failed read's `42P01` with its own `25P02` on the poisoned transaction —
  which would have broken every pending policy case weeks 5 and 6 depend on. And the audit assertions
  were reading the whole table while `src/kernel/audit.test.ts` writes committed rows on a pool
  concurrently; each case names its own actor now. **The audit line records what was reached and
  never what was asked** — an Israeli mobile number has too little entropy for a hash of one to be
  one-way, so the inbound number belongs to the channel module's message log at week 9. E.164
  normalisation at the edge is proved load-bearing by removing it: a national number then resolves to
  nobody, which is indistinguishable from correct isolation. 297 tests on every merge, up from 279.
- **Deps:** 2.2 · **Size:** M

### Slice 2.4 — The importer
Idempotent, re-runnable, reports rejects rather than failing whole. Natural keys do the work —
`address_key` for a building, `(unit_id, start_date)` for a tenancy — so a re-run is a no-op instead
of a duplicate, with no caller-supplied intent key anywhere.
- **Done when:** running it twice changes nothing the second time, and a malformed row is reported
  with its line number instead of aborting the file.
- **Verify:** run, re-run, diff row counts; feed it a deliberately broken file.
- **Owed by 2.1 — `party` has no natural key, deliberately, and this slice gives it one.** 2.1 left
  it out for the reason 1.9 left `address_key` out and 1.11 vindicated: the obvious candidate is
  `national_id`, and it is the same trap the address was. A ת.ז. is nine digits **with leading zeros
  that every spreadsheet export drops**, so `042…` and `42…` are one person and a naive
  `UNIQUE (national_id)` is a key that disagrees with itself the first time the register arrives. It
  has to be `(party_kind, national_id)` at minimum — a ת.ז. and a ח.פ. are different registries and
  can be the same nine digits — and it is nullable, which is a third decision. Choose it here,
  against the export, and it costs a migration.
- **Owed by 2.3 — the importer normalises before it inserts.** `normalisePhone` is on `src/scope/`'s
  contract for this caller. A Priority export formatted for a spreadsheet is rejected row by row by
  2.1's `phone_is_e164` CHECK otherwise, and a bare nine-digit number is refused rather than assumed
  Israeli — a reject with a line number instead of a row that silently becomes another country's
  subscriber.
- **Owed by 2.1 — `is_primary` carries no uniqueness either.** "At most one primary contact per party
  per channel" is a plausible rule the workbook does not state; as a partial unique index it would
  fail an import that touches two rows in the wrong order, on a rule nobody asked for. Decide it here
  if the export contains the fact, and leave it out if it does not.
- **Owed by 2.2 — every imported lease names a `terms_profile`, and the column is NOT NULL.** Which
  maintenance annex governs a lease is what the responsibility decision keys on, so it may not be
  nullable and quietly absent. `terms_profile` also has **no natural key**, and the importer needs one
  to look a profile up idempotently — choosing it is the same question as *how many profiles are in
  force*, which is week 5's, so decide the key here against the export and leave the count to week 5.
  If the export names no profile at all, that is a question for the client raised now rather than
  discovered at week 6 by a matrix with no input.
- **Closed 2026-09-06** ([evidence](evidence/2.4.md)). `0009_import_natural_keys.sql` gives all three
  tables a key, and the argued one is `party.national_id_key` — a **generated column**, which is
  `address_key`'s technique applied to the identifier: an all-digit ת.ז. is left-padded to nine, so
  the leading zero every spreadsheet drops cannot make one person two, and `party_kind` is part of
  the key because a ת.ז. and a ח.פ. are different registries. It is null when the identifier is, and
  a UNIQUE index ignores nulls — so **the file format requires an identifier where the schema does
  not**, which is a question put to the client rather than an assumption made about them, and it is
  carried into 2.5 with the profile name beside it. **`src/register/` is a new module** and is in
  `SPEC.md`'s module map: it calls `normalisePhone`, so an importer inside parties or tenancy would
  have been the cycle `tenancy → scope → tenancy`, and it writes no SQL against a table it does not
  own — `src/parties/contract.ts` and `src/tenancy/contract.ts` exist from here with exactly the
  callers 2.1 and 2.2 predicted. **The savepoint per row was proved load-bearing by removing it**:
  the first database rejection poisoned the transaction, three later rows failed `25P02` including a
  good one, and every constraint name in the report collapsed into "rejected by the database" — which
  is precisely the count 2.5 exists to take. **Three probes, three findings review would not have
  made**: `ON CONFLICT` arbitrates before any index insertion, so the new unique key resolves a
  re-run and 2.1's exclusion constraint is never reached; the recycled-number case asserted the wrong
  thing and the database said so, because an `ENDED` tenancy resolves to **nobody**; and a fixture
  reusing another suite's phone number turned thirteen tests across five files into `40P01 deadlock
  detected`. **Guard three did not fire and should have** — `national_id_key` was not on its list,
  the second miss after `party_contact.value` at 2.1, and the list learned the name rather than the
  guard learning a pattern. `src/kernel/boundary.test.ts` now enforces the module boundary AGENTS.md
  has claimed since week 1 with nothing behind it. 326 tests on every merge, up from 297.
- **Deps:** 2.3 · **Size:** M

### Slice 2.5 — Import the real register
The Priority export into staging: 1,500 units, their tenancies and their parties.
- **Done when:** counts reconcile against the export and ten `resolveByPhone` spot-checks return the
  party the export names — including one party on two tenancies and one ended tenancy reading as a
  vacancy.
- **Verify:** the ten spot-checks, listed individually in the evidence file.
- **Owed by 2.6 — a register cannot express a vacant unit, and the export may contain some.** The
  file is one row per party on a tenancy, so an apartment with no lease at all has no row and does
  not reach the database. The generated register shows vacancies through ended and draft tenancies,
  which is what a real register does too — but if Priority's export carries empty apartments as
  rows, that is a format question answered here, with the export in hand, rather than a set of units
  silently missing from the portfolio.
- **Owed by 2.2 — the overlap constraint will reject rows, and how many is a fact about the client's
  data.** `one_active_tenancy_per_unit` refuses two ACTIVE tenancies overlapping on one unit, and a
  register with sloppy end dates will contain some. That is the intended direction — a reject with a
  line number rather than two households in one apartment — but the count is measured and recorded
  here rather than discovered on Wednesday. `(unit_id, start_date)` says the same thing about one
  lease typed twice.
- **Deps:** 2.4 · **Size:** M

### Slice 2.6 — Browse at portfolio scale
Buildings list, unit grid, search, and the occupancy chip — **derived on every load, never stored**.
- **Done when:** search across 1,500 units returns in under a second and Q5 (leases ending in the
  next 60 days, whole portfolio) is one indexed query.
- **Verify:** timed queries at full row count, recorded as numbers.
- **Owed by 2.3 — the occupancy chip calls `src/scope/`, it does not read the view.** `occupancy`
  carries no day predicate on purpose, so applying `today` inside `src/estate/` means writing the
  predicate there — a second copy, and guard two fires on it. `resolvePartiesInUnit` is the call.
- **Owed by 2.1 — one index to measure rather than assume.** `party_contact` has no btree on
  `(channel, value)`; the exclusion constraint's **GiST** index covers that lookup, and GiST is
  slower than btree at plain equality. That lookup is the first hop of the isolation join, which is
  the hottest query in the system once the agent is live. It is a few thousand rows today and the
  right moment to decide is at full row count with a timing in front of it, which is this slice —
  not at 2.1 on a hunch.
- **Owed by 2.2 — `tenancy` has no index on `end_date`, and Q5 is the query that wants one.** Left
  out at 2.2 on the same principle, and it is the *Done when* of this slice. `tenancy_unit` and
  `tenancy_party (party_id)` do exist, the latter because the composite primary key does not serve
  the isolation join's third hop.
- **Closed 2026-09-06** ([evidence](evidence/2.6.md)). **Both deferred index questions were answered
  and they went opposite ways**, which is what deciding with a timing in front of you looks like.
  `0010_scale_indexes.sql` adds `tenancy (end_date) WHERE status = 'ACTIVE'` — 53 buffers of
  sequential scan against two index pages, and the scan grows with every lease ever signed — and
  **does not** add the btree on `party_contact (channel, value)`: it is three times faster than the
  exclusion constraint's GiST index in isolation (0.009–0.017 ms against 0.031–0.062), and **with
  both present the planner chose GiST every time**, so it would be a write cost with a comment.
  Reopened at week 12, below. **Search is 2.35 ms against a bar of one second** at 1,500 units and
  Q5 is one indexed query; the volume came from a **generated register**, 37 buildings and 2,908
  rows, imported in **6.5 s with zero rejects** and re-imported in 6.0 s creating nothing — which
  also answers `SPEC-register.md`'s batching question in favour of keeping the savepoint per row.
  **The occupancy chip does not call `resolvePartiesInUnit`**: one call per card is 29.68 ms and
  sixty audit rows for a sixty-unit page against 0.94 ms and one, and the audit line is the bigger
  half. `GET /` stopped being a redirect, search and Q5 are screens, and **no name and no number
  reaches any of the five** — asserted from outside in `tests/ui/tokens.test.ts` rather than left to
  the views to remember. **Volume found what review would not have**: a generated register in the
  development database turned three suites red on `terms_profile_natural_key`, because 2.4
  namespaced its cities, its phone block and its identifiers and then named its maintenance annexes
  what a real register will name them. 346 tests on every merge, up from 326.
- **Deps:** 2.4 · **Size:** M

> **Cut line:** the obligations strip and the compliance tab — both are month two. Do not cut 2.3.

---

## Week 3 · Sun 20 – Thu 24 Sep — Documents filed against units

> **Started 2026-09-07**, the day week 2 closed, rather than on the planned 20 Sep. **Closed
> 2026-09-07** ([evidence/week-3.md](evidence/week-3.md)): demo off staging, four-second bar timed
> by the owner, management blessing to proceed. 3.4 stayed deferred. The planned dates above are
> not rewritten; the gap is the record of how the project ran.

**Demo kind:** Software · **You show:** pull a real lease off the Drive, then find it again in four
seconds. Hashed, dated, attached to unit and tenancy, immutable. Nothing is read yet — this is a
filing cabinet with a search box, and it is already a business win over the status quo.
**Depends on:** the Google Drive access fuse. **Governed by:** A8 — capture is open, promotion is
governed; A9 — the catalogue is dynamic now, its screen is month two; A10 — in bulk, convention
proposes and a human confirms.

> **Amended 6 Sep 2026 — the week no longer depends on F4.** The planned text above is kept because
> the dates and the plan of record are not rewritten; this note is what actually governs the week.
> **Intake is an administrator declaring a type and uploading a file** ([SPEC-flows.md](../SPEC-flows.md)
> flow A1), not a crawl of someone else's Drive, so nothing here waits on Google Drive access and the
> demo is given on tier-1 specimens. **A10 and slice 3.4 are deferred, not deleted** — bulk becomes
> meaningful at step 4 of the method, when volume arrives. **Documents are uploaded against a
> tenancy** (new or upcoming), and the tenancy hangs on the unit; a lease is therefore the *origin* of
> a draft tenancy rather than an attachment to one somebody typed first. The extraction that makes
> that true is week 4's, so week 3 ships the filing cabinet and week 4 makes it write.

### Slice 3.0 — Workbook pass: the document-schema catalogue
**Spec before code.** The workbook is the specification for month one's tables and it currently has
`Document` at eight fields with no catalogue behind it. Add **E15 `DocumentType`** and **E16
`DocumentTypeField`** with **R17** and **R18** — appended, never inserted, because R1–R16 are cited
in the frozen Hebrew file. Edit `build_model.py` and re-run it; the `.xlsx` is a build output. The
Hebrew workbook stays frozen unless asked.
- **Done when:** the FIELDS sheet specifies every column of both new entities, and the DECISIONS
  sheet carries A8 as the rule it creates and why that rule holds.
- **Verify:** re-run the generator; relationship numbers R1–R16 unchanged; open the workbook.
- **Closed 2026-09-07** ([evidence](evidence/3.0.md)). E15 · E16 · R17 · R18 · A8, all appended, and
  the append-only claim is **measured rather than asserted**: the committed `.xlsx` regenerates
  cell-for-cell from `build_model.py` before the edit, so the diff is against the artifact and not
  against my own baseline. R1–R16 identical cell for cell, E1–E14 and D1–D6 identical, and **exactly
  three FIELDS rows changed**, all on E12 and both changes forced rather than chosen:
  `type_key` (enum of nine) → `document_type_id` FK, and `sha256` → **`file_hash`**, because
  [SPEC-flows.md](../SPEC-flows.md) A1 already named it that and two specs disagreeing on a column
  name is a defect 3.1 would inherit. A8 keeps **its own number** in a sheet otherwise numbered D1–D6
  rather than becoming a D7 — one decision, one name, however many files cite it — and the READ ME
  now says the sheet carries two namespaces. **Two calls the acceptance bar did not ask for and the
  catalogue forces.** `DocumentType.verification_terms` exists because 3.3's guard has to read the
  markers off the type row; in code, a new type would arrive with no guard until the next release,
  and A8 would be true of the catalogue and false of everything that uses it. And there is
  deliberately **no `promotes_to` column** anywhere in E15 or E16, because a promotion target as a
  row makes promotion a row — 4.3's `FieldPromotion` is where that mapping lives, at the cost of a
  migration, which is the whole of A8's governed half. Raised and owned: the seed is **nine** types
  and not eight (3.1), `DocumentTypeField` versioning collapses 4.2's `type_field_id` and
  `schema_version_id` into one column (4.2), and E12 still lacks the published Data Model's `state`,
  `superseded_by`, `tenant_visible` and `uploaded_by` (3.1).
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
- **Owed by 3.0 — the seed is nine types, not eight, so the bar above is the *tenth*.** The eight
  named in the Data Model's `DocumentSchema` are `lease · lease_amendment · termination_notice ·
  arnona · insurance · id · bank_guarantee · handover_protocol`; the workbook has carried
  `inspection_certificate` as a ninth since 3 Sep because SAFETY assets and the compliance tab need
  it, and 3.5 needs it this week. Holding a type the system already requires out of the seed to make
  a demonstration land on the number nine would be a knowingly incomplete seed. Seed nine, prove the
  mechanism on a tenth in a test, and say so in the evidence.
- **Owed by 3.0 — two column names are settled and must not be re-decided.** `Document.type_key` is
  gone: it is `document_type_id`, a foreign key to E15 (R17). And the hash column is **`file_hash`**,
  not `sha256`, matching [SPEC-flows.md](../SPEC-flows.md) A1. Both are in the FIELDS sheet.
- **Owed by 3.0 — E12 is narrower than the published Data Model and this slice decides whether that
  stands.** `docs/data-model.html`'s `Document` carries `state`, `superseded_by`, `tenant_visible`
  and `uploaded_by`; the workbook's E12 carries none of them. A column is either in the first DDL or
  it costs a migration later, so this is decided here rather than discovered. With 3.4 deferred and
  the type declared rather than detected, figure 5's review-queue states collapse to almost nothing —
  but supersession is real the moment an addendum lands (flow A3, week 4), and `tenant_visible` is
  real the moment a tenant can see a document (week 9). Decide each, in the evidence, with a reason.
- **Closed 2026-09-07** ([evidence](evidence/3.1.md)). `src/kernel/migrations/0011_evidence.sql` —
  E15, E16, E12 and E13, the catalogue before the document that points at it, with every column the
  FIELDS sheet specifies and no others — plus `src/evidence/` (catalogue commands, `ingestDocument`,
  `linkDocument`) and the nine-type seed. **The seed is data and not a migration, and that is what
  makes the acceptance bar true rather than aspirational**: nine types in a backfill file would have
  made the tenth a migration too. The bar is proved on a **tenth** — a ועד בית agreement with four
  fields, added through `applyDocumentTypeCatalogue`, the same function `npm run seed:doctypes`
  calls — with `information_schema.columns` snapshotted either side of it and asserted identical,
  because *no DDL was needed* is a measurement and not a reading. 19 tests, **325 code + 41 hooks
  green**, **nine constraints proved red first**, SQLSTATEs in the evidence.
  **All four of the published Data Model's extra `Document` columns are omitted, each with its own
  reason** rather than as a batch: `state` because figure 5's states are the deferred review queue's
  (**carried to 3.3**, which meets figure 4's "REJECTED is a state, not a deletion" head-on);
  `superseded_by` because SPEC-flows.md invariant 2 already made supersession a fact about *values*,
  and a re-issued document is answered by `valid_from`/`valid_to` (**week 5**); `tenant_visible`
  because a per-row boolean deciding what a tenant may see is a **second access control standing
  beside the isolation join**, which is the shape foundation rule 1 forbids (**week 9**); and
  `uploaded_by` because there is no authenticated actor until week 5 and a provenance column holding
  a placeholder for six weeks is worse than one that arrives with the identity it names (**week 5**).
  **Two calls beyond the bar.** The first trigger in this repository, `document_is_immutable`,
  because "`file_hash` at ingest, immutable thereafter" is otherwise a comment and 2.1's principle is
  that the claim is what the database refuses; and `UNIQUE (file_hash)`, which puts *the same file
  ingested twice is one document with two links* in the schema rather than in a caller that could be
  written differently next month. Guard three fired zero times, and three `-- not-pii:` sentences
  were written anyway on the catalogue columns that **name** personal data without holding it.
  **Flagged to the director, owned by no slice:** the published Data Model now differs from the
  schema in those four columns and in the name (`DocumentSchema` is `DocumentType`). Republishing a
  client-facing document is a promise to the client.
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
- **Closed 2026-09-07** ([evidence](evidence/3.2.md)). The path is
  `gs://<bucket>/<place kind>/<place id>/<type key>/<file hash>.<ext>`, built in
  `src/evidence/internal/storage-path.ts` because the kernel's store is handed paths and never
  invents one. **The headline rule is enforced by type rather than by care:** `PlaceKind` is four of
  `DocumentLink`'s eight kinds — `TENANCY`, `PARTY`, `ASSET` and `OBLIGATION` are absent — so a lease
  cannot be filed under a signatory's id, and the rule holds on the way back out as well, because a
  hand-edited `storage_uri` is the case that matters. Every input is validated and none sanitised.
  The leaf is the `file_hash` and not the `document_id`, which makes the object write idempotent on
  the same column `ingestDocument` already is. `storage_uri` holds `gs://<bucket>/…` and a read
  **refuses a bucket that is not the configured one**, so a database cloned from staging cannot walk
  a laptop into another environment's documents. **The delete refusal holds twice and was proved
  both ways:** `ObjectStore` has no `delete` method (asserted in a test), and `src/docs-probe.ts`
  goes around the missing method with a raw `DELETE` carrying the store's own token, as
  `app-staging`, and records the 403 — with the write and the read in the same run as the positive
  control, which is 1.5's lesson that a denial with no accompanying success is not evidence. **Three
  things found while reading and fixed here:** `DOCS_BUCKET` had been injected by `deploy.yml` since
  1.6 and read by no code, so `SPEC-kernel.md`'s "reported at boot" was a claim and a revision on the
  memory store was invisible — `src/serve.ts` now prints it; `objects.ts` cited `SPEC-occupancy.md`,
  a v3 filename that has never existed here; and the docs bucket's **soft-delete window was a vendor
  default nobody had chosen** — 1.5 raised it, and it is now set explicitly to 7 days, which is the
  opposite call from the corpus bucket's cleared window at 1.12 and for the opposite reason. **A
  fourth, in the same file:** `bootstrap.sh prod` had stopped working entirely — a STOPPED Cloud SQL
  instance answers *Invalid request since instance is not running* to both `databases describe` and
  `databases create`, so the describe-or-create pair failed and `set -e` killed the run before the
  service accounts, the bucket and the WIF binding, none of which need the instance. That is 1.5's
  own cost lever biting 1.5's own script: stopping `dona-prod` until week 12 quietly made
  *idempotent, safe to re-run* false for prod, and the slice that discovered it is the one that
  needed to reapply a bucket control there. The state is now checked rather than inferred from an
  error, and a stopped instance skips the database step **loudly** and lets the rest of the run
  finish. Both docs buckets carry the four controls, prod included. Raised
  and owned: the ingest ordering rule (3.3) · signed URLs are not 3.6's (3.6) · the bucket's legacy
  `projectEditor` delete (week 8).

### Slice 3.3 — Declared-type upload, with a verification guard
The interactive path: the flow already knows what it asked for ("upload the lease for unit 14"), so
**type is declared, not detected** and classification — the riskiest ingestion step — simply does not
exist. What remains is the cheap guard for the real error: right slot, wrong file.
- **Done when:** uploading an ארנונה bill into the lease slot is caught before it is filed.
- **Verify:** the wrong-file case, both directions, against tier-1 specimens.
- **Owed by 3.0 — the guard reads the catalogue, not a map in TypeScript.**
  `DocumentType.verification_terms` was added at 3.0 for exactly this: the marker terms a document of
  a given type is expected to contain live on the type row, so a type added as a seed row arrives
  with its own guard. A `Record<TypeKey, string[]>` in code would mean every new type ships unguarded
  until the next release — A8 true of the catalogue and false of the first thing that consumes it.
  **Landed at 3.1**: the column exists, is nullable, is seeded on all nine types, and
  `listDocumentTypes` on `src/evidence/contract.ts` is what reads it. Nothing is owed; the input is
  there.
- **Owed by 3.1 — does a wrong file caught at the door leave a row behind it?** 3.1 decided E12
  carries **no `state` column**, because figure 5's `RECEIVED → EXTRACTED → ACCEPTED / REJECTED` is
  the review queue's state machine and the queue is 3.4, deferred with F4. But figure 4's caption
  says **"REJECTED is a state, not a deletion — the wrong file is evidence too, of what someone tried
  to file and when"**, while this slice's own bar says the ארנונה bill is *caught before it is
  filed*. This is where the two meet. Either a caught upload is refused and unrecorded — figure 4's
  caption being a statement about the bulk queue that does not bind the interactive path — or it is
  filed as evidence of an attempt, which costs `state` and therefore a migration. Decided here, with
  a reason, rather than by drift.
- **Owed by 3.2 — the ingest order, and it is not the obvious one.** Hash the bytes → look the hash
  up → `put` the object **only when no document already holds it** → `ingestDocument`. Hashing first
  is what makes the path computable before anything is written, and looking up before putting is
  what stops the same bytes filed against a second place writing a second copy of one file.
  `ingestDocument` excludes `storage_uri` from its update path, so the first path filed stays
  authoritative whatever a later caller computes. The path is built by `documentObjectPath` from
  `src/evidence/contract.ts` and **never by string concatenation** — the whole convention is that
  every segment was validated rather than assembled — and the file types the screen accepts are
  `documentExtensions` from the same module, not a second list in the upload handler.
- **Deps:** 3.1, 3.2 · **Size:** M
- **Amended 6 Sep 2026 — this slice implements flow A1, and the upload binds to a tenancy.** The
  screen asks for the unit and the type as written, and then for the **tenancy** the document belongs
  to: an existing one, or a new draft. A draft is never an empty shell — it needs unit, dates and at
  least one tenant, all three of which come out of the lease — so at this slice the draft path is
  *declared by the administrator* and week 4's extraction takes it over. The content cross-check
  (does the address on the document match the unit it was filed against) needs extraction and lands
  with week 4, not here; what ships here is the cheap type guard above.
- **Closed 7 Sep 2026** ([evidence](evidence/3.3.md)). `GET /documents/new` and `POST /documents`,
  **the first write route in this system** and one without a session, so the bounds that stand in for
  one until week 5 are stated and applied: one file, 20 MB, four kinds **sniffed from the bytes and
  never from the name**, the filename discarded, nothing personal in the response, and **no CSRF
  token on purpose** — a token defends a session's authority and there is none, so week 5 owes both
  halves in one change. The verify step sits **before the lookup and before the put**, because
  *caught before it is filed* is a claim about writes. **3.1's open question is decided: a refused
  upload leaves no row.** Figure 4's caption binds the bulk queue — 3.4, deferred, where nobody is
  watching — and not the interactive path where an administrator is looking at the screen; what is
  kept of it is *what someone tried to file and when*, as an `audit_log` line carrying the digest,
  the declared type, the verdict and the missing terms, and never a filename. **All of a type's
  marker terms must match, not any one**: the lease says ארנונה, in the clause about the utilities,
  so a single-term guard would have filed a lease as a bill and called it verified. A file with no
  text layer is `unverified` rather than refused. 24 new tests, **369 code + 41 hooks green**, the
  policy case **red first** — and it caught two seeded types whose terms had been written from the
  *name* of the form rather than its printed language, fixed as seed rows rather than as a release,
  which is what a guard reading the catalogue buys. Verified against the tier-1 specimens **printed
  to real Hebrew PDFs and read through the real pdfjs adapter**, both directions, 422 each way, plus
  dedupe, an image and a file of no known kind. **`infra/docs-delete.sh` was added on review** — the
  application still has no `delete` and the runtime account still has no `objectAdmin`, and what the
  script writes down is the act 3.2 already proved a human with owner credentials can perform, so
  clearing a staging bucket of specimens is one reviewed command rather than an improvised one. It
  refuses prod with any flag, takes the bucket's own name as confirmation, and leaves the seven-day
  soft-delete window alone — the opposite assertion from `infra/corpus-delete.sh`, and for the
  opposite reason. Raised and owned: the `unverified` backlog (4.1) · a tenancy created from a lease
  (4.2 / A2) · session **and** CSRF together (week 5) · the documents panel (3.6) · **the anonymous
  upload route's unbounded request count (week 5)** — 20 MB bounds a file and nothing bounds a
  caller.
  **Staging-verified 7 Sep 2026** on revision `dona-staging-00039-hps`: seven requests, both
  refusals at 422 with the right missing terms, the zip at 400, and **three successful filings
  leaving two objects in `gs://dona-v5-staging-docs` while the two refusals left none** — which is
  what makes *caught before it is filed* a statement about a bucket rather than about a status code.
  The lease filed against a second flat added a link and wrote nothing, with the object still under
  the first flat's path. Every request carried the filename `שכירות כהן.pdf` and it appears in no
  response, no path and no log. **The boot line stopped being cosmetic here:** before this slice a
  revision on the memory fallback was merely mislabelled, and from 3.3 it would accept a document,
  report it filed, write a `storage_uri` and hold the bytes in a process that scales to zero.

### Slice 3.4 — Drive ingestion, and the bulk review queue — **DEFERRED 6 Sep 2026, not deleted**
Moved out of week 3 to the pilot-preparation step of the method, with **A10** and with **F4**. Bulk is
the right mechanism for volume and volume is step 4's; nothing about the design below is withdrawn,
and the confidence-ranked queue in particular is what makes bulk safe when it runs. Two consequences
that must not be lost with it: **3.6 no longer depends on this slice** (re-pointed to 3.3), and the
published-forms item below still has to happen — it is F4's other purpose and it is now owed at the
step where F4 is lit rather than here.

Copy and hash at ingest; keep `drive_file_id` as provenance and the folder path as a **hint that
pre-fills a binding**. The path is never itself the binding — if isolation resolved through a folder
name, someone tidying Drive on a Tuesday would break the client's absolute constraint. The bulk form
of A10: convention **proposes** a type and a binding, the guard checks the file matches the slot, and
a **confidence-ranked review queue** puts a human between the proposal and the filing. The obvious
ones clear in bulk; the ambiguous ones get looked at.
- **Owed by 1.12 — the published forms themselves.** Tier 1 is committed as Hebrew text authored to
  the published forms' structure, not as copies of the PDFs (`docs/corpus/README.md` says why). This
  is the first slice with **F4** lit and an ingestion path in front of it, so the actual published
  דירה להשכיר lease, פרוטוקול מסירה, ערבות בנקאית, ארנונה and אישור קיום ביטוחים come in through it
  and sit **beside** the authored text rather than replacing it — the authored clauses are what the
  ranking ratchet is set against, and swapping the substrate under a ratchet silently re-baselines
  it. Committing a published PDF to the repository is the director's call, not this slice's.
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
- **Owed by 2.4 — a register-imported building's handover dates are placeholders, and this is the
  document that corrects them.** The register format carries no handover date, so
  `building.handover_date` and `warranty_end_date` are written from the lease dates by the importer
  (`src/register/internal/importer.ts`, stated there rather than left to look like data). תקופת הבדק
  starts at handover and not at a letting, and `warranty_end_date` is what makes responsibility
  ternary — so a building imported from a register and never touched by a handover protocol carries a
  warranty window that is a guess. **Correct them here, and say in the evidence how many buildings
  had one.** **2.6 made it visible**: at 1,500 units every building card on `/estate` shows a
  מסירה date that is one of its leases' start dates, because the last row of a building wins the
  upsert. It was left uncorrected on purpose — this document is what brings the real fact, and a
  better-shaped guess in week 2 is work week 3 deletes. The same applies to `PARKING` and `STORAGE` spaces: a register row implies exactly one
  `UNIT` space, and bays and storage rooms (workbook D3) arrive with this document.
- **3.1 left both dependencies in place**: `document` is a table `Asset.source_document_id` can point
  at, and `handover_protocol` is one of the nine seeded types, declaring `handover_date` and
  `apartment_number` — `handover_date` being the one field that turns the placeholder מסירה dates on
  every building card into a fact.
- **Deps:** 3.1, 1.9 · **Size:** M
- **Closed 2026-09-07** ([evidence](evidence/3.5.md)). `0012_assets.sql` then `0013` for the natural
  key. Q3 and Q7 each one query against the Shoham fixture. Flow A6: two protocols, tenth type a
  seed row, confirm recomputes from stored bytes. Placeholder count: **2/2** and **37/37** register
  buildings, **0/1** fixture. **384 code + 41 hooks + 44 policy.** Raised and owned:
  parking/storage on `upsertUnitRow` (week 4 / A2) · inspection-date index
  (measurement) · A2's staging shape (week 4).

### Slice 3.6 — Find it in four seconds
Document search and the documents panels on the building and unit screens, grouped by type.
- **Done when:** a named lease is on screen within four seconds of deciding to look for it.
- **Verify:** timed, by the owner, on staging.
- **Owed by 3.2 — the panel shows a path, never a link to the bytes.** `document.storage_uri` is a
  `gs://` uri and nothing in this system mints a signed URL. A signed URL is a bearer token for one
  object: whoever holds the string reads the document, isolation join or not, so issuing one is a
  decision that belongs behind a session, and sessions are week 5's. Until then the panel renders
  what is filed — type, dates, ingest date — which is also the shape `tests/ui/tokens.test.ts`
  already enforces: a state and a count, never a name.
- **Owed by 3.3 — the panel has to show the verdict, not only the type.** A filed document is
  `verified`, `unverified` or `unguarded`, and a scan nobody has read yet must not look identical to
  a lease whose marker terms were all found. The confirmation screen says it in words already; the
  panel is where it becomes a property of a list.
- **Owed by 3.5 — `upsertUnitRow` still writes only a `UNIT` space.** Register-imported buildings
  have no `PARKING` or `STORAGE` rows. The Shoham fixture already has 60 bays and 40 rooms; a
  protocol cannot land a gate motor on a bay that does not exist. **Not closed here** — rides into
  week 4 with A2.
- **Deps:** ~~3.4~~ **3.3** — re-pointed 6 Sep 2026 when 3.4 deferred. Documents reach the system
  through flow A1's admin upload, so search has something to find without any bulk path existing.
  **Landed 7 Sep 2026**: the upload route files them and `document_link` binds them to a unit and,
  when one was chosen, to a letting. **Size:** S
  **Closed 2026-09-07** ([evidence](evidence/3.6.md)). `verification_verdict` on E12, workbook first,
  CHECK/NOT NULL red first. Search extended not forked. Thin unit page. Path is text. **396 code +
  41 hooks + 44 policy.** Staging `00042-dml` at `6ff6e8f`. **Owner timed the four-second bar at
  the week-3 demo the same day** ([evidence/week-3.md](evidence/week-3.md)) — discharged there, not
  in the slice file.

> **Cut line:** the compliance tab's visual treatment (the query is what matters this week), and the
> review queue's bulk-approve affordance — one-at-a-time confirmation still proves the design. **Do
> not cut 3.0** — a migration written ahead of the workbook is the anti-pattern this project already
> named.

---

## Week 4 · Sun 27 Sep – Thu 1 Oct — The machine reads a lease, and shows its work → **M1**

> **Started 2026-09-07**, the day week 3 closed, rather than on the planned 27 Sep. The planned
> dates above are not rewritten.

**Demo kind:** Software, with an Evidence number attached · **You show:** drop in a real Hebrew lease.
Rent, dates, parties and clauses appear as fields. Click any value and the page image scrolls to the
pixels it came from, with a confidence score.

> **Amended 6 Sep 2026 — this week gains flows A2, A3 and A4, and it is where extraction starts
> writing.** Reading a lease is not the end of the story; the fields it yields have to land somewhere,
> and [SPEC-flows.md](../SPEC-flows.md) says where. Three slices are owed here beyond 4.1 and 4.2,
> **sized 7 Sep 2026 at week 3's close** as **4.6 (A2) · 4.7 (A3) · 4.8 (A4)**:
>
> - **A2 — a lease establishes a draft tenancy.** Extract → propose → **confirm** → write. Unit,
>   dates and every tenant named on the lease (two signatories per household is normal, not an edge).
>   **Role is confirmed by a human before any `tenancy_party` row is written**: `is_service_contact`
>   is forced false for GUARANTOR by a database constraint and the isolation join spends it, so a
>   guessed role is an isolation defect and not a typo. Parties are created **under the tenancy the
>   document was uploaded to**; no cross-tenancy identity matching, which is month two. Carries 3.3's
>   deferred content cross-check — the address and apartment on the document asserted against the
>   unit the tenancy hangs on — **and 3.3's deferred draft-tenancy path**: the upload screen binds to
>   an existing letting or to the flat alone, because declaring a draft needs at least one tenant and
>   that is a person's name typed into a page anybody can reach until week 5. Here the dates and the
>   parties come out of the document instead, which is the reason the path was deferred and not cut.
> - **A3 — an addendum completes a tenancy.** No special case, by construction: **fields live on the
>   tenancy and documents are provenance**, so an addendum arriving with the lease and one arriving
>   six months later travel the same path. Later document wins; the earlier value is retained and
>   visible, because both provenances are recorded.
> - **A4 — the incomplete-tenancy queue**, and the rule it exists for: *a tenancy must have at least
>   one guarantor*. A **policy case over saved rows, written red first — never a NOT NULL**, because
>   a requirement the database rejects is one no addendum can ever satisfy. Guarantors are frequently
>   absent from the lease itself; extraction returning zero of them is a correct result and must not
>   error, retry or guess.
>
> **A9's per-field provenance is the load-bearing decision** under all three, and it is what makes the
> addendum case arithmetic rather than architecture.

### Slice 4.1 — Document AI OCR adapter
The **general OCR processor, not Form Parser** — the schema is already declared, so Google needn't
infer structure, at roughly a twentieth of the cost. Hebrew print and handwriting, word boxes,
per-word confidence.
- **Done when:** a scanned Hebrew lease yields word-level boxes and confidences, and the residency
  position is recorded in the evidence file rather than assumed.
- **Verify:** boxes rendered over the page image for one document; a scan and a native PDF both
  handled.
- **Owed by 3.3 — `unverified` is a backlog with no reader.** A file with no text layer is filed and
  marked *not checked*, because refusing every scan would refuse most real leases. Nothing goes back
  over those documents until this slice: verify the declared type against the OCR text at extraction
  time, and say in the evidence **how many already-filed documents the sweep changed the verdict of**.
  The count is on the `evidence.file_document` audit lines, whose `inputs.verdict` is `unverified`.
- **Owed by the week-3 demo — a heavy signed-lease PDF must not become an uncaught 503.** Pre-demo
  on staging, a real-looking signed lease against דירה 4 of בניין האלון 12 ground for about a minute
  and returned `{"code":"unavailable","message":"unexpected error"}`. The unit was fine; pdfjs on
  that file was not. Bound the reader (time and memory). Fail closed as `invalid` or file as
  `unverified`. Record the bound in the evidence.
- **Deps:** ~~3.4~~ **3.3** — re-pointed 6 Sep 2026 when 3.4 deferred. The adapter needs a document in
  the bucket, which A1's upload supplies; it never needed the bulk path. **Size:** M
- **Closed 2026-09-07** ([evidence](evidence/4.1.md)). General `OCR_PROCESSOR` in **`eu`**, not Form
  Parser, not `me-west1` — Document AI does not serve that region. Processor
  `bd23faa1bd256c46` (`dona-ocr-staging`), default version `pretrained-ocr-v2.1-2024-08-07`, the same
  pin `0016_ocr_settings.sql` seeds. REST + ADC, no Document AI SDK. Two readers, one page shape:
  pdfjs bounded at **8s** (empty pages, never `unavailable`); Document AI bounded at **20s**, on the
  same request after the row exists. Live against `eu-documentai.googleapis.com` as the operator
  account: native PDF **1978ms**, word `Shkirot` at confidence **0.985**, page PNG 20 576 bytes;
  image-led PDF **870ms**, no words, page PNG 17 323 bytes; 1×1 PNG **1467ms**, one page image. HTTP
  of an OCR miss is **200 unverified**, not 503. Overlay is `GET /documents/:id/read`. Sweep locally
  **examined 1 → verified 1**. Staging sweep of the week-3 backlog waits on the revision that carries
  this slice — owned at 4.2, not left behind. **412 code + 41 hooks**, policy 44, no new runtime
  dependency.

### Slice 4.2 — Comprehension into the declared schema — **the open half of A8**
The model maps OCR output into the fields **that document type's schema declares**, read from
`DocumentTypeField` at run time rather than from code. **Two engines, deliberately:** a language
model asked for coordinates produces plausible coordinates; an OCR engine measures them. Output is a
generic `ExtractedField` row per value — `(document_id, document_type_field_id, value, page, bbox,
confidence, model)`. **No `schema_version_id`.**
- **Done when:** adding a field to a document type and re-running extraction produces that field,
  with **no code change and no migration** — and every value's `(page, bbox, confidence)` came from
  the OCR engine, never from the model.
- **Verify:** add a field to a specimen type mid-test and re-extract; a contract test asserts no bbox
  in the system originates from a model response.
- **Closed 2026-09-07** ([evidence](evidence/4.2.md)). Pointer-only FK; extra field mid-test; fake
  model bbox ignored. **419 code + 41 hooks**, policy 44. Staging sweep of week-3 unverified rows
  did not run (no serving revision) — owned at 4.3.
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
- **Owed by 4.1 / 4.2 — staging sweep of `unverified`.** After the reader serves, `ocr:sweep` as
  `app-staging`; write the count (zero is a count).
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
- **Owed by 1.12 — every control this slice needs already exists, and the data does not.** The bucket,
  its 90-day lifecycle rule, the deletion path and the storage audit config landed at 1.12 and have
  been exercised; what did **not** land is the corpus, deliberately, because **F6**'s other half is
  owed before real tenant documents arrive — and that half is now three named acts: OpenAI's DPA,
  confirming Google Cloud's, and publishing the notice to data subjects
  ([fuses.md](fuses.md) → *F6 in detail*). This slice cannot start until the director has taken delivery, and the arrival and removal
  dates go on [fuses.md](fuses.md) the day it happens, not the day this slice is written up.
- **Done when:** a per-field accuracy table exists with its sample size, its failure modes named, and
  a stated removal date for the source documents.
- **Verify:** the run is reproducible from a script, and the numbers are in `tasks/evidence/`, never
  in a document as an assertion.
- **Deps:** 4.4, 3.2 · **Size:** M

### Slice 4.6 — A2: a lease establishes a draft tenancy
Extract → propose → **confirm** → write. Unit, dates, and every tenant named on the lease (two
signatories per household is normal). **Role is confirmed by a human before any `tenancy_party` row
is written.** Parties are created under the tenancy the document was uploaded to; no cross-tenancy
identity matching. Zero guarantors is a correct result.
- **Done when:** a confirmed proposal writes a `DRAFT` tenancy with per-field provenance; the address
  and apartment on the document are asserted against the unit; a mismatch is refused and writes no
  party.
- **Verify:** two-signatory specimen writes two tenants; guarantor-absent specimen writes none and
  does not error; wrong-address case refused.
- **Owed by 3.3 — the content cross-check and the draft-tenancy path.**
- **Owed by 3.5 — `upsertUnitRow` still writes only a `UNIT` space.** Register-imported buildings
  have no `PARKING` or `STORAGE` rows. Close it here so A6 can land on a bay. Also A2's staging
  shape, recorded rather than invented in the slice.
- **Deps:** 4.3, 3.3, 3.5 · **Size:** M · plan mode first (estate · parties · tenancy · evidence)
- **Sized:** 7 Sep 2026, week 3 close.

### Slice 4.7 — A3: an addendum completes a tenancy
No special case: fields live on the tenancy and documents are provenance. Later document wins;
earlier value retained and visible.
- **Done when:** a guarantor named in an addendum becomes a `tenancy_party` under the existing
  tenancy, and a later date overwrites an earlier one without deleting the earlier provenance.
- **Verify:** addendum after a lease, same path as 4.6; both provenances on screen.
- **Deps:** 4.6 · **Size:** S
- **Sized:** 7 Sep 2026, week 3 close.

### Slice 4.8 — A4: the incomplete-tenancy queue
The rule: *a tenancy must have at least one guarantor*. A **policy case over saved rows, written red
first — never a NOT NULL**.
- **Done when:** a tenancy that extraction returned with zero guarantors appears in the queue showing
  what is missing; an addendum (4.7) or a recorded exception clears it.
- **Verify:** policy case red first; lease with zero guarantors in the queue; A3 removes it.
- **Deps:** 4.7 · **Size:** M
- **Sized:** 7 Sep 2026, week 3 close.

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
| **5** | Real data | **Paper becomes truth.** An amendment arrives for a real unit; the tenancy updates; the change log records old → new, who approved it, which document caused it. Then a tenancy ends because a date passed, with no document at all. | Promotion at scale · tenancy reconciliation · `TenancyEvent` · Obligation + ObligationType (E9, E10) · **the settings screen: the `ObligationType` and `DocumentType` catalogues, admin-managed at last (A9) — one screen, one pattern, and `asset_type` deliberately absent from it** · staff MFA and the `national_id` field guard — **owed by 1.11, widened by 2.6:** `/`, `/estate`, `/estate/buildings/:id`, `/estate/search` and `/estate/expiring` have been served **unauthenticated** since week 1, deliberately and on fixture data; this is the slice that puts them behind a session, and nothing may put a real party, contact or document behind those routes before it does. **Widened again by 3.3:** there are now two *write* routes as well, `GET /documents/new` and `POST /documents`, and they carry **no CSRF token** — deliberately, because a token defends a session's authority and there is none, so an anonymous caller can already post directly. This slice owes both halves in one change: the session, and the token that then means something. Until it lands, the bounds standing in for one are one file, 20 MB, four kinds sniffed from the bytes, the filename discarded and nothing personal in the response — **and this slice owes the bound none of those are: there is a cap per request and no cap on requests**, so an anonymous caller can fill a versioned bucket the application cannot empty. Raised on review at 3.3, where it was judged not to block a staging URL serving tier-1 specimens with `infra/docs-delete.sh` beside it; a session is what actually closes it, and a per-caller limit is the second half of the same change. Until it does, every one of the five shows **a state and a count and never a name** — the occupancy chip, and a search that covers buildings and units and never `party` — which is asserted from outside in `tests/ui/tokens.test.ts`. **This is the slice that may lift that rule**, and it is also where the root index moves from `src/estate/` to the composition root, because week 5 is when a second *module* has a screen and an index of screens is not estate's fact — **owed by 1.5:** `infra/bootstrap.sh` deliberately creates no staff seed secrets, so whatever this mechanism needs in Secret Manager is created here, by the slice that knows what it is · **owed by 1.7:** `national_id` never appearing in the response shape of an agent tool is a policy case, not a review — deterministic, so it belongs in `tests/policy/` beside the isolation cases  · **owed by 3.1 — two columns of E12 held for this week.** `uploaded_by` could only have held a placeholder until an authenticated actor existed, and is a nullable `ADD COLUMN` the moment one does. And `superseded_by` is reopened here because this is the amendment week: 3.1's ruling is that SPEC-flows.md invariant 2 already made supersession a fact about *values*, and that a genuinely re-issued document is answered by `valid_from`/`valid_to` — so what this week asks is whether promotion at scale finds a case that ruling does not cover | W4 · **closes open question 2 — how many `terms_profile`s are in force, which sizes week 6** |
| **6** | Software | **Who pays for this, and why.** Pick a category and a unit; get tenant / operator / contractor with the clause and the policy version behind it. Then edit the table live and watch the answer change. | `policy` module: the responsibility matrix as versioned, admin-editable data · `asset_in_warranty` fed by week 3's asset register · rules supersede by `effective_from` and never overwrite · `policy_version_id` snapshotted on every resolution · **owed by 1.7: policy cases 4 and 5** — `UNIT` is the only space kind that can ever be the tenant's, and a live warranty moves responsibility to the contractor, with the snapshot still answering after the policy changes. `tests/policy/` and its pending mechanism exist from 1.7; write each case red first | W5, W3.5 · sized by question 2 |
| **7** | Software | **A ticket, start to finish, by hand.** Walk the canonical states in the console — NEW · IDENTIFIED · TRIAGED · RESPONSIBILITY SET · WINDOWS COLLECTED · OFFERED · SCHEDULED · CLOSED — plus the three exits. Watch the SLA clock run and the escalation fire. No WhatsApp, no agent. | `calls` module: state machine · SLA policies · timers · escalation · **the emergency bypass, live and tested here** because it must exist before the agent takes its first real message in week 10 · **owed by 1.7:** the bypass is a policy case too — an emergency category routes to the duty phone **with no model call in between**, which is deterministic and therefore never an eval · **the async negotiation engine starts and runs underneath for six weeks** | W6 |
| **8** | Evidence | **Try to break tenant isolation, live.** Query as one tenant's phone and attempt to reach another tenant's documents, unit or history — through the console, through the API, and by asking the model. Every path returns nothing. | Policy suite cases 4 and 5 (`UNIT` is the only kind that can be the tenant's; a live warranty moves responsibility to the contractor, and re-resolving after a policy change still returns the snapshot) · `national_id` unreachable by any agent tool · audit on every scoped read · **owed by 1.5 and unblocked by 1.6:** the deploy accounts hold `run.admin` at *project* level because scoping it per service was impossible before a service existed — the Cloud Run services exist now, so bind it per service · **owed by 1.5, raised again and given an owner at 3.2:** the docs buckets' legacy `projectEditor` / `projectOwner` bindings carry `legacyObjectOwner`, which includes delete. 3.2 proved the *application* cannot destroy a signed contract — no `delete` on the port, no `objectAdmin` on the runtime account — and a human with project editor still can. 3.2's staging verification then measured that exposure instead of leaving it unbounded: the probe object was removed by hand by exactly such a human, and versioning plus the explicit seven-day soft-delete window left a recoverable noncurrent version rather than a hole. Seven days of grace is not a control and the binding still has to go, but this week is closing a known window and not an open one. It is inherent to a GCS bucket in a project with basic roles rather than a choice `bootstrap.sh` made, so removing it is the same pass as the `run.admin` scoping above and belongs in the week whose demo is *try to break isolation* · **owed by 1.6:** bump the four Node-20 GitHub actions (`checkout@v4`, `setup-node@v4`, `google-github-actions/auth@v2`, `setup-gcloud@v2`), which every run annotates as deprecated · **owed by 1.10, in the same pass:** `release.yml` gains the `docker image inspect` size line `deploy.yml` already has | W7 |

### **Checkpoint · M2**
- [ ] The console is usable on its own — if the agent were cancelled tomorrow, this is still a product
- [ ] All five policy cases green, each red first; the two extra constraints covered
- [ ] Weeks 9–12 decomposed to slice level before week 9's Monday

---

# MONTH THREE · The agent takes the call → **M3 · go/no-go**

| Week | Demo kind | Deliverable | Workstreams | Depends on |
|---|---|---|---|---|
| **9** | Software | **Message the number from your own phone.** It replies with your name, your unit and your tenancy — after a one-time code delivered through WhatsApp itself. | `channel` module: Cloud API webhooks both directions · phone → party binding through `src/scope/` · Conversation and Message tables · **OTP over WhatsApp first, SMS only as fallback** (Twilio closed and working; Hebrew is missing from Verify's default locales — needs custom templates or an Israeli fallback)  · **owed by 3.1 — `tenant_visible`, and the only form it may take.** E12 deliberately carries no per-row visibility boolean: what a tenant may see is derived from `document_link` through `src/scope/`, and a boolean beside the isolation join is a second access control of exactly the shape foundation rule 1 forbids — a model cannot widen a scope it never held, but it can be handed a row whose boolean somebody flipped. If this week finds a class of document that must stay admin-only *inside its own tenancy*, it belongs on the **type** — one row, one rule, readable — and never on each document | **Meta verification** · W8 |
| **10** | Software | **"Who fixes my dripping tap?"** A tenant describes a fault in plain Hebrew; the agent triages, answers from their own lease and the knowledge base, and either resolves it or opens a ticket. | Tenant-facing agent, scoped tools only · retrieval over the tenant's own documents and the global knowledge base · the golden set grows from three cases toward fifty · **owed by 1.8:** `evals/subject.ts` is a placeholder and `runCases` takes a `Subject`, so the real agent replaces it in one line — and this week owns `evals/corpus.ts`'s placeholder `ground()` and its `groundingCutoff`, because the refusal rule belongs to `channel` and one threshold is not enough (1.8 measured a policy section 0.0017 from the cutoff on a repair question) · when a real chunked lease exists, point the corpus at the real retrieval path and let the ratchet move **down** · **the agent reads the responsibility matrix; it never decides responsibility** · no prices, ever | W9 |
| **11** | Software | **Both sides of the switchboard.** Two phones on the table: tenant reports, agent collects windows, agent WhatsApps a provider with address and slots, provider counter-proposes, tenant accepts, visit booked. Neither human sees an app. | The hard part surfacing: `WINDOWS COLLECTED → OFFERED` is two-sided asynchronous negotiation — **roughly seventy percent of the engineering lives between those two states** · provider-side thread bound to the same ServiceCall · timeouts, retries, no delivery guarantee | W10 · in-house crew availability (question 5) |
| **12** | Evidence | **Live, with real tenants and real tradesmen.** The 72-unit building is on the agent; a week of history; every number measured against the three agreed in week 1. | Pilot cutover · escalation queue staffed daily by the pilot owner · **prod tagging starts here** — from now a `v*` tag is cut for every change that reaches real tenants · **owed by 1.10, before the first pilot tag:** restart prod with `gcloud sql instances patch dona-prod --activation-policy=ALWAYS` — that is the whole manual act, because `--min-instances 1` comes back on its own with the first tag deploy; until then prod answers 503 by design · **owed by 1.10:** give the `production` GitHub environment its protection rules — a required reviewer and a deployment tag policy limited to `v*` — before it protects anything real. It was created implicitly by the first release with none, so today a tag is the only thing between a commit and prod · **owed by 2.6:** re-open the btree on `party_contact (channel, value)`. It is three times faster than the exclusion constraint's GiST index at the isolation join's first hop, and 2.6 measured that adding it changes nothing — with both present the planner chooses GiST on cost. This is the week that table stops being 2,871 rows and Q2 stops being run by a screen, and **the fix is not "add the btree"**, which was already tried: it is changing what the exclusion constraint's index looks like to the cost model | W11 |

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
