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

- [ ] Walk all five rows of [fuses.md](fuses.md). They burn while the scaffolding gets built;
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

- [ ] **1.2 — Guardrails with teeth.** `guard-bash.mjs` and `after-write.mjs` lifted from v3,
      `SessionStart` printing branch and failing tests, permissions allowlist.
      **Done when:** `rm -rf /`, force push, raw `psql` against prod and `DROP DATABASE` are each
      blocked with exit 2; a write under `src/<module>/` runs that module's tests.
      **Verify:** attempt all four; paste the blocks into the evidence file. · **S**

- [ ] **1.3 — Toolchain and a walking skeleton.** Node 24 type stripping, tsconfig, Biome,
      `node --test`, docker-compose Postgres 16 + pgvector, `npm run dev` health page.
      **Done when:** clean clone → running in under five minutes; `/health` returns `ok:true` **and**
      `db:up`.
      **Verify:** time it from `git clone` on a second checkout; record the number. · **M**

- [ ] **1.4 — Kernel lift, verbatim.** All of `src/kernel/`, renaming nothing. Migrations do **not**
      come with it.
      **Done when:** the kernel's own tests pass in v5 and it imports nothing from any domain module.
      **Verify:** `npm test`; grep proves the boundary holds. · **M**

- [ ] **1.5 — `infra/bootstrap.sh` against the new project.** `PROJECT` and `GITHUB_REPO` changed,
      **`REGION` stays `me-west1`**, Cloud SQL `--edition=ENTERPRISE`, WIF with the
      `assertion.repository` condition, per-secret IAM, docs bucket created closed. Project created
      **under an organisation**.
      **Done when:** a second run is a no-op, no user-managed service-account key exists, and staging
      cannot read prod's connection URL.
      **Verify:** re-run and diff; key list empty; the cross-environment read is denied. · **M**

- [ ] **1.6 — CI, staging, release.** `ci.yml`, `deploy.yml` on `workflow_run`, `release.yml` on
      `v*` only.
      **Done when:** a red commit cannot reach staging even by a direct push to `main`.
      **Verify:** push one and watch staging not move. · **M**

- [ ] **1.7 — The policy suite, red before the schema exists.** Case 1 (the five-hop isolation join,
      both temporal predicates) and case 2 (a recycled number resolves to nobody), plus both grep
      guards.
      **Done when:** both cases fail for the right reason and each guard trips on a deliberate
      violation.
      **Verify:** two commits that each trip one guard, both blocked; the red output recorded. · **M**

- [ ] **1.8 — The evals harness, from commit one.** Runner and three trivial cases, one per kind;
      `REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` on the evals job.
      **Done when:** `npm run evals` gates merges and a missing database **fails** rather than skips.
      **Verify:** unset the database URL in CI once and watch it go red. · **M**

- [ ] **1.9 — Estate schema: Project · Building · Space · Unit.** E1–E4 from the workbook's FIELDS
      sheet. `Building.project_id` nullable, six-value `space_kind`, `Unit.unit_id = Space.space_id`.
      **Done when:** an apartment is a Space with a Unit extension and a lobby is a Space with none,
      enforced by the schema.
      **Verify:** contract tests for R1, R2, R15; a Unit with no Space is rejected. · **M**

- [ ] **1.10 — Prove the pipeline in both directions, on purpose.** Break → blocked; fix → merge →
      staging; tag `v0.1.0` → prod; **roll prod back**; confirm the next deploy still takes traffic.
      **Done when:** the round trip is complete and the post-rollback deploy serves 100%, not 0%.
      **Verify:** revision list with traffic percentages at each step. · **S**
      **Closes an owed action from 1.1:** set `enforce_admins: true` on `main`. It was left `false`
      so that 1.6 could push a red commit directly to `main` for its own Verify, and while it is
      `false` an admin can merge a PR the checks have blocked — measured at 1.1, not assumed.
      Once this flips, `tasks/evidence/1.1.md` stops being the current state of the gate.

- [ ] **1.11 — The Shoham fixture and the week-1 surface.** The building, its spaces and its 72 units
      seeded **through the importer path**, and a buildings/units list on the RTL token layer.
      **Done when:** a stakeholder opens the staging URL on their own phone and sees it.
      **Verify:** the owner browses it in a browser, not a screenshot. · **M**

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

---

**Cut line, in order:** the third and second eval cases in 1.8 · the unit detail screen in 1.11.
**Do not cut** 1.7, 1.10 or 1.12 — the first two are cheap this week and expensive to retrofit, and
the third has to exist before the data does.

**Say it in the room:** the cadence's week-1 line reads "real names, real addresses". Addresses and
unit numbers are real; tenant names stay fixtures until the week-2 import, under the corpus policy
(A7). State that rather than letting it be noticed.
