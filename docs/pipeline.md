# Build Pipeline

How this system gets built: **one developer directing agents, with the process doing the reviewing.**
No human reviews a diff but me, so the gates have to be mechanical. Reads alongside
[CLAUDE.md](../CLAUDE.md) and [HANDOFF.md](../HANDOFF.md); the schedule it runs against is
[Rollout Cadence](rollout-cadence.html), which is the authority on weeks and gates and is never
restated here. What crosses over from the previous codebase, and what must not, is
[from-v3.md](from-v3.md).

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
4. **Small verified slices.** One vertical slice per session: plan → implement → verify → staging.
   If a task cannot be described in three acceptance bullets, split it before starting.
5. **Mock data is the development substrate, by design and not by shortage.** We define the fixtures
   and templates the system is built against, chosen for coverage of the cases that break things
   rather than for whatever a customer happened to send. Real tenant data enters at sign-off, and the
   data request that asks Dona Dom for it is *generated from* our templates. So the schema is proved
   before anyone's real records touch it, and no slice ever stalls on someone else's inbox.
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

One file, `tasks/fuses.md`, one row per fuse, **reviewed once a week**. Every row carries four
things and nothing else: **date lit · expected burn · status · what stalls if it does not land.**
An unlit or overdue fuse goes on the standing asks slide at the weekly demo — visible to Dona Dom's
management as their dependency, not as our delay.

| Fuse | Lit | Expected burn | What stalls if it does not land |
|---|---|---|---|
| **Meta business verification** | W1 | **4–6 weeks, uncompressible** | The whole agent half. This is the critical path in every document; filing in week 1 is what buys the runway. Fallback is a message simulator, then swapping in the live number. |
| **WhatsApp number under Dona Dom's legal entity** | W1 | Days, once the entity is decided | Verification itself — the number must belong to the company, never a personal mobile. A wrong number here means refiling, not editing. |
| **Priority ERP read-only keys** | W1 | Client IT's calendar | The register import, the ERP foreign keys, and every financial reference. Open question #1 in the handoff decides how much of month one depends on this. |
| **Google Drive access to the document folders** | W1 | Days | Document ingestion. Drive is the known source for lease and building paperwork, so this fuse converts a backfill expedition into an import. |
| **ADR-0004 — personal data reaching a model provider** | W1 | Days, once asked | Slice 1.12 and everything after it. The obligation is a disclosure: the legal basis, and every third party that sees tenant text, named before it is called. A third party discovered later is a data-custody incident, not a config edit. |
| **The client's GCP organisation decision** | W1 | Weeks — a management decision | Nothing immediately; everything eventually. The project is created under an organisation now and migrated later. Two things must be true before the move: an `@donadom.co.il` identity exists (most organisations block IAM grants to external addresses outright, which is the likeliest way to get locked out of your own project), and no real tenant data has landed yet, so the transfer is an admin task and not a data-custody event. If the GitHub repository moves with it, the `assertion.repository` attribute condition and both deploy workflows change with it. |

**Open, and to be answered before week 1 is planned:** the Meta verification filed 2026-08-21 may
already be most of the way through its burn, or may have to be refiled against the correct legal
entity. Those two possibilities are weeks apart in their effect on the agent half. Confirm the
status and the filing entity before planning around a fresh application.

## 3. The context layer

```
AGENTS.md               ← root, 20–30 lines MAX: commands, style, architecture map
CLAUDE.md               ← thin pointer: "Read AGENTS.md", plus Claude-specific notes
SPEC.md                 ← shared conventions + the foundation rules
SPEC-<module>.md        ← one per module; updated BEFORE the code changes
.claude/settings.json   ← permissions allowlist + hooks (§4)
.claude/skills/         ← repeatable workflows with real steps, e.g. the progress schematic
docs/decisions/ADR-*.md ← why a choice was made, so agents cite instead of relitigating
docs/model/             ← the workbook: the specification for month one's tables
tasks/todo.md           ← the current week's slices, with acceptance criteria
tasks/fuses.md          ← the fuse table (§2)
tasks/evidence/*.md     ← one file per slice: what was actually proved, with the numbers
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
- **`tasks/evidence/` is what makes the history legible a month later.** One file per slice, written
  when the slice closes, recording what was proved and what the numbers were. It is also where
  observations that must never become assertions live — embedding distances, timings, accuracy runs.

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
   ↓ push / PR
CI:       typecheck · lint · unit + contract tests
          tests/policy/     ← REQUIRED · isolation · responsibility · state machine   (§6)
          evals/golden/     ← REQUIRED · grounding · refusal · isolation attempts     (§7)
          two grep guards · race + timeout tests · dependency audit
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

**Two grep guards in CI**, in the same spirit as the bash hook — cheap, blunt, and impossible to
argue with at 2am:

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

**Both guards are steps of the `gate` job**, which is the required check on `main` — a guard nothing
requires is a guard nobody obeys. `npm run guards` runs them, and `scripts/guards.ts` is the file.

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
committed distance is a gate that fails for weather. Distances are observations; they live in
`tasks/evidence/`. Rank and order are what the gate reads.

**Silent skips are failures.** Retrieval cases need a database and an embedding key; absent either
they skip — right on a clean clone, a lie in CI, where the job goes green having ranked nothing.
`REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` turn the skip back into a failure, and both are set
on the evals job.

Two standing refusal cases carry a constraint that is never relaxed, not even in v2: **no
tenant-facing price and no balance, ever.** A question about money is answered by refusal and
handoff, never by an estimate — "around ₪400" against an ₪850 invoice is a broken promise, in
writing, timestamped, on the client's behalf.

`npm run measure` is the instrument beside the gate: it prints every result set with distances, which
chunks win unrelated questions, and whether any threshold separates a right answer from a wrong one.
It decides what a ranking change should *be*; `npm run evals` decides whether it may merge.

## 8. The loop

**Per slice.**

1. Take the slice from `tasks/todo.md`, where it is already written with acceptance criteria.
2. Update `SPEC-<module>.md` if behaviour changes — before the code, not after.
3. Plan mode if it is non-trivial or on the §4 mandatory list; approve the plan; implement with tests.
4. Read the diff yourself. CI is the gate, but nothing merges unread.
5. Merge green → staging deploys itself → two-minute smoke on staging.
6. Close the slice with a `tasks/evidence/` file. End of day, staging is current and `todo.md` is true.
7. **Carry every raised item into the entry of the slice that closes it** — `tasks/todo.md` and
   `tasks/roadmap.md`, not only the evidence file. A slice is not closed while something it raised
   has no owner.

**The carry rule, and why it is a rule.** A slice legitimately leaves things open: week 1 is a
dependency chain, and 1.2 cannot join `npm test` before 1.3 creates it. The bar is therefore not
*nothing open* — it is **nothing open that is unowned**. Evidence files are written once and reopened
never, so an item recorded only there is an item lost: slice 1.1 raised three, two of which had
vanished from the plan by 1.2 — including the sharpest hazard in the repo. What an item costs to
carry is one sentence in the closing slice's entry, read at the moment it matters. What it costs to
lose is discovered by tripping over it.

**Per week.** The week's shape belongs to the Cadence — the demo kind is declared Monday, the build
is frozen Wednesday, the demo runs Thursday. What the pipeline owes each of those:

- **Monday** — `tasks/todo.md` rewritten for the week, with the declared demo kind at the top, so the
  slices and the promise cannot drift apart.
- **Wednesday** — the freeze is a pipeline event, not an intention: the last merge that reaches
  staging lands Wednesday, and anything finished after it waits on a branch until the demo is done.
  Nothing is ever demoed that was finished that morning.
- **Thursday** — **the demo runs off staging**, on the same URL as last week, never off a laptop.
  Same link, same service call, getting progressively more real.
- **Once a week** — walk `tasks/fuses.md`. Anything unlit or overdue goes on the asks slide.

**Prod tagging starts at week 12.** Before the pilot is live there is nothing in prod to serve and
nobody to serve it, so the ordinary week produces no `v*` tag at all and staging *is* the delivered
artifact. The exception is deliberate and happens once, on day one: the tag path and the rollback are
both exercised on purpose while nothing depends on them (§9). From week 12 the pilot building is on
the system with real tenants, and a tag is cut for every change that reaches them.

**The monthly gates are where the loop widens.** M1–M4 are the only points where scope, priorities
and the roadmap get re-planned — on the record, in the room, and absorbed rather than negotiated
silently between weeks. The pipeline's contribution to each: the fuse table, the evidence files
written since the last gate, and the two gates' current numbers. What each gate decides belongs to
the Cadence, not here.

## 9. Day one, in order

- [ ] `git init` + GitHub repo; branch protection on `main` — required checks, no force push
- [ ] **Light every fuse in §2 and create `tasks/fuses.md` before any of the below.** They burn
      while the scaffolding gets built; nothing here is on their critical path
- [ ] Scaffold: `AGENTS.md` (20 lines), `CLAUDE.md` pointer, `SPEC.md`, `tasks/todo.md`
- [ ] `.claude/settings.json`: permissions allowlist plus the four hooks from §4
- [ ] Biome, tsconfig, `node --test` wiring; one passing dummy test
- [ ] `infra/bootstrap.sh` against the new project — `REGION` stays `me-west1`. Provisions APIs,
      Artifact Registry, Cloud SQL with `--edition=ENTERPRISE` (me-west1 defaults new instances to
      `ENTERPRISE_PLUS`, which rejects shared-core tiers), the database user with its generated
      password written straight into Secret Manager, both service accounts, per-secret IAM, the docs
      bucket created closed and re-closed on every run, and Workload Identity Federation with the
      repository attribute condition
- [ ] `ci.yml`, `deploy.yml` (staging on `workflow_run`), `release.yml` (prod on `v*`)
- [ ] `tests/policy/` with the isolation join and the recycled-number case — **the two hardest
      constraints have a failing test before they have an implementation**
- [ ] `evals/` with the runner and three cases, however trivial: the gate exists from commit one
- [ ] Both grep guards wired into CI, and proved by a commit that trips each one
- [ ] **Prove the pipeline in both directions on purpose:** break a test → PR blocked; fix → merge →
      staging live; tag → prod; then **roll prod back**, and confirm the next deploy still takes
      traffic. The one time this is easy to do is the day nothing depends on it

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
