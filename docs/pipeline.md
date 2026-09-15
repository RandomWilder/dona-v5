# Build Pipeline

How this system gets built: **one developer directing agents, with the process doing the reviewing.**
No human reviews a diff but me, so the gates have to be mechanical. Reads alongside
[CLAUDE.md](../CLAUDE.md) and [HANDOFF.md](../HANDOFF.md). What crosses over from the previous
codebase, and what must not, is [from-v3.md](from-v3.md).

**This file is the mechanics — gates, guards, the chain from a laptop to production.** It stopped
being a schedule on 15 Sep 2026: [ADR-0007](decisions/ADR-0007-work-is-tracked-as-blocking-edges-not-a-calendar.md)
retired the slice/week/evidence process, and what replaced it is the skills flow in
[CLAUDE.md](../CLAUDE.md) §Agent skills. [Rollout Cadence](rollout-cadence.html) remains the
client-facing statement of intent; nothing here is derived from it.

---

## 1. Principles

1. **You are the director, not the typist.** The agent inspects, writes, runs, tests and
   self-critiques; the job is architecture, judgment and verification. Speed must never outrun
   oversight — AI still introduces a known security flaw in roughly 45% of generated samples, so what
   keeps quality up is the pipeline, not vigilance.
2. **The spec is the prompt.** Requirements live in files the agents read — `SPEC.md`,
   `SPEC-<module>.md`, and for month one's tables the workbook in [model/](model/), which is a
   specification and not a description. Sessions start from the spec, never from a chat description.
3. **CI is the reviewer.** Typecheck, lint, contract tests and both required gates decide what
   merges. Never merge red, never "fix it after".
4. **Small verified tickets.** One **tracer bullet** per session — a narrow but complete path through
   every layer, demoable on its own, sized to one fresh context window: plan → implement → verify →
   staging. If a task cannot be described in three acceptance bullets, split it before starting.
   Sequencing is the blocking edges between tickets, never a date.
5. **Mock data is the development substrate, by design and not by shortage.** We define the fixtures
   and templates the system is built against, chosen for coverage of the cases that break things
   rather than for whatever a customer happened to send. Real tenant data enters at sign-off, and the
   data request that asks Dona Dom for it is *generated from* our templates. So the schema is proved
   before anyone's real records touch it, and no slice ever stalls on someone else's inbox.
   **Generalised to documents on 2026-09-06, as the standing method for every document type and every
   flow that touches one: concept → work with example documents → verify the concept via schema
   review → work with real documents, preparing for pilot.** Step 2 runs on the tier-1 corpus, so
   concept and schema are proved while the tier-2 fuse is still burning; step 4 is where volume, the
   real register and the pilot building arrive, and it is the only step that depends on someone else's
   export. Written out with its consequences in [SPEC-flows.md](../SPEC-flows.md).
6. **Two required gates, not one.** Half this product is an agent and half is a console, and the
   three things the client called non-negotiable are all deterministic. The golden set gates the
   agent (§7); the policy suite gates everything no model is allowed near (§6). Neither substitutes
   for the other.
7. **Every external dependency is lit before the code that needs it exists.** §2 — and it is the
   section most likely to save the schedule.

## 2. Fuses

A fuse is an external dependency with a burn time we do not control: someone else's approval,
someone else's export, someone else's decision. **Light it in week 1, before the code that consumes
it is written.** A fuse lit late does not cost its own burn time — it costs the burn time *plus*
every day of work that was ready and waiting on it.

One file, [fuses.md](fuses.md), one row per fuse. Every row carries four things and nothing else:
**date lit · expected burn · status · what stalls if it does not land.** An unlit or overdue fuse is
a standing ask on the client — visible to Dona Dom's management as their dependency, not as our
delay. It lives in `docs/` rather than the issue tracker because a fuse is a dependency we do not
control and cannot close, and because the F6 processor table is a legal register, not a ticket.

**Walk it when a ticket touches something it gates**, and before any conversation with the client.
The live table is [fuses.md](fuses.md): seven rows, F1–F7, with their dates and their current
status. It is not restated here — a fuse table copied into a second file is a fuse table that goes
stale in one of them.

## 3. The context layer

```
AGENTS.md               ← root, 20–30 lines MAX: commands, style, architecture map
CLAUDE.md               ← thin pointer: "Read AGENTS.md", the skills flow, this repo's additions
CONTEXT.md              ← the glossary: the nouns and their one meaning each
SPEC.md                 ← shared conventions + the foundation rules
SPEC-<module>.md        ← one per module; updated BEFORE the code changes
.claude/settings.json   ← permissions allowlist + hooks (§4)
docs/agents/*.md        ← what the engineering skills read: tracker, labels, domain-doc layout
docs/decisions/ADR-*.md ← why a choice was made, so agents cite instead of relitigating
docs/model/             ← the workbook: the specification for month one's tables
docs/fuses.md           ← the fuse table (§2)
GitHub Issues           ← the work itself: tickets with acceptance criteria and blocking edges
archive/tasks-w1-7/     ← the retired slice/week process, 6–15 Sep 2026. Read, never written
```

Rules that matter:

- **`AGENTS.md` stays lean.** Commands, code style, directory map. Nothing else — duplicated README
  content measurably degrades agent performance.
- **`CLAUDE.md` points at `AGENTS.md`.** One source of truth, two loaders.
- **Spec first, then code.** The ritual for any module change: update `SPEC-<module>.md` → tell the
  agent to read it → implement → contract tests prove the spec.
- **One tool, one context layer.** Claude Code is the only agent surface, so file-scoped rules that
  existed to brief a second editor do not exist. The three that matter — migration conventions, the
  kernel boundary, UI tokens with RTL logical properties — are stated in `SPEC.md` and *enforced* by
  the write hook and by CI, which is stronger than a rules file an editor may or may not load.
- **The closing comment on an issue is what makes the history legible a month later.** Written when
  the ticket closes, recording what was proved and what the numbers were. It is also where
  observations that must never become assertions live — embedding distances, timings, accuracy runs.
  Through 15 Sep 2026 these were files under `tasks/evidence/`; sixty-seven of them are archived at
  `archive/tasks-w1-7/evidence/` and code comments citing them still resolve.

## 4. Guardrails, enforced by code rather than memory

**Hooks** (`.claude/settings.json`) — rules with teeth, fired on lifecycle events:

- `PostToolUse` (file write) → Biome format + lint on the touched file.
- `PostToolUse` (edit under `src/<module>/`) → that module's focused tests. Feedback in seconds, not
  at push time.
- `PreToolUse` (Bash) → block `rm -rf /`, force push, raw `psql` against prod, destructive `gcloud`
  outside the deploy scripts, `DROP DATABASE`. Exit 2 blocks the call.
- `SessionStart` → print the current branch, any failing tests, and which guardrails are loaded, so
  no session starts blind and a session running without them looks different from one that has them.

**Exit 2 is the only code that reaches the agent, on both events.** A `PostToolUse` hook that exits 0
has its stderr discarded, so a report written that way is never read by anything — the write has
already happened either way, and 2 is what puts the failure in front of the model. A hook whose
feedback exits 0 is decoration (slice 1.2 evidence, where v3's had been decoration for a year).

**Permissions.** Allowlist the routine — tests, lint, `git status`/`diff`, docker compose — so flow
is uninterrupted. Deploys and destructive commands stay behind a prompt.

**Plan mode is mandatory** for anything touching the kernel, a migration, auth, the policy layer, or
two or more modules. The plan is reviewed — two minutes — and then executed.

**Secrets.** They live in Secret Manager and reach the system through `infra/set-secret.sh`, which
is the single door: never in the repo, never in a log, never in a prompt, and never as a
command-line argument, where it would land in shell history and in the process table. Workload
Identity Federation with an `assertion.repository` attribute condition means no long-lived
service-account key exists to leak; without the condition any GitHub repository could mint a token
for the project. IAM is bound per secret and per bucket, never at project level, so the staging
runtime cannot read prod's connection URL.

**Standing instructions in `AGENTS.md`:** parameterised queries, validate every input at the edge,
and no new runtime dependency without a stated reason in the commit body. Saying it in the
constitution measurably changes what agents generate.

## 5. The chain: local → CI → staging → prod

```
local:    biome + typecheck + focused tests            (hooks run these as you go)
          restart `npm run dev` — it does not watch — then click the changed screen
   ↓ push / PR
CI:       typecheck · lint · unit + contract tests
          tests/policy/     ← REQUIRED · isolation · responsibility · state machine   (§6)
          evals/golden/     ← REQUIRED · grounding · refusal · isolation attempts     (§7)
          five grep guards · race + timeout tests · dependency audit
   ↓ merge to main
staging:  on workflow_run after CI succeeds → migrations → deploy → take traffic → smoke
   ↓ tag v*
prod:     full CI re-run against the tagged commit → migrations → deploy → take traffic → smoke
```

- **Staging deploys on `workflow_run`, after CI succeeds — never on push.** That one wiring choice is
  what makes it impossible for a red commit to reach staging, even by a direct push to `main`.
- **Migrations run before the revision serves, not after** — as their own Cloud Run job, from the
  image that is about to be deployed, as the *runtime* service account (slice 1.6). Two reasons, and
  the second is the one that decided it. Migrations are append-only, so old code against the new
  schema is the safe direction and new code against the old schema is not. And the connection URL is
  readable only by `app-<env>`: running the migration from the CI runner would mean granting the
  deploy identity access to prod's database URL and connecting from outside the perimeter, which
  trades a genuine isolation property for a build step. The runner orchestrates, and never holds the
  credential.
- **Prod deploys on a `v*` tag only**, the release workflow re-runs the whole gate against the tagged
  commit, and it refuses to release a tag that is not an ancestor of `main`.
- **Take traffic after every deploy.** A rollback pins traffic to a named revision, and it *stays*
  pinned; without `update-traffic --to-latest` the next deploy creates a revision serving 0% — a
  green pipeline that changed nothing.
- **Rollback is one command, no rebuild and no CI wait** (`infra/rollback.sh`), and it prints the
  roll-forward command with it.
- **Smoke is one definition of "actually serving"** (`infra/smoke.sh`), used by both workflows and by
  hand: health plus `db:up`, plus one scripted agent conversation once the agent exists — verify,
  ask a lease question, assert a citation is present — plus the emergency path, which must route to
  the duty phone with no model call in between. "Deployed but silently broken" is the failure this
  exists to make impossible.
- **`npm run dev` does not reload.** Node loads the process once. A browser refresh is not a new
  revision. After any change to a screen or a write path, **stop the listener and start
  `npm run dev` again**, then click the path on `:3000` before merge. Tests `inject` the current
  files; they do not update the leftover process. Staging is what gets demoed; local is the
  first look so a typed field or a refuse is not discovered only after deploy.

## 6. The policy suite — the gate for everything no model may decide

`tests/policy/` is a **required check from commit one**, before there is an agent to evaluate.

Tenant isolation, the responsibility decision and the state machine are the three things the client
called non-negotiable, and all three are deterministic by design: they must be inspectable,
versioned and defensible in a dispute a year later, and a dispute only ever asks about the past. No
model decides any of them — which means **no eval case can test any of them.** They need a suite of
their own, and it is the console's gate exactly as the golden set is the agent's.

Five cases anchor it:

1. **The five-hop isolation join.** `phone → PartyContact (valid today) → Party → TenancyParty →
   Tenancy (active today) → Unit`, resolved in SQL *before* any model call. Two temporal predicates,
   both asserted. The scope is a view and never a column: a model that misbehaves cannot widen a
   scope it never held.
2. **A recycled phone number resolves to nobody.** Israeli mobile numbers get reassigned. A tenancy
   ends, the number goes to someone else, that person messages the agent — and the join returns zero
   rows rather than the previous tenant's unit. This is the case the model exists to make
   representable, so it is the one to write first.
3. **A guarantor never receives service information.** `is_service_contact` is forced false for
   `role = GUARANTOR` by a database constraint. The case asserts the insert is *rejected*, not that a
   form defaults politely.
4. **`UNIT` is the only space kind that can ever be the tenant's.** Responsibility falls out of
   location, so a fault in a `COMMON`, `TECHNICAL`, `EXTERIOR`, `PARKING` or `STORAGE` space resolves
   to the operator or the contractor and never to the tenant.
5. **A live warranty moves responsibility to the contractor.** תקופת הבדק makes responsibility
   ternary; with `asset_in_warranty` true the answer is the contractor, and the resolved call
   snapshots the `policy_version_id` that decided it. Re-resolving the same call after the policy
   changes must still return what the snapshot says.

Two further constraints are deterministic and therefore belong here rather than in the eval set:
**`national_id` never appears in the response shape of any agent tool** — it is admin-only,
unreachable by an agent, and access-logged — and **an emergency category routes to the duty phone
without a model call**, as a policy row plus a routing rule, live before the first real message.

**Every case must be proved to fail before it passes.** A case that was green before and after the
change it was written for tested nothing. Write it against the missing constraint, watch it go red,
then add the constraint.

**Five grep guards in CI**, in the same spirit as the bash hook — cheap, blunt, and impossible to
argue with at 2am. Two of them were §6's from commit one; the third arrived at slice 1.12, when the
`-- pii` convention had been a sentence in `SPEC.md` for eleven days with nothing behind it. This
section said *three* until slice 7.2b, by which point there were four — the count is corrected here
along with the guard that made it five, and the drift is left visible rather than tidied away:

- **No migration may introduce a `current_tenant` column.** `current_tenant` is a view, not a column.
  A grep over **`src/kernel/migrations/*.sql`** fails the build. The constraint is absolute, so the
  guard is too — a match in a comment fails as readily as a match in DDL. (This section said
  `migrations/*.sql` until slice 1.7. Migrations have never lived there in this repository, so the
  guard as written would have scanned no files and passed forever. Both guards therefore fail when
  they scanned nothing, which is the only part of a grep guard that catches a wrong path.)
- **Only one module may construct tenant scope.** The isolation join is written once, in one file,
  where it can be read and defended. A grep that finds either of the join's temporal predicates —
  the contact-validity one and the tenancy-active one — outside `src/scope/` fails the build, because
  the way this constraint dies is not a rewrite, it is a second copy that drifts. The match is on the
  *predicates* and not on the table names: naming `party_contact` is ordinary, and re-deciding when a
  contact or a tenancy counts is what only one file may do.

- **A person-shaped column carries `-- pii`.** `SPEC.md`'s Security defaults have said so since 1.1
  and nothing enforced it, which is the standing the `current_tenant` rule had before its own guard.
  A column named `national_id`, `phone`, `email`, a name, a birth date or a bank detail must carry
  `-- pii` on its line or in the comment block above it; the one escape is `-- not-pii: <why>`, which
  is a sentence somebody has to write and a reviewer can read. Built at **1.12, before the migration
  that needs it** — `party` and `party_contact` land at 2.1 and are the first tables in this system
  with a person in them, so the guard is written against zero violations and fires on `0006_` the day
  it arrives. That is what *controls before data* means when it is a mechanism rather than an
  intention.

- **An instant becomes a date in one file.** `toISOString().slice(0, 10)` is the UTC day, and for the
  two or three hours after midnight in Israel that is yesterday. Slice 7.2b found eleven call sites
  deriving it, one of them the isolation join deciding who lives in a unit. A grep for that spelling —
  and for `split('T')[0]` — outside `src/kernel/clock.ts` fails the build, so the fix cannot be undone
  by somebody simplifying it back. The guard has **no exclusion list beyond the kernel file itself**,
  which is why the two copies of date arithmetic were lifted into the kernel rather than excused.

**All five guards are steps of the `gate` job**, which is the required check on `main` — a guard
nothing requires is a guard nobody obeys. `npm run guards` runs them, and `scripts/guards.ts` is the
file.

## 7. The golden set — the gate for the agent

- Hebrew cases: **50 catches large regressions; grow toward ~200 for statistical confidence; past
  ~500 is diminishing returns.** The harness and its first cases exist from commit one so the gate is
  never introduced late; the set fills out as the tenant-facing agent surface appears.
- Each case is an input conversation plus expected behaviour, asserted on tool selection, citation
  presence, absence of invented facts and correct refusal — trajectory, not final-text matching.
- **Any change to a prompt, model id, retrieval config or tool definition runs the full set.** A
  regression past threshold does not merge, exactly as a failing unit test does not merge.
- **The feedback loop is the product.** A production failure becomes a golden case the same day, CI
  blocks that failure forever, and the correction doubles as the tenant-facing trust-repair flow.
- The dataset is versioned in the repo (`evals/golden/*.json`) and its diffs are reviewed like code.

**Three kinds of case**, one per file, checked at parse:

- **behavioural** (`expect`) — graded against an agent turn: which tool ran, was a clause cited, was
  the answer refused, does the text contain a required substring.
- **retrieval** (`retrieval`) — graded against the ordered result set for a question. Asserts
  `expectRef`, the clause that answers it, and `rankAtMost`, where in the list it must appear.
- **grounding** (`grounding`) — graded against what a question may be answered *from*: `lease`,
  `policy` or `none`, plus the `expectRef` the top passage must cite. **`expectSource: 'none'` is the
  refusal case**, and it exists because a refusal is not observable in a rank: the question retrieves
  eight clauses and none of them answers it. A refusal case may not name a citation, checked at parse.

**`rankAtMost` is a ratchet, not a target.** It is set to the rank retrieval achieves *today*, so the
gate blocks regression from the first commit while staying green — and the proof that a later
ranking change is a fix is that the number goes down. "A ranking change that does not move these is
not a fix" stops being a claim in a commit message and becomes something the runner enforces.

**No assertion is ever on a distance.** Provider embeddings are not bit-identical between runs, so a
committed distance is a gate that fails for weather. Distances are observations; they live in the
ticket's closing comment. Rank and order are what the gate reads.

**Silent skips are failures.** Retrieval cases need a database and an embedding key; absent either
they skip — right on a clean clone, a lie in CI, where the job goes green having ranked nothing.
`REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` turn the skip back into a failure, and both are set
on the evals job.

**This paragraph used to say two standing refusal cases carried "no tenant-facing price and no
balance, ever", never relaxed even in v2.** Foundation rule 2 is retired
([ADR-0008](decisions/ADR-0008-money-is-ordinary-data.md)) — an amount on a document is ordinary
data, and the golden set now ranks questions about a printed rent and deposit (#104). What survives
is narrower and is a fact about what is built rather than a refusal: **this platform holds no
balance**, Priority is the system of record for what anybody owes, and no module here writes one.
What the agent says to a tenant about money is undecided and belongs to the channel and calls
modules, which do not exist yet.

`npm run measure` is the instrument beside the gate: it prints every result set with distances, which
chunks win unrelated questions, and whether any threshold separates a right answer from a wrong one.
It decides what a ranking change should *be*; `npm run evals` decides whether it may merge.

## 8. The loop

**Per ticket.** The ticket comes off the tracker (an open file in `issues/` labelled
`ready-for-agent`), already
carrying acceptance criteria and its blocking edges. `/implement` drives steps 2–4.

1. Read the ticket and its comments. Confirm every blocker is closed.
2. Update `SPEC-<module>.md` if behaviour changes — before the code, not after.
3. Plan mode if it is non-trivial or on the §4 mandatory list; approve the plan; implement with tests,
   one red-green slice at a time.
4. `/code-review` the diff — two axes, Standards and Spec — then read the diff yourself. CI is the
   gate, but nothing merges unread.
5. **Restart local and look.** `npm run dev` has no watch. Kill the listener, start it on the working
   copy, click the screen this ticket changed. Skip only when the ticket has no human-facing path
   (a constraint, a migration, a guard).
6. Merge green → staging deploys itself → two-minute smoke on staging.
7. Close the issue with a comment saying what was proved, with the numbers. **Nothing this ticket
   raised is left unowned**: anything deferred becomes an issue, and an issue it gates gets the
   blocking edge. That is the carry rule, and the tracker now holds it instead of a paragraph of
   prose.

**Prod tagging.** The ordinary change produces no `v*` tag: until the pilot building has real tenants
on the system there is nothing in prod to serve, and staging *is* the delivered artifact. The tag path
and the rollback were both exercised once on purpose, on day one, while nothing depended on them (§9).
Once the pilot is live, a tag is cut for every change that reaches it.

**What is not in this file any more.** Weeks, demo days, freeze Wednesdays, monthly gates, slice
numbers, evidence files. They ran from 6 to 15 September 2026, they are archived at
`archive/tasks-w1-7/`, and [ADR-0007](decisions/ADR-0007-work-is-tracked-as-blocking-edges-not-a-calendar.md)
says why they stopped. Demos still happen and status is still reported — both on request, neither on
a calendar this repository has to store.

## 9. Day one, in order

- [x] `git init` + GitHub repo; branch protection on `main` — required checks, no force push
- [ ] **Light every fuse in §2 and create `docs/fuses.md` before any of the below.** They burn
      while the scaffolding gets built; nothing here is on their critical path
- [x] Scaffold: `AGENTS.md` (20 lines), `CLAUDE.md` pointer, `SPEC.md`, the issue tracker
- [x] `.claude/settings.json`: permissions allowlist plus the four hooks from §4
- [x] Biome, tsconfig, `node --test` wiring; one passing dummy test
- [x] `infra/bootstrap.sh` against the new project — `REGION` stays `me-west1`. Provisions APIs,
      Artifact Registry, Cloud SQL with `--edition=ENTERPRISE` (me-west1 defaults new instances to
      `ENTERPRISE_PLUS`, which rejects shared-core tiers), the database user with its generated
      password written straight into Secret Manager, both service accounts, per-secret IAM, the docs
      bucket created closed and re-closed on every run, and Workload Identity Federation with the
      repository attribute condition
- [x] `ci.yml`, `deploy.yml` (staging on `workflow_run`), `release.yml` (prod on `v*`)
- [x] `tests/policy/` with the isolation join and the recycled-number case — **the two hardest
      constraints have a failing test before they have an implementation**
- [x] `evals/` with the runner and three cases, however trivial: the gate exists from commit one
- [x] Both grep guards wired into CI, and proved by a commit that trips each one
- [x] **Prove the pipeline in both directions on purpose:** break a test → PR blocked; fix → merge →
      staging live; tag → prod; then **roll prod back**, and confirm the next deploy still takes
      traffic. The one time this is easy to do is the day nothing depends on it

**Closed by slice 1.10 on 2026-09-05**, except the fuse row, which stays open on purpose: `docs/fuses.md`
exists and F1 is lit, but F2–F7 are someone else's decision and are walked until they land. The
last line was performed rather than built — three tags, a rollback, and a deploy that took 100% of the
traffic afterwards ([archive/tasks-w1-7/evidence/1.10.md](../archive/tasks-w1-7/evidence/1.10.md)).

## 10. Anti-patterns

- **Chat-driven architecture.** Deciding structure ad hoc in prompts instead of in specs and ADRs —
  agents then relitigate and drift. Write it down once, and cite it after that.
- **An item raised in an evidence file and nowhere else.** It reads like diligence and behaves like
  forgetting: the file is never reopened, so the item is discovered by tripping over it. §8, step 7.
- **Handing the director a menu.** The agent's job includes the structural call. Present one
  approach with its reasoning and its cost, not a list of options with the decision left open —
  a choice offered without the context to decide it is work pushed uphill, not deference.
- **Merge-then-verify.** "CI is slow, I'll push to main." The one habit that converts agent speed
  into production incidents.
- **Context bloat.** A 300-line `CLAUDE.md` nobody maintains. Lean constitution, spec per module,
  skills on demand.
- **Prompt-tweaking without evals.** Changing the agent's prompt because one conversation looked bad,
  with no golden run: you fix one case and silently break five.
- **Trusting the demo.** An agent that "worked when I tried it" is untested. If it is not in the
  golden set or a contract test, it does not work yet.
- **Testing a deterministic constraint through the agent.** An eval case that fails to reach another
  tenant's data proves the model behaved, not that the join is sound. Isolation, responsibility and
  the state machine are tested in `tests/policy/`, against SQL.
- **A policy test that has never been red.** It was written after the constraint, it asserts what the
  code already did, and it will keep passing after someone removes the constraint.
- **Letting the agent hold secrets.** Pasting keys into prompts, committing `.env`, passing a
  credential as an argv. Treat AI tools as public channels.
