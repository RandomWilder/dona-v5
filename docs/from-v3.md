# What v5 takes from v3

**Decided 3 Sep 2026.** v5 is a new repository and a new GCP project. v3 is not abandoned — it is
inherited from, selectively and deliberately. This file says what crosses over, what does not, and
which parts must not, so the decision does not get relitigated one file at a time.

---

## v3, in one paragraph

`/Users/asafwilder/dona-v3` — 67 commits, last `5c4fc94`, 1 Sep 2026. ~10,800 lines of non-test
TypeScript across a modular monolith, on Node 24 (native type stripping, no build step), Fastify,
raw `pg` with hand-written SQL migrations, deployed to Cloud Run in **me-west1** with Cloud SQL
Postgres 16 + pgvector. Sixteen migrations, nine golden eval cases, four ADRs, per-module specs, and
a CI gate that blocks merges on eval regressions.

**It is not a prototype.** The infrastructure is better than what a fresh build would produce, and
the process around it is the single most valuable thing in the folder.

**The rule: v3 is a reference, never a dependency.** Nothing in v5 imports from it, submodules it, or
symlinks to it. Files are copied in and then owned. When a copied file and its v3 original diverge,
v5's is right by definition.

---

## Why a new project, and how it reaches Dona Dom

The earlier argument against reusing v3's project — that a demolition migration would sit
permanently at the head of the schema — **does not hold**, and was withdrawn: with no real data,
migrations can be squashed or rewritten at any point before go-live. What decided it instead was
that v5's entity model is a different spine rather than a revision (see Tier 3), so the domain is a
rewrite either way, and a rewrite in a clean project costs almost nothing extra once
`infra/bootstrap.sh` comes along.

The GCP project is created under Asaf's own account and **migrated into Dona Dom's organization**
later. That path is supported and keeps project ID, resources, data and IAM intact. Three things
must stay true:

1. **Create the project under an organization** — even a personal Cloud Identity on a domain you
   control. Org-to-org migration is routine; moving an org-less project in is the fiddly case.
2. **Get an `@donadom.co.il` identity before the move, not after.** Most organizations enable
   `constraints/iam.allowedPolicyMemberDomains`, which blocks granting IAM to an external
   `gmail.com` address outright. This is the likeliest thing to lock Asaf out of his own work.
3. **Move before real tenant data lands**, so the transfer is an admin task and not a data-custody
   event.

Billing reattaches to their account, and if the GitHub repo moves to a Dona Dom org, the
`assertion.repository` attribute condition in `bootstrap.sh` and the two workflow files change with
it. See open question #8 in [../HANDOFF.md](../HANDOFF.md).

---

## Tier 1 — take verbatim

### Infrastructure and the deploy pipeline

This is the part that made the whole reuse question worth asking. All of it is parameterised
already; `PROJECT` and `GITHUB_REPO` are shell variables with defaults, not hardcoded strings.

| From v3 | What it does | What changes for v5 |
|---|---|---|
| `infra/bootstrap.sh` | Provisions one whole environment, idempotently: APIs, Artifact Registry, Cloud SQL, database user + generated password straight into Secret Manager, staff seed secrets, both service accounts, per-secret IAM bindings, the docs bucket, and Workload Identity Federation | `PROJECT`, `GITHUB_REPO`. **`REGION` stays `me-west1`** — the Stack Map requires it |
| `infra/set-secret.sh` | The single way a credential enters the system. Never an argv, hidden prompt or stdin only, per-environment naming | Nothing |
| `infra/rollback.sh` | One command, no rebuild, no CI wait. Prints the roll-forward command | Nothing |
| `infra/smoke.sh` | One definition of "actually serving" — checks `db:up` as well as `ok:true`, used by both workflows and by hand | Nothing |
| `.github/workflows/ci.yml` | typecheck · lint · tests against a real Postgres service container · evals as a separate job | Nothing structural |
| `.github/workflows/deploy.yml` | Fires on `workflow_run` after CI succeeds, so a red commit cannot reach staging even on a direct push to `main` | `PROJECT`, `SERVICE`, `IMAGE`, WIF provider path, SA emails |
| `.github/workflows/release.yml` | Prod on a `v*` tag only, re-running the full CI gate against the tagged commit, and refusing to release a tag that is not an ancestor of `main` | Same as above |
| `Dockerfile`, `docker-compose.yml`, `biome.json`, `tsconfig.json` | — | Nothing |

Five details in there are hard-won and should survive untouched:

- **Workload Identity Federation with an attribute condition** (`assertion.repository == '<repo>'`).
  No long-lived service-account keys anywhere. Without the condition, any GitHub repository could
  mint a token for the project.
- **Per-secret IAM bindings**, never project-level — `app-staging` cannot read prod's connection URL.
  Same for the buckets: bucket-level grants only.
- **The docs bucket is created closed** — uniform bucket-level access, public-access-prevention,
  versioning — and those three are **re-applied on every run**, which is how a console click gets
  corrected. The runtime account gets `objectViewer` + `objectCreator` and deliberately *not*
  `objectAdmin`, so the application cannot destroy a signed contract.
- **"Take traffic" after every deploy.** A rollback pins traffic to a named revision and it *stays*
  pinned; without `update-traffic --to-latest` the next deploy creates a revision serving 0% — a
  green pipeline that changed nothing.
- **`--edition=ENTERPRISE` on Cloud SQL.** me-west1 defaults new instances to `ENTERPRISE_PLUS`,
  which rejects shared-core tiers. Two hours of discovery in one flag.

### The kernel — `src/kernel/`, 1,762 LOC

**Verified liftable: the kernel imports nothing from any domain module.** The boundary rule is not
aspirational, it holds. Take it whole and rename nothing.

`clock.ts` (injected time — no `Date.now()` inside logic, so tests never sleep) · `ids.ts` ·
`errors.ts` (five error codes, one shape) · `config.ts` · `db.ts` · `migrate.ts` (the runner; the
migrations themselves do not come) · `idempotency.ts` · `events.ts` · `work.ts` · `objects.ts`
(Cloud Storage) · `pdf.ts` · `embeddings.ts` · `validate.ts` · `pg-support.ts` (the
`REQUIRE_POSTGRES` skip-vs-fail mechanism) · `audit.ts` · `ui/html.ts` + `ui/tokens.css` +
`ui/fonts/` (Heebo woff2, subsetted Hebrew and Latin).

The Hebrew RTL token layer alone is real work that should not be redone.

**One defect to carry across, found in slice 1.3 rather than read out of the file.** `kernel/db.ts`
builds the `Pool` and attaches **no `'error'` listener**, and nothing else in v3 does either. `pg`
emits `'error'` on an idle client whose backend goes away — a Cloud SQL restart, a failover, a
maintenance window — and Node throws on an unhandled `'error'`, so the process *exits* instead of
degrading. `/health`'s 503 branch never runs, because there is nothing left to serve it. v5 has the
listener and a test that kills its own backend to prove it (`src/db.ts`, `src/db.test.ts`); the
verbatim lift in slice 1.4 must bring it along rather than overwrite it.

### Process and enforcement — the part worth the most

`PIPELINE.md` is the best-written file in the repo and every mechanism it describes was verified to
actually exist. Take it, and take the machinery under it:

- **`AGENTS.md` lean + `CLAUDE.md` as a pointer**, spec-per-module, `tasks/todo.md` for the current
  slice, `docs/decisions/ADR-*.md` so agents cite decisions instead of relitigating them.
- **`.claude/hooks/guard-bash.mjs`** — `PreToolUse` blocker for `rm -rf /`, force push, raw `psql`
  against prod, destructive `gcloud`, `DROP DATABASE`. Exit 2 blocks.
- **`.claude/hooks/after-write.mjs`** — `PostToolUse` formats the touched file and runs *that
  module's* focused tests. Feedback in seconds, not at push time.
- **`SessionStart` hook** printing branch and failing tests, so no session starts blind.
- **`.cursor/rules/*.mdc`** — three file-scoped rules doing what `AGENTS.md` cannot express:
  migration conventions, module boundaries, UI tokens + RTL logical properties.
- **The evals harness** — `evals/runner.ts`, `case.ts`, `subject.ts`, `measure.ts`, and the three
  case kinds (behavioural, retrieval, grounding). Two ideas in it are worth more than the code:
  **`rankAtMost` is a ratchet, not a target** — set to what retrieval achieves today, so the gate
  blocks regression from the first commit while staying green; and **no assertion is ever on a
  distance**, because provider embeddings are not bit-identical between runs and a committed
  distance is a gate that fails for weather.
- **`REQUIRE_POSTGRES` / `REQUIRE_EMBEDDINGS`** — the mechanism that turns a silent skip into a
  failure in CI. A green job that ranked nothing is the failure mode this exists to prevent.
- **`tasks/evidence/*.md`** — one file per slice recording what was actually proved. Twenty-two of
  them. This is why v3's history is legible a month later.
- **`.claude/skills/progress-schematic/`** — the stakeholder-facing schematic skill (SVG, ~60 words
  of prose, arrows only ever point up). Directly reusable; only the band labels change.

---

## Tier 2 — take and extend

### `src/staff/` — auth, sessions, roles (2,769 LOC)

Sound, and the reasoning behind it is right for v5. Keep:

- **Sessions store `token_hash`, not the token** — reading the table gives an attacker nothing to
  ride.
- **Login attempts counted over a rolling window**, cleared on success.
- **The role matrix as code, not a config row.** v3 states this as a deliberate exception to its own
  "policies are data" rule, and the reason is exactly right: *an access-control matrix a database
  write could widen is a privilege-escalation path.* Changing who may mutate should cost a deploy
  and leave a diff.
- **The refusal says `not_allowed` and nothing more** — an operator learns what they may do from the
  board, not by probing commands.

Three gaps v5 must close:

1. **No MFA.** Stack Map §3.1 specifies Identity Platform with enforced MFA, and notes it may
   collapse into Dona Dom's Workspace accounts at no cost. v3 hand-rolled email + password.
2. **No field-level guard.** `national_id` (ת.ז. / ח.פ.) is admin-only, unreachable by any agent
   tool, and access-logged. Nothing in v3 enforces per-field access.
3. **Seeded operators, no invite flow.** v3 creates the first operator from Secret Manager and never
   updates it — fine for one environment, not a way to onboard Dona Dom's staff.

### `src/kernel/audit.ts` — right shape, wrong scope

`ActorKind` is already `tenant | staff | agent | system`, `actorRole` is deliberately unconstrained
(the kernel does not know any module's role vocabulary), and `around()` wraps work so the outcome
and error code are recorded whether it succeeded or threw. That is the right design.

What it does not do: v5's Stack Map commits to logging **every scoped read of tenant data**, not
just commands. `around()` is the hook for it. Extension, not rewrite.

### The document machinery inside `occupancy` — examine before discarding

Migrations 0009–0015 and the code above them: document upload, chunking, ingestion, `lease_facts`,
`extraction_model`, and **`lease_field_reviews`** — the extraction-proposes / operator-promotes flow
that both the Data Model and the Stack Map require. This is **orthogonal to the entity model**. The
tables it writes into change; the machinery may not need to. Read it before rewriting it.

---

## Tier 3 — do not take

`src/portfolio/`, `src/identity/`, and the entity half of `src/occupancy/` — about 4,600 LOC. Not
because they are bad. Because they encode the three shapes v5 examined and rejected.

**1. No Space. `portfolio_assets.unit_id IS NULL` means "building asset."**

```sql
-- migrations/0005_portfolio.sql
unit_id uuid,   -- NULL = a lift, a gate, the intercom
```

This is precisely the two-nullable-columns fork that the Space idea exists to kill. v5:
`Asset.space_id`, a single non-null FK, and a Space is one of
`UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING · STORAGE`. Responsibility then falls out of
location instead of being decided per-asset.

**2. `identity_phones.phone` is a PRIMARY KEY, with no temporal dating.** The migration comment
states the assumption outright: *"one number belongs to exactly one person, system-wide."*

**This one is a security defect under v5's constraints, not a modelling preference.** Israeli mobile
numbers get recycled. A tenancy ends, the number is reassigned, and the new holder messages the
agent — under v3's model the isolation join resolves them to the previous tenant's unit. v5's
`PartyContact` carries `valid_from` / `valid_to` for exactly this reason, and the isolation join is
five hops with two temporal predicates:

```
phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit
```

**3. No ternary responsibility.** No `warranty_end_date`, no `warranty_provider_id`, no
`asset_in_warranty` — so no **תקופת הבדק**, and no way to say a fix is the contractor's. v3 also has
no `ObligationType` catalogue and no `policy_version_id` snapshot, so no resolved call can be
re-explained a year later under the policy that actually decided it.

Related: `occupancy_parties.role` already includes `guarantor`, but nothing prevents a guarantor from
being a service contact. v5 forces `is_service_contact = false` for `role = GUARANTOR` **as a
database constraint** — no toggle, no import path, no agent override.

---

## Not code, and already running

`tasks/fuses.md` tracks external dependencies that were fired during v3 and **whose state carries
forward**. Read it before assuming anything needs starting from zero.

- **Meta WhatsApp Business verification — fired 2026-08-21, in progress.** This is the critical path
  in every v5 document: 4–6 weeks, bureaucratic, uncompressible, and assumed filed in week 1. It may
  already be most of the way through. **Confirm its status before planning around a fresh filing** —
  it could move the pilot date.
- **Twilio OTP — closed 2026-08-22, working.** Israeli deliverability confirmed end to end. Two
  findings worth keeping: Verify returned error 21608 for 15+ minutes after the account read as
  Full, closed by registering the number as a Verified Caller ID over the **voice** channel (console
  caller-ID verification by SMS is geo-blocked for Israel); and **Hebrew is missing from Verify's
  default message locales**, so tenant-facing OTP copy defaults to English — needs custom templates
  or an Israeli fallback provider.
- **The mock-data reframe, 2026-08-25.** Development runs on fixtures *we* define, chosen for
  coverage of the cases that break things; real tenant data enters at sign-off, and the data request
  sent to Dona Dom is *derived from our templates* rather than the reverse. This inverted a
  dependency that had held one slice open for three days. It should be v5 policy from commit one.
  `docs/reference/` holds the lease template and tenant table format it produced.

`docs/guidance/*.md` (emergency reporting, entering the apartment, office contact) are real,
client-shaped knowledge-base content. `docs/decisions/ADR-0001..0004` — prod database isolation, OCR
is required, API keys stay in Secret Manager, personal data reaches the model provider — are still
correct and should be re-adopted rather than re-argued.

---

## Three guardrails

v3's own test suite is the main risk in this transfer, because it will happily go green while
asserting the model we just replaced.

1. **Delete the Tier 3 modules outright; do not edit them.** In one commit, before anything replaces
   them. Editing preserves assumptions silently; deleting surfaces them as compile errors.
2. **Write the v5 `SPEC-*.md` files from the workbook first.** v3's specs are the best-written thing
   in that repo and they describe the old model. Port the *ritual* — spec before code, spec updated
   in the same change — and write the content fresh from `docs/model/`.
3. **Re-derive every isolation eval case, and prove each one fails before it passes.** A case that
   was green before and after the rewrite tested nothing. This matters most for the recycled-phone
   scenario, which v3 could not have had a case for — its model made the situation unrepresentable.

---

## Habits worth inheriting

Not files. The reasoning that made v3 legible, all of it directly applicable:

- **Time comes from an injected clock, never `Date.now()` in logic and never `DEFAULT now()` in
  SQL** — a column default is a second source of truth no test can see.
- **The natural key does the work.** `address_key` for a building, `(unit_id, starts_on)` for a
  tenancy — which is what makes a re-run of an importer a no-op instead of a duplicate, with no
  caller-supplied intent key anywhere.
- **PII columns are commented `-- pii`** so log and export tooling can find them.
- **Never DROP a column in the same release that stops writing it.** Deprecate, drop a release later.
- **Migrations are append-only, DDL and backfill in separate files.**
- **No new runtime dependency without a stated reason in the commit body.** v3 shipped a production
  service on five: fastify, pg, google-auth-library, pdfjs-dist, @fastify/multipart.
- **Every comment explains *why*, and cites the slice or ADR that decided it.** This is why a file
  read cold still makes sense.

---

## What this does not settle

- Whether v5 keeps v3's stack choices — Node 24 / Fastify / raw `pg` / hand-written migrations. My
  read: keep them. No ORM means the isolation join is written in SQL where it can be read and
  defended, which is what the constraint demands.
- The module map. v5's modules follow the workbook's entities, not v3's.
- The sixteen-week cadence's interaction with what v3 already proved. Some week-1–4 work in
  [rollout-cadence.html](rollout-cadence.html) is infrastructure that now exists.
- Whether the v3 GitHub repository moves to a Dona Dom organization alongside the GCP project.
