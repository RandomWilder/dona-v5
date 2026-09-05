# Week 1 · Sun 6 – Thu 10 Sep 2026 — A URL, a schema, and a filed application

> **Demo kind, declared Sunday: SOFTWARE.**
> **Week demo (Thu 10 Sep):** a live link stakeholders open on their own phones — Shoham's building
> and its 72 units — plus the timestamped Meta verification submission.
> **Freeze:** Wed 9 Sep. The last merge that reaches staging lands Wednesday.
>
> One slice = one focused session, half a day or less. Every day ends with staging deployed.
> **Done when** is the acceptance bar; **Verify** is the check that proves it — no self-certification.
> The standing bar every slice also clears is the Definition of Done in [plan.md](plan.md).

**Twelve slices against four build days** (Sun–Wed). It fits only because six of them are verbatim
lifts from v3 with no design decisions in them. The cut line at the bottom is the release valve —
exercise it rather than letting the freeze slip. See risk **R1**.

---

## Before any slice — light the fuses

- [ ] Walk all six rows of [fuses.md](fuses.md). They burn while the scaffolding gets built;
      **nothing below is on their critical path.**
- [ ] Confirm and record the Meta filing: lit 2026-08-21, correct legal entity, in progress. Four to
      six weeks puts it between 18 Sep and 2 Oct — roughly five weeks of slack ahead of the week-9
      need.

## Also this week

- [ ] Put the **three success numbers** to the client for agreement at Thursday's demo
      ([plan.md](plan.md) — calls closed with no human · time to booked visit, median and p90 ·
      escalations per 100 calls split by cause), plus the two stop conditions.
- [ ] **Take delivery of the real document corpus — after 1.12, not before.** The controls exist
      first; the data lands into them (**R4**).
- [ ] Look at what document types the Drive folders actually contain, and record the answer against
      open question 6. It sizes how much of the catalogue gets exercised before month two.

---

## Slices

- [x] **1.1 — Repo, branch protection, context layer.** `AGENTS.md` (20–30 lines), `CLAUDE.md`
      pointer, `SPEC.md`, empty `SPEC-<module>.md` per module, `docs/decisions/` re-adopting v3's
      ADR-0001–0004.
      **Done when:** a clean clone gives an agent `AGENTS.md` and `SPEC.md`, and a PR to `main`
      cannot merge without the required checks.
      **Verify:** branch protection API lists the checks; a throwaway PR reports `BLOCKED`. · **M**

- [x] **1.2 — Guardrails with teeth.** `guard-bash.mjs` and `after-write.mjs` lifted from v3,
      `SessionStart` printing branch and failing tests, permissions allowlist.
      **Done when:** `rm -rf /`, force push, raw `psql` against prod and `DROP DATABASE` are each
      blocked with exit 2; a write under `src/<module>/` runs that module's tests.
      **Verify:** attempt all four; paste the blocks into the evidence file. · **S**

- [x] **1.3 — Toolchain and a walking skeleton.** Node 24 type stripping, tsconfig, Biome,
      `node --test`, docker-compose Postgres 16 + pgvector, `npm run dev` health page.
      **Done when:** clean clone → running in under five minutes; `/health` returns `ok:true` **and**
      `db:up`.
      **Verify:** time it from `git clone` on a second checkout; record the number. · **M**
      **Owed by 1.2, and this slice is the first place it can land:** `npm test` must include
      `.claude/hooks/hooks.test.mjs` — 34 cases that nothing currently runs — and `after-write.mjs`
      gains the Biome format-and-lint step [pipeline.md](../docs/pipeline.md) §4 specifies. It runs
      the touched module's tests only, because Biome does not exist until this slice.

- [x] **1.4 — Kernel lift, verbatim.** All of `src/kernel/`, renaming nothing. Migrations do **not**
      come with it.
      **Done when:** the kernel's own tests pass in v5 and it imports nothing from any domain module.
      **Verify:** `npm test`; grep proves the boundary holds. · **M**
      **Owed by 1.3 — four things the skeleton wrote by hand for the kernel to take back.** `src/`
      is deliberately empty of modules so this lift lands in clean space, and these are what it
      replaces rather than duplicates: (a) `src/app.ts`'s inline `{ code, message }` 503 body →
      `kernel/errors.ts`'s `KernelError` / `httpStatus` / `toErrorBody`, adding the
      `setNotFoundHandler` / `setErrorHandler` v3 has and 1.3 deliberately left out; (b)
      `src/app.test.ts`'s four-line `REQUIRE_POSTGRES` check → `kernel/pg-support.ts`'s
      `migratedPoolOrNull()`; (c) **`src/db.ts` is deleted by this slice, and its `pool.on('error')`
      handler must survive the deletion** — v3's `kernel/db.ts` does not have one, so a clean
      verbatim lift silently reintroduces a bug that kills the process whenever the database
      restarts ([from-v3.md](../docs/from-v3.md); `src/db.test.ts` is the case that catches it);
      (d) `docker-compose.yml` stays on **port 5434** precisely so `kernel/pg-support.ts`'s default
      connection string needs no edit — do not renumber it.

- [x] **1.5 — `infra/bootstrap.sh` against the new project.** `PROJECT` and `GITHUB_REPO` changed,
      **`REGION` stays `me-west1`**, Cloud SQL `--edition=ENTERPRISE`, WIF with the
      `assertion.repository` condition, per-secret IAM, docs bucket created closed. Project created
      **under an organisation**.
      **Done when:** a second run is a no-op, no user-managed service-account key exists, and staging
      cannot read prod's connection URL.
      **Verify:** re-run and diff; key list empty; the cross-environment read is denied. · **M**
      **Lifted four scripts, not one.** `bootstrap.sh` · `set-secret.sh` · `smoke.sh` ·
      `rollback.sh`, all Tier 1 and all verbatim apart from the `PROJECT` default: `rollback.sh`
      invokes `smoke.sh`, `bootstrap.sh` prints a `set-secret.sh` command, and `AGENTS.md` already
      says "secrets only through `infra/set-secret.sh`". Only `bootstrap.sh` is *run* here.
      **R8 is not satisfied and cannot be by this slice.** `dona-v5` is **org-less**, and no
      organisation exists to move it into — creating one is a Cloud Identity signup on a domain, not
      a script. Provisioned org-less on purpose: the move preserves project id, resources, data and
      IAM whenever it happens, and nothing this week is blocked. What is not deferrable is the
      ordering, which is now **fuse F7** and a warning `bootstrap.sh` prints on every run.
      **Dropped from the lift:** the four staff seed secrets (`staff-seed-email/password`,
      `staff-viewer-email/password`). v5 has no `src/staff/`, and the auth gap it must close is
      Identity Platform with enforced MFA, so v3's email+password pair may never be built — carried
      into the week-5 staff-MFA row in [roadmap.md](roadmap.md).

- [x] **1.6 — CI, staging, release.** `ci.yml`, `deploy.yml` on `workflow_run`, `release.yml` on
      `v*` only.
      **Done when:** a red commit cannot reach staging even by a direct push to `main`.
      **Verify:** push one and watch staging not move. · **M**
      **Owed by 1.1, re-scoped at 1.3 — the sharpest edge in the repo.** `main` *did* require the
      check contexts **`gate`** and **`evals`** from 1.1, by those exact names, with no workflow
      behind either. A required context that never reports is not pending, it is failing: PRs #2 and
      #3 were both `BLOCKED` with an empty rollup, and the only way through was `--admin`, which is
      how a guardrail gets trained into background noise. Required status checks were therefore
      **removed from `main` on 2026-09-04** (`gh api -X DELETE
      repos/RandomWilder/dona-v5/branches/main/protection/required_status_checks`); no-force-push,
      no-deletion and required-conversation-resolution were left untouched. **This slice re-arms
      `gate`** — name the job exactly `gate`, let one PR go green with it, *then* add it back as a
      required context, and confirm with a second PR, not by reading the YAML. `evals` is 1.8's to
      re-arm, for the same reason it was wrong to require it here: it cannot be honest until the
      golden set exists, and a stub job that exits 0 on an empty suite is a green check that proves
      nothing.
      **Owed by 1.3:** the `gate` job runs `npm run typecheck`, `npm run lint` and `npm test` as
      three steps — `npm test` is `test:code && test:hooks`, and the hooks half is the only thing
      that runs `.claude/hooks/hooks.test.mjs`, so a `gate` that shortcuts to `test:code` drops 41
      cases. Set `REQUIRE_POSTGRES=1` on the job, against a real Postgres service container: without
      it `src/app.test.ts` and `src/db.test.ts` skip green with no database. `infra/smoke.sh` asserts
      `/health` returns `ok:true` **and** `db:up`, which is the endpoint 1.3 built for it.
      **Owed by 1.1, closing here rather than at 1.10:** set `enforce_admins: true` on `main` as the
      last act of this slice. It was left `false` only so this slice could push a red commit directly
      to `main`; the moment that Verify is done the reason is spent, and leaving it `false` any longer
      means an admin can merge past checks that have become real.
      **Owed by 1.4 — the deploy has to run the migrations, and nothing can run them yet.** 1.4
      brought `kernel/migrate.ts` and three migrations, but the only caller is `pg-support.ts` inside
      the test run: there is no `npm run migrate` and no CLI entry point, so a deployed revision
      would serve `/health` against a database with no tables. `deploy.yml` and `release.yml` both
      need one, between deploy and smoke (pipeline §5). Build the entry point here, in this slice.
      **Owed by 1.4:** `REQUIRE_POSTGRES=1` now decides **23** cases, not 2 — the whole kernel
      durability suite. Without it against a real service container the `gate` job passes having
      touched no database at all.
      **Owed by 1.5 — the values to wire, and two scripts already in the repo.** `smoke.sh` and
      `rollback.sh` were lifted at 1.5, so this slice consumes them rather than writing them.
      `deploy.yml` and `release.yml` need, exactly: WIF provider
      `projects/681282581055/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
      (the `assertion.repository` condition pins it to `RandomWilder/dona-v5` — if the repository ever
      moves, this and the condition change together) · deploy SA `deploy-<env>@dona-v5.iam.gserviceaccount.com`
      · runtime SA `app-<env>@dona-v5.iam.gserviceaccount.com` · Cloud SQL `dona-v5:me-west1:dona-<env>`
      · secret `<env>-database-url` · image `me-west1-docker.pkg.dev/dona-v5/dona/…` · docs bucket
      `gs://dona-v5-<env>-docs`. The Cloud Run **service itself does not exist yet** — bootstrap
      deliberately does not create it, the first deploy does.
      **Owed by 1.4:** the image grows. `pdfjs-dist` and `google-auth-library` are runtime
      dependencies from this slice and `npm ci --omit=dev` installs both. `pdfjs-dist` alone is
      **35 MB unpacked**; check the Cloud Run build time and image size rather than be surprised.
      **Closed 2026-09-05** ([evidence](evidence/1.6.md)). Staging is live at
      `https://dona-staging-681282581055.me-west1.run.app`, three revisions, `version` stamped with
      the commit; the image is 330 MiB and a whole deploy takes under two minutes. The red commit
      `ed92f87` was pushed straight to `main`: CI failed in 25 s, `Deploy` concluded **skipped**, and
      staging stayed on the previous revision — what guards it is `deploy.yml`'s
      `conclusion == 'success'`, not the branch protection, which an admin can push past. `gate` is
      armed and `enforce_admins` is `true`. `REQUIRE_POSTGRES=1` decides **24** cases, not 23; this
      slice added one. Migrations run as a Cloud Run job from the deployed image as the **runtime**
      account, **before** the revision serves: `<env>-database-url` is readable only by `app-<env>`,
      so migrating from the runner would have meant handing the CI identity prod's connection string.
      `docs/pipeline.md` §5's arrow was corrected in the same change.

- [x] **1.7 — The policy suite, red before the schema exists.** Case 1 (the five-hop isolation join,
      both temporal predicates) and case 2 (a recycled number resolves to nobody), plus both grep
      guards.
      **Done when:** both cases fail for the right reason and each guard trips on a deliberate
      violation.
      **Verify:** two commits that each trip one guard, both blocked; the red output recorded. · **M**
      **Owed by 1.3:** `npm run test:code` already names a `tests/**/*.test.ts` glob, and a glob that
      matches nothing is silent. **Confirm by count that the policy cases are actually collected** —
      a suite the runner never found looks exactly like a suite that passed.
      **Owed by 1.4 — the guard's path is not the one pipeline §6 writes.** Migrations live at
      **`src/kernel/migrations/*.sql`**, not root `migrations/`. §6 and this file both wrote the
      `current_tenant` guard against `migrations/*.sql`, which matches nothing and would be a guard
      that passes by looking at no files — the same failure 1.3 found in a `node --test` glob. Point
      it at the real path and prove it by tripping it.
      **Owed by 1.6 — where the guards live, and what that now costs.** `ci.yml` has exactly one
      job, `gate`, and it is a **required** context on `main` from 2026-09-05. The guards belong as
      steps in it rather than as a fourth job nothing requires — which means the moment one lands it
      blocks merges, so trip each one deliberately on a branch rather than discover it on `main`.
      `enforce_admins` is `true`, so there is no admin merge past a guard that fires.
      **Closed 2026-09-05** ([evidence](evidence/1.7.md)). 14 policy cases, 7 of them reporting
      **pending** against a named missing relation — never skipped, never `todo`, and the branch is
      unreachable the moment the last table lands. That mechanism exists because `gate` is required
      and admin-enforced: a deliberately-red required test blocks its own merge, so the red was
      proved and recorded rather than committed. The disarm was proved too — the seven tables built
      in a throwaway database, 14 green, no pending lines — and then every predicate deleted from the
      join in turn, which turned **two cases into rewrites**: a tenancy marked `ENDED` is excluded by
      the status filter, so the date predicate tested nothing, and both recycled-number cases ended
      the tenancy, so the contact dating — the entire point of case 2 — tested nothing either. Both
      guards tripped in CI on purpose (`8c67318` → run `33965072969`, `f9eb13a` → run `33965119613`),
      both `BLOCKED`, both reverted. `src/scope/` landed here rather than at 2.3, holding the join and
      nothing else, because a case that writes its own copy proves the copy.

- [ ] **1.8 — The evals harness, from commit one.** Runner and three trivial cases, one per kind;
      `REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` on the evals job.
      **Done when:** `npm run evals` gates merges and a missing database **fails** rather than skips.
      **Verify:** unset the database URL in CI once and watch it go red. · **M**
      **Owed by 1.3:** same as 1.7 for the `evals/**/*.test.ts` glob in `test:code` — confirm by
      count, not by reading the script. `REQUIRE_POSTGRES=1` is honoured by `src/app.test.ts` and
      `src/db.test.ts` today; the evals job needs `REQUIRE_EMBEDDINGS=1` as well.
      **Owed by 1.3 — re-arm `evals` on `main`.** It was a required check context from 1.1 with no
      workflow behind it and was removed on 2026-09-04 (see 1.6). This slice is the first one that
      can satisfy it honestly. As its closing act: run the evals job on a PR, watch it go green *and*
      watch it go red with the database URL unset, **then** add `evals` back as a required context.
      Not before the red — a context re-armed on a job that has only ever passed is the same promise
      1.1 made.
      **Owed by 1.6 — what to add, and the one thing that does not exist yet.** `ci.yml` gains a
      second job named exactly **`evals`**, with its own `pgvector/pgvector:pg16` service container,
      `REQUIRE_POSTGRES=1` **and** `REQUIRE_EMBEDDINGS=1`. It also needs a repository secret
      `OPENAI_API_KEY` — a **CI-only** key, deliberately not staging's or prod's, which live in
      Secret Manager and reach only their own service account, so this one can be revoked alone. No
      such repository secret exists today. Re-arm by PATCHing both names in at once,
      `{"contexts":["gate","evals"]}`, keeping `strict: true`.
      **Owed by 1.7:** the two grep guards are steps of the `gate` job, so the `evals` job does not
      repeat them. `npm run guards` is the command; `scripts/guards.ts` is the file.

- [ ] **1.9 — Estate schema: Project · Building · Space · Unit.** E1–E4 from the workbook's FIELDS
      sheet. `Building.project_id` nullable, six-value `space_kind`, `Unit.unit_id = Space.space_id`.
      **Done when:** an apartment is a Space with a Unit extension and a lobby is a Space with none,
      enforced by the schema.
      **Verify:** contract tests for R1, R2, R15; a Unit with no Space is rejected. · **M**
      **Owed by 1.4:** the DDL appends from **`0004_`** in `src/kernel/migrations/`. `0001`–`0003`
      are the kernel's own — `vector`, the durability tables, their settings seed — and estate is
      the first domain table in this repository.
      **Owed by 1.7 — three policy cases stop being pending the day this lands.**
      `tests/policy/fixtures.ts` already writes `building`, `space` and `unit` with column lists
      taken from the workbook's E1–E4, against tables that do not exist. When the real DDL appears,
      any column that fixture guessed wrong is a not-null or undefined-column failure **in one
      file** — extend the builder there, and do not edit the cases, which are written so they never
      need to be. The first pending diagnostic moves from `building` to `party` on the same day,
      which is the visible signal this slice did what it says.

- [ ] **1.10 — Prove the pipeline in both directions, on purpose.** Break → blocked; fix → merge →
      staging; tag `v0.1.0` → prod; **roll prod back**; confirm the next deploy still takes traffic.
      **Done when:** the round trip is complete and the post-rollback deploy serves 100%, not 0%.
      **Verify:** revision list with traffic percentages at each step. · **S**
      **Owed by 1.5 — the cost lever, and this is the slice that can pull it.** Prod's database is
      idle from here until week 12: pipeline §8 starts prod tagging then, and between this slice's
      deliberate round trip and the pilot there is nothing in prod to serve. Finish this slice by
      stopping it — `gcloud sql instances patch dona-prod --activation-policy=NEVER` keeps the
      instance, its storage and its data while compute stops billing, and one command reverses it.
      **Owed by 1.5:** `infra/rollback.sh` is in the repo and ends by calling `infra/smoke.sh`, so
      the rollback leg fails closed if the revision it lands on is not actually serving — the
      rollback is proved by the script's own exit code, not by reading a traffic percentage. It also
      prints the roll-forward command, which is what makes "confirm the next deploy still takes
      traffic" a step rather than a memory.
      **Owed by 1.6 — `release.yml` exists and has never run.** The first `v*` tag creates **both**
      the `dona-prod` service and the `dona-prod-migrate` job, exactly as 1.6's first deploy created
      staging's, so the tag leg is a first run and not a redeploy. The gate is re-run against the
      tagged commit through `workflow_call`, and a tag that is not an ancestor of `main` is refused.
      **Confirms an owed action from 1.1, which 1.6 closes:** `enforce_admins` is `true` on `main`.
      This slice is the first one that runs entirely inside the enforced gate, so its break→blocked
      leg is also the proof that the flip took. If it is still `false` here, 1.6 did not finish.
      Once it flips, `tasks/evidence/1.1.md` stops being the current state of the gate.

- [ ] **1.11 — The Shoham fixture and the week-1 surface.** The building, its spaces and its 72 units
      seeded **through the importer path**, and a buildings/units list on the RTL token layer.
      **Done when:** a stakeholder opens the staging URL on their own phone and sees it.
      **Verify:** the owner browses it in a browser, not a screenshot. · **M**
      **Owed by 1.4:** v3's `kernel/ui/tokens.test.ts` was **not** lifted — it asserts against
      module HTML shells (`staff/ui/index.html`, `channel/ui/index.html`) that v5 does not have. It
      is the guard that keeps a hex colour, a `fonts.googleapis` URL or a physical `left:`/`right:`
      out of a screen, and it fails on the HTML rather than the CSS because that is where the
      discipline erodes. It lands with the first screen, which is this one.

- [ ] **1.12 — The corpus, both tiers, and the controls the second one needs.** Tier 1 committed to
      the repo: the published **דירה להשכיר standard lease**, פרוטוקול מסירה, ערבות בנקאית, ארנונה
      and insurance specimens — real structure, no real person, and the substrate every gate runs
      against. Tier 2, **controls before data**: the real corpus in a dated bucket of its own, with a
      lifecycle rule, a tested deletion path, `-- pii` comments as a `SPEC.md` convention, access
      logging on scoped reads, and a removal date recorded the day it lands.
      **Done when:** the specimens are in the repo and a named real document can be permanently
      removed by a documented command that has actually been run.
      **Verify:** run the deletion path against a throwaway object; write the removal date into
      [fuses.md](fuses.md). · **S**
      **Owed by 1.5 — two things.** The corpus does **not** go in `gs://dona-v5-<env>-docs`, which
      1.5 created for the application: this slice creates its own dated bucket, with the lifecycle
      rule and the tested deletion path, so the removal is one bucket and not a search. And **fuse
      F7 binds here**: `dona-v5` is org-less, and the move into an organisation must happen *before*
      real tenant data lands. Landing the tier-2 corpus turns that from an admin task into a
      data-custody event, so either the move happens first or the corpus stays in its dated bucket
      with the removal date recorded — decide it in this slice rather than discover it in week 4.
      **Owed by 1.2:** the bash guard covers the **Bash tool only**. Write, Edit and every MCP tool
      reach the filesystem without passing it, so nothing here may lean on the hook — `.gitignore`,
      bucket IAM and the policy suite are what hold. Also close ADR-0004's F6 row in
      [fuses.md](fuses.md): the tier-2 corpus is the first real personal data, and its legal basis
      and named third parties are owed before it lands, not after.

---

**Cut line, in order:** the third and second eval cases in 1.8 · the unit detail screen in 1.11.
**Do not cut** 1.7, 1.10 or 1.12 — the first two are cheap this week and expensive to retrofit, and
the third has to exist before the data does.

**Say it in the room:** the cadence's week-1 line reads "real names, real addresses". Addresses and
unit numbers are real; tenant names stay fixtures until the week-2 import, under the corpus policy
(A7). State that rather than letting it be noticed.
