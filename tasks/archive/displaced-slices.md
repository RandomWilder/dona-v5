# Archived · The displaced slices 7.1–9.5

**Archived 14 Sep 2026, by the director, on the day week 6 closed.** Nothing here was built and
nothing here is deleted. These seventeen slices were decomposed on 9 Sep 2026 and displaced on
13 Sep when week 6 became the two core journeys; they are archived now for a different reason, and
the reason is worth writing down rather than inferring later.

**Why.** Week 6's demo found four defects that eleven green slices and a full CI gate had not, and
the director's reading of that is that the weak link in this project is not the engineering but the
*flow descriptions the engineering is built from* — written in week 1, when the vision they encode
was not yet settled. Building 7.1 through 9.5 against those descriptions would have delivered a
policy layer, a ticket console and an isolation attack that are each correct against a specification
nobody still believes. So the plan stops here, at the point where the foundation is solid and
before the flows are spent on.

**What replaces it.** A track driven by the UI, one screen at a time, starting at the document
intake — where the data actually enters, and therefore where every downstream flow gets its inputs.
The new 7.x slices are numbered from 7.1 and are not these. `tasks/roadmap.md` keeps the calendar and
the month tables, which are never rewritten.

**What is not archived, because it is still owed.** Several items below are not plan, they are debts
this system already carries, and archiving the slice that was going to pay them does not pay them:

- **9.1 — redaction at the provider boundary.** A hard bound the moment a provider is messaged.
- **9.2 — audit on every scoped read.**
- **9.3 / 9.4 — the workflow and IAM pass**, including `run.admin` bound per service and the docs
  buckets' legacy `projectEditor` / `projectOwner` bindings that carry `legacyObjectOwner`, delete
  included. 3.2 proved the *application* cannot destroy a signed contract; a human with project
  editor still can.
- **8.5 — the emergency bypass.** An emergency routes to the duty phone with no model call in
  between, and it must exist before any agent takes a real message.
- **The M2 checkpoint itself**, and the three success numbers agreed in week 1.

Each of those is carried in [../todo.md](../todo.md) with an owner, or it is not owed. Read this file
for the design work already done — the policy matrix as versioned rows, the ternary, the state
machine's eight states and three exits — and take from it whatever the new track needs. It was good
thinking against a specification that changed.

---

## Displaced · Who pays for this, and why — slices 7.1–7.6

> **Decomposed 9 Sep 2026**, from the week-6 row above. **Displaced on 13 Sep 2026** by the two core
> journeys — see week 6 above. The slices renumbered 6.x → 7.x on that date, before any of them had
> been built, so no evidence file names a number that moved. **Which week it runs in is not written
> here, because it is the director's** — see § "What week 6 displaces".

**Demo kind:** Software · **You show:** pick a category and a unit; get tenant / operator /
contractor with the clause and the policy version behind it. Then edit the table live and watch the
answer change. **Depends on:** W5, 3.5 — and it now *runs after* week 6 · **Sized by** open question 2, which 5's header note now
places behind **F3**.

> **`src/policy/` starts here and not before.** 4.8's completeness case lives in the policy *suite*
> and does not start the module ([SPEC-policy.md](../SPEC-policy.md)); it moves into the module this
> week. **Policy cases 4 and 5 are written and go green here**, with the tables that make them
> possible. The isolation week's row lists them too, and that is sequence rather than duplication:
> the policy week writes them, the isolation week attacks them.

### Slice 7.1 — `src/policy/`, and the responsibility matrix as versioned rows
**Responsibility is ternary** — tenant / operator / contractor — because of תקופת הבדק, and a binary
model of it is wrong in a way that is expensive to discover later. Rules supersede by
`effective_from` and **never overwrite**, which is the same shape as `valid_from`/`valid_to` on a
document and `TenancyEvent` beside a mutable row: the current answer is a query, and the old answer
is still there.
- **Done when:** a rule superseded by a later `effective_from` is still readable, and no write path
  updates a rule in place.
- **Verify:** an UPDATE on a rule is refused; two rules with different `effective_from` both exist
  and the resolver picks by date.
- **Deps:** 5.8 · **Size:** L

### Slice 7.2 — Resolution, with the version that decided it
A category and a unit yield a party, the clause behind it, and a **snapshotted `policy_version_id`**.
**Re-resolving after the policy changes must still return what the snapshot says** — the same rule as
`FieldPromotion`'s promoter and `ObligationType`'s `responsible_party`, for the third time in three
weeks, because it is the same rule.
- **Done when:** a resolution stamps its version; changing the matrix afterwards does not change what
  that resolution answers.
- **Verify:** resolve, change the matrix, re-read the stored resolution; the answer is the old one
  and it names why.
- **Deps:** 7.1 · **Size:** M

### Slice 7.3 — `asset_in_warranty`, and the third leg of the ternary
Fed by week 3's asset register (3.5), seeded from handover protocols. This is what makes
responsibility ternary rather than a table with two columns.
- **Done when:** an asset inside its warranty period moves responsibility to the contractor, from
  data, with no code branch naming a building.
- **Verify:** flip one asset's warranty dates and watch the resolved party change.
- **Director's, and it decides the demo:** **open question 4** — are the Shoham buildings still
  inside תקופת הבדק ([plan.md](plan.md))? A live case is a much better demo than a synthetic one,
  and either is a correct slice. Asked at week 5's demo so week 6 knows which it is showing.
- **Deps:** 7.2, 3.5 · **Size:** M

### Slice 7.4 — Policy case 4, red first — `UNIT` is the only space kind that can ever be the tenant's
- **Done when:** the case fails against a resolver that will answer for a `COMMON` or `SERVICE`
  space, and passes when it will not.
- **Verify:** committed red, then green.
- **Owed by 1.7.** The pending mechanism has existed since week 1 precisely so this could be written
  before its table did.
- **Deps:** 7.2 · **Size:** S

### Slice 7.5 — Policy case 5, red first — a live warranty moves responsibility, and the snapshot still answers
- **Done when:** the case covers both halves — the warranty changes the answer, and a resolution
  taken before a policy change still returns the old answer afterwards.
- **Verify:** committed red, then green.
- **Owed by 1.7.**
- **Deps:** 7.3 · **Size:** S

### Slice 7.6 — The matrix, edited live
The half of the demo that lands in the room, built on 5.8's screen pattern rather than a second one.
- **Done when:** the matrix is edited in front of the client and the resolved answer changes, while a
  resolution taken thirty seconds earlier still reads the same.
- **Verify:** demonstrated live on staging, both halves in one sitting.
- **Deps:** 7.5, 5.8 · **Size:** M

---

## Displaced · A ticket, start to finish, by hand — slices 8.1–8.6

> **Decomposed 9 Sep 2026**, from the week-7 row above. **Displaced on 13 Sep 2026**, with its slices
> renumbered 7.x → 8.x before any was built. Its week is the director's.

**Demo kind:** Software · **You show:** walk the canonical states in the console — NEW · IDENTIFIED ·
TRIAGED · RESPONSIBILITY SET · WINDOWS COLLECTED · OFFERED · SCHEDULED · CLOSED — plus the three
exits. The SLA clock runs and the escalation fires. **No WhatsApp, no agent. Depends on:** the
policy week.

> **The agent arrives in month three without changing any of this**, which is the whole point of
> building it agent-free. And **R5's six-week band opens here**: `WINDOWS COLLECTED → OFFERED` is
> roughly seventy percent of the engineering and it photographs badly, so it runs underneath every
> week from the ticket week to the pilot and gets a standing *what's underneath* line in every demo rather than a week of its own.

### Slice 8.1 — ServiceCall, Visit, and the state machine
Eight canonical states and three exits. **The machine is deterministic and no model decides a
transition** — in month three the agent will propose and this machine will still decide.
- **Done when:** every legal transition is a row the code checks, and an illegal one is refused by
  the database rather than by a branch.
- **Verify:** attempt each illegal transition; each is refused. The three exits are reachable.
- **Deps:** 7.6 · **Size:** L

### Slice 8.2 — The console: walk it by hand
- **Done when:** one call goes NEW → CLOSED entirely by clicking, with no seed and no SQL.
- **Verify:** done live on staging, in front of the room.
- **Deps:** 8.1 · **Size:** M

### Slice 8.3 — SLA policies and timers, off the injected clock
Thresholds are policy rows (week 6's module), not constants. `at` comes from the injected clock and
there is no `DEFAULT now()` — the same rule as `tenancy_event`, and for the same reason: a clock a
test cannot move is a demo nobody can give.
- **Done when:** advancing the clock breaches an SLA and the breach is visible without waiting.
- **Verify:** the demo runs on an advanced clock, and the threshold that fired is read from a policy
  row.
- **Deps:** 8.1, 7.1 · **Size:** M

### Slice 8.4 — Escalation
- **Done when:** a breached SLA escalates by rule, to a named recipient, and the escalation is on the
  audit trail.
- **Verify:** watched firing in the demo; the trail read back afterwards.
- **Deps:** 8.3 · **Size:** M

### Slice 8.5 — The emergency bypass, live and tested
An emergency category routes to the duty phone **with no model call in between**. It is a **policy
row plus a routing rule**, never a priority label — a label is something a model can get wrong and a
route is not.
- **Done when:** a policy case, red first, fails if any model call can sit between an emergency
  category and the duty phone.
- **Verify:** committed red, then green, in `tests/policy/`. Deterministic, therefore never an eval.
- **Owed by 1.7, and dated by week 10** — this must exist before the agent takes its first real
  tenant message, which is why it is built in a week with no agent in it.
- **Deps:** 8.4 · **Size:** M

### Slice 8.6 — The negotiation engine's first stones
`WINDOWS COLLECTED → OFFERED` becomes an explicit two-sided asynchronous state with **no counterparty
channel yet** — the provider side arrives at week 11. What lands here is the state, the timers it
needs, and the shape that six weeks of work will fill.
- **Done when:** a call can sit in `WINDOWS COLLECTED` with an offer outstanding, a timeout pending
  and no second party reachable, and nothing in the machine assumes anyone is online.
- **Verify:** named on the demo's *what's underneath* line, with what exists and what does not.
- **Deps:** 8.1 · **Size:** M

---

## Displaced · Try to break tenant isolation, live → **M2** — slices 9.1–9.5

> **Decomposed 9 Sep 2026**, from the week-8 row above. **One item was added that the row does not
> carry** — see 9.1. **Displaced on 13 Sep 2026**, with its slices renumbered 8.x → 9.x
> before any was built. **M2 moves with it, and both its week and M2's are the director's** — see
> § "What week 6 displaces" above.

**Demo kind:** Evidence · **You show:** query as one tenant's phone and try to reach another tenant's
documents, unit and history — through the console, through the API, and by asking the model. Every
path returns nothing. **Depends on:** the ticket week.

> **9.1 is not in the row above, and it is the largest thing in month two.** Redaction at the
> provider boundary is decision 2 of
> [ADR-0004](../docs/decisions/ADR-0004-personal-data-reaches-the-model-provider.md), which left it
> as "its own slice in month one or riding with 4.2" and said it **must land before week 10**. Month
> one is closing without it, and week 10 puts a tenant's own question and their own lease through a
> model call. Month two is therefore the last container, and this week is the one whose demo already
> asks the model to break isolation. **It goes first in the week, not last**, because it is the only
> item in month two with a deadline the project does not control.

### Slice 9.1 — Redaction at the provider boundary
An identifier-shaped run is masked in the copy sent to the embedder and the extractor, and **never in
the copy stored**. Measured on a real contract at v3, 19 of 211 indexed chunks mentioned ת״ז inside
numbered annex clauses; excluding the cover page removes the densest chunk and not the category.
**It needs its own golden cases:** masking must not change which clause answers a question, and that
is a claim the eval suite makes rather than a claim this file makes.
- **Done when:** no identifier-shaped run leaves for a provider, the stored copy is byte-identical to
  what was filed, and the golden set is green **at or below** its existing threshold with masking on.
- **Verify:** the full golden set, before and after, with the ratchet unchanged; a contract test
  asserts the stored bytes are unmasked and the outbound payload is not.
- **Deps:** none in month two · **Size:** L
- **Dated externally by week 10.** If it slips it slips into week 9 and no further, and that is a
  fact for the asks slide the day it looks likely rather than the day it happens.

### Slice 9.2 — Audit on every scoped read
- **Done when:** no read that crosses `src/scope/` completes without an audit line naming who asked
  and what for.
- **Verify:** a contract test that a scoped read with auditing disabled fails rather than proceeds
  quietly.
- **Deps:** 7.6 · **Size:** M

### Slice 9.3 — Workflow hygiene
Bump the four Node-20 GitHub actions — `checkout@v4`, `setup-node@v4`,
`google-github-actions/auth@v2`, `setup-gcloud@v2` — which every run has been annotating as
deprecated since week 1. In the same pass, `release.yml` gains the `docker image inspect` size line
`deploy.yml` already has.
- **Done when:** a full CI + deploy run annotates no deprecation, and a release prints its image
  size.
- **Verify:** one green run of each workflow, with the annotations gone.
- **Owed by 1.6 and 1.10.**
- **Deps:** none · **Size:** S

### Slice 9.4 — The IAM pass
Two bindings, one pass, in the week whose demo is trying to break isolation. **`run.admin` is bound
per service**: the deploy accounts hold it at *project* level because scoping it per service was
impossible before a service existed, and the services exist now. **The docs buckets' legacy
`projectEditor` / `projectOwner` bindings carry `legacyObjectOwner`, which includes delete.** 3.2
proved the *application* cannot destroy a signed contract — no `delete` on the port, no `objectAdmin`
on the runtime account — and a human with project editor still can. 3.2 then measured that exposure
rather than describing it as unbounded: the probe object was removed by hand by exactly such a human,
and versioning plus the explicit seven-day soft-delete window left a recoverable noncurrent version
rather than a hole. **The claim is not that a human with project editor can destroy a signed
contract; it is that they can remove one and have seven days to undo it.** Seven days of grace is not
a control and the binding still goes, but this slice closes a known window and the evidence carries
its size.
- **Done when:** neither deploy account holds `run.admin` at project level, and neither docs bucket
  carries a `legacyObjectOwner` binding — with a deploy run after both, proving the pipeline still
  works.
- **Verify:** `gcloud` policy read on both, before and after, in the evidence file; then a full
  deploy.
- **Owed by 1.5, raised again and given an owner at 3.2.** Two files still schedule these in week 6
  — `SPEC.md` and `infra/bootstrap.sh` — against five that say week 8; both are corrected to point
  here.
- **Deps:** 9.3 · **Size:** M

### Slice 9.5 — The attack — three paths, and every one returns nothing
The demo. Policy cases 4 and 5 have been green since week 6; this week attacks them rather than
writes them.
- **Done when:** as one tenant's phone, another tenant's documents, unit and history are unreachable
  through the console, through the API, and by asking the model — and `national_id` is unreachable by
  any agent tool (5.3, attacked here).
- **Verify:** performed live, all three paths, in front of the room, off staging.
- **Deps:** 9.1, 9.2, 9.4, 6.5 · **Size:** M

---
