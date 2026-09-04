# Implementation Plan — Dona Dom v5

> The plan of record for turning four published documents and a field-level workbook into a running
> system. Written 4 Sep 2026. Companion files: [roadmap.md](roadmap.md) — the sixteen weeks;
> [todo.md](todo.md) — the current week's slices; [fuses.md](fuses.md) — external dependencies.
>
> This file holds the **decisions, risks and open questions**. It does not restate the schedule
> ([rollout-cadence.html](../docs/rollout-cadence.html) owns that), the process
> ([pipeline.md](../docs/pipeline.md) owns that), or what the system is
> ([data-model.html](../docs/data-model.html) and [model/](../docs/model/) own that).

## Overview

Sixteen weeks, one developer directing agents, a demo every Thursday. Month one builds a system of
record for 1,500 units where every value traces to the paper it came from; month two makes the
console work with no AI in it; month three puts the agent on both ends of a service call for one
72-unit building; month four survives contact with reality and produces the numbers M4 decides on.

**The calendar, fixed 4 Sep 2026.** Week 1 starts **Sunday 6 September 2026**. The working week is
**Sun–Thu**; holidays are worked through and are not modelled. Freeze Wednesday, demo Thursday — the
ritual is unchanged.

| | Weeks | Gate |
|---|---|---|
| Month one | W1 Sun 6 Sep – Thu 10 Sep … W4 Sun 27 Sep – **Thu 1 Oct** | **M1** |
| Month two | W5 Sun 4 Oct … W8 Sun 25 Oct – **Thu 29 Oct** | **M2** |
| Month three | W9 Sun 1 Nov … W12 Sun 22 Nov – **Thu 26 Nov** | **M3 · go/no-go · pilot live** |
| Month four | W13 Sun 29 Nov … W16 Sun 20 Dec – **Thu 24 Dec** | **M4 · scale decision** |

Two consequences of a Sun–Thu week, named rather than discovered. **Thursday is the last working
day**, so the asks a demo generates sit until Sunday — the Cadence chose Thursday partly because it
left Friday for exactly that. Decided 4 Sep: keep Thursday as published in all four documents, and
carry the three-day gap knowingly. And **four build days, not five** (Sun–Wed, the freeze landing
Wednesday), which is what sizes a week at roughly six slices — see risk R1 for week 1, the one week
that exceeds it.

The plan is **deep for weeks 1–4 and coarse for weeks 5–16**, deliberately. M1–M4 are where scope
gets re-planned on the record; writing slice detail for week 11 now produces fiction that M1
invalidates. Each gate hands the next month its detail.

---

## Architecture decisions

Numbered as they will become ADRs. The four v3 ADRs — prod database isolation, OCR is required, API
keys stay in Secret Manager, personal data reaches the model provider — are **re-adopted, not
re-argued** ([from-v3.md](../docs/from-v3.md)).

**A1 · The repository is this directory.** `git init` here, code alongside `docs/`, so the workbook,
the four documents and the ADRs sit inside the context layer the agents read. v5 is a new repo and a
new GCP project; v3 at `/Users/asafwilder/dona-v3` is a reference that is copied from and then owned,
never imported, submoduled or symlinked.

**A2 · Stack inherited whole.** Node 24 with native type stripping (no build step), Fastify, raw `pg`
with hand-written SQL migrations, Biome, `node --test`, Cloud Run + Cloud SQL Postgres 16 + pgvector
in `me-west1`. **No ORM, and the reason is the constraint, not taste:** the isolation join must be
written in SQL in one file where it can be read and defended a year later in a dispute.

**A3 · The module map follows the workbook's entities, not v3's.** v3's `portfolio` / `identity` /
`occupancy` encode the three shapes v5 rejected and are not taken.

| Module | Entities | Note |
|---|---|---|
| `kernel` | — | Lifted verbatim. Imports nothing from any domain module; verified. |
| `staff` | — | Lifted and extended: MFA, the `national_id` field guard, an invite flow. |
| `estate` | E1–E4, E11 — Project · Building · Space · Unit · Asset | The new spine. Space is the single answer to "where is this?" |
| `parties` | E5, E6 — Party · PartyContact | Temporally dated contacts. The agent's front door. |
| `tenancy` | E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType | Mutable row + append-only `TenancyEvent`. |
| `evidence` | E12, E13 + **E15, E16** — Document · DocumentLink · DocumentType · DocumentTypeField · ExtractedField · FieldPromotion | Schema-driven ingestion (A8). Two engines: Document AI for coordinates, OpenAI for meaning. |
| `scope` | — | **The isolation join and nothing else.** |
| `policy` | responsibility matrix · SLA · escalation | Month two. Versioned data, no AI. |
| `calls` | ServiceCall · Visit · state machine | Month two, agent-free; month three, agent-driven. |
| `channel` | Conversation · Message · WhatsApp adapter | Month three. |

**A4 · `scope` is a module of its own because the guard needs a target.** The pipeline requires that
only one module constructs tenant scope, enforced by a grep over the join's temporal predicate. A
dedicated module makes the guard one line and the violation obvious. `src/scope/` is the only place
the five hops are written:
`phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`.

**A5 · Migration order is the dependency graph, bottom-up.** Append-only, DDL and backfill in
separate files, never a `DEFAULT now()` — time comes from the injected clock, because a column
default is a second source of truth no test can see.

```
kernel durability ─┬─ staff auth
                   └─ estate: project → building → space → unit → asset
                                │
                       parties: party → party_contact
                                │
                       tenancy: tenancy → tenancy_party → obligation_type → obligation
                                │
                       evidence: document → document_link → extracted_field
                                │
                       scope: the current-occupancy VIEW and the five-hop join
```

**A6 · Vertical slices are the cadence's weeks.** Each week ends in a Thursday demo, which is what a
vertical slice is for. Within a week a slice is one focused session — half a day or less, three
acceptance bullets or fewer, ending with staging current and an evidence file written.

**A7 · The corpus has three tiers, and only one of them is ours.** Writing our own leases and then
testing extraction against our own assumptions tests nothing — so the development substrate is
**published specimens, not inventions**:

1. **Specimen documents** — the **דירה להשכיר standard lease**, the standard פרוטוקול מסירה, ערבות
   בנקאית forms, ארנונה bill and insurance certificate specimens. State-regulated, publicly
   published, real in structure and real in Hebrew legalese, containing no real person. This is the
   substrate the gates run against and it is committed to the repo. It is also, not incidentally, the
   template most of Dona Dom's 1,500 leases are built on.
2. **Real documents from Dona Dom** — available week 1. They do the one job specimens cannot: measure
   accuracy against scans, handwriting and signatures. Behind the controls built in week 1 (**R4**),
   in their own dated bucket, with a removal date recorded when they land.
3. **Synthetic register rows** — the tenant / unit / phone table, designed for coverage of the cases
   that break things. The data request eventually sent to Dona Dom is *derived from* this template
   rather than dictating it.

No slice ever stalls on someone else's inbox, and no gate is ever green because it was measured
against a document we authored to pass it.

**A8 · Capture is open; promotion is governed.** *The concept this project's document pipeline is
built on, settled 4 Sep 2026.* The system is a **schema-driven ingestion engine, not a lease
parser**: its inputs are a document, a declared type, and that type's field schema.

- **Capture** — document type → field schema → OCR word boxes → the model fills the values → stored
  as `ExtractedField` with `(page, bbox, confidence, model, schema_version_id)`. **Fully dynamic.** A
  new document type is a row. A new field is a row. Zero migrations, zero deploys, and the value is
  visible, citable and searchable the moment it is extracted. Document types and fields *will* keep
  arriving — a new tender's addendum, a municipality's ארנונה format, a ועד בית agreement — and none
  of them may cost a release.
- **Promotion** — an extracted value becoming a *typed column* on a business record
  (`Tenancy.start_date`, `Asset.warranty_end_date`). **Deliberately governed:** it costs a migration
  and a reviewed mapping, because those columns are what the isolation join, the responsibility
  matrix and the state machine read. "An admin added a field on Tuesday and the responsibility answer
  changed" is the failure the workbook already ruled out when it made `asset_type` guarded rather
  than admin-editable.

So a new field is **useful on day one** and becomes **business truth** only through a mapping someone
signed. This is not a new principle — it is the shape of two decisions already settled in the
workbook (`ObligationType` is an admin-managed catalogue; `asset_type` is guarded), applied to
documents.

`DocumentTypeField` is **versioned with `effective_from`**, for the same reason `policy_version_id`
is: a value extracted under version 3 of a schema must still be explicable a year later.

**A9 · The catalogue is dynamic from week 3; its admin screen lands in month two.** The mechanism is
schema-driven from the first migration — types and fields are rows, added with no release — but
during development *we* are the ones adding them, through seeds. The admin CRUD screen arrives in
month two, alongside the `ObligationType` settings screen whose pattern it shares. Deactivated, never
deleted: a retired type still has documents pointing at it.

**A10 · In bulk, convention proposes and a human confirms.** Nobody declares the type of 1,500 units'
worth of Drive files by hand, and nothing detects it either. The folder path and filename **propose**
a type — the path is already a hint that pre-fills a binding — the verification guard checks the file
matches the slot, and a human confirms in a confidence-ranked review queue before anything is filed
as truth. The obvious ones clear in bulk; only the ambiguous ones need a look. This is still
"declared, not detected": the proposal is a hint, and a person signs it.

---

## Definition of Done

The standing bar every slice clears, on top of its own acceptance criteria:

- [ ] `SPEC-<module>.md` updated **before** the code, in the same change
- [ ] `npm run typecheck` · `npm run lint` · `npm test` green locally
- [ ] `tests/policy/` green — and any new deterministic constraint has a case that was **red first**
- [ ] `npm run evals` green; no silent skips (`REQUIRE_POSTGRES=1`, `REQUIRE_EMBEDDINGS=1`)
- [ ] Diff read by a human before merge; CI is the gate, but nothing merges unread
- [ ] Merged green → staging deployed itself → `infra/smoke.sh` passes against staging
- [ ] `tasks/evidence/<slice>.md` written: what was proved, with the numbers
- [ ] No new runtime dependency without a stated reason in the commit body
- [ ] **Every item the slice raised is written into the entry of the slice that closes it** — in
      `todo.md` and `roadmap.md`, not only in the evidence file. The bar is not *nothing open*; a
      week of dependent slices always leaves things open. The bar is **nothing open that is
      unowned** ([pipeline.md](../docs/pipeline.md) §8)

---

## The three success numbers

Open question #3 in [HANDOFF.md](../HANDOFF.md) settles the headline and leaves two to propose. These
are the proposal, to be agreed with Dona Dom at the **week-1 demo** and measured from week 12.

1. **Share of service calls closed with no human involvement.** *Settled.* The headline. Measured
   over calls that entered the agent, excluding emergency bypasses, which are a success when they
   *do* reach a human.
2. **Time from a tenant's first message to a booked visit slot** — median and p90. This is the number
   that measures the seventy percent of the engineering that photographs badly: two-sided
   asynchronous negotiation between two people never online at once. A "response time" metric would
   measure the trivial half instead. p90 matters more than median here: the tail is where the
   provider went quiet.
3. **Escalations per 100 calls, split by cause** — agent could not answer · provider went silent ·
   policy gap · emergency bypass. Deliberately not "escalation rate", because a low undifferentiated
   rate hides silent failure and is worse than a high one that is understood. The split is what makes
   M4 a decision about *what to fix at 200 units* rather than a single number to argue about.

Two **stop conditions**, which are not success numbers and are not traded off against them:

- **Zero tenant-isolation breaches.** One breach halts the pilot; it does not lower a score.
- **Zero tenant-facing prices or balances.** Two standing refusal cases in the golden set, never
  relaxed, not in v2.

---

## Risks

| # | Risk | Impact | Bites | Mitigation |
|---|---|---|---|---|
| **R1** | **Week 1 is over-subscribed.** Twelve slices at nominal half-day sizing is ~5.5 slice-days against 4 build days. Later weeks sit at six or seven. | Medium | W1 | It works only because six of the eleven are **verbatim lifts** from v3 with no design decisions in them. The cut line in [roadmap.md](roadmap.md) is the release valve, and 1.7 and 1.10 are marked not-cuttable. If it spills, it spills into week 2's Sunday — safe, because week 2's demo depends on the import, not on week 1's screen. Do not let it spill twice. |
| **R1b** | Client availability over the חגים, which are worked through on our side but not necessarily on theirs | Low | W2–W4 | Not modelled in the schedule, by decision. The exposure is other people's calendars — the ERP keys fuse and the Drive owner — which is what the fuse table and the weekly asks slide exist to make visible. |
| **R2** | Meta verification stalls or was filed against the wrong entity | High | W9 | **Substantially de-risked.** Filed 2026-08-21 under the correct legal entity and burning: 4–6 weeks puts it between 18 Sep and 2 Oct, five weeks ahead of the week-9 need. Fallback stays armed — build W9–11 against a message simulator, swap the live number in, BSP in reserve. Standing line on the asks slide from week 1. |
| **R3** | The structured register is not what the export promises | Medium | W2 | **Reduced** — a clean Priority export exists. What remains is the ERP read-only keys fuse (client IT's calendar) and the quality of the export itself. Fallback unchanged: a curated slice of the 72 pilot units, the 1,500-unit claim moves to M2, a named Dona Dom owner takes the backfill. |
| **R4** | **Real documents arrive in week 1, not week 4.** Real names, ID numbers and signature images in a cloud project from the first week — the exposure moved *earlier*, not away. | **High** | W1 | Controls built **before the data lands**, in slice 1.12: a dated bucket of its own with a lifecycle rule and a tested deletion path, `-- pii` column comments, access logging on every scoped read, and a removal date recorded the day the corpus arrives. Hours, not a workstream. Functionality is developed and gated against tier-1 specimens (A7); the real corpus does accuracy, not development. |
| **R5** | Demo pressure crowds out the async negotiation engine | High | W11–13 | The engine gets a six-week band (W7–W12), not a week. One declared evidence week per month, budgeted. A standing "what's underneath" line in every demo. |
| **R6** | The cadence costs 6–8% of engineering capacity | Medium | Ongoing | In the plan, not absorbed. Roughly half a day a week; weeks are sized at ~6 slices, not 10. |
| **R7** | Lifted v3 tests go green while asserting the model v5 replaced | High | W1–W2 | Delete Tier 3 modules outright in one commit rather than editing them — compile errors surface assumptions that edits hide. Re-derive every isolation case and prove each red first. |
| **R8** | The GCP project is created outside an organisation and cannot be migrated cleanly | Medium | Later | Create under an organisation now, get an `@donadom.co.il` identity before the move, move before real tenant data lands. **Interacts with R4, and week 1 now starts that clock** — hence the real corpus in a bucket of its own, so the move stays an admin task rather than a data-custody event. |
| **R9** | An admin-editable field catalogue drifts into policy — someone adds a field that something deterministic starts reading | Medium | W5+ | A8's split is the mitigation and it is structural, not procedural: capture is dynamic, promotion to a typed column costs a migration. A contract test asserts that no policy input, isolation predicate or state-machine guard reads an `ExtractedField` value directly. |

---

## Open questions

1. ~~**When does week 1 start?**~~ **Closed 4 Sep 2026: Sunday 6 September**, Sun–Thu weeks, holidays
   worked through and not modelled. Thursday demo kept as published. See the calendar in the overview.
2. **How many distinct `terms_profile`s are in force?** Multi-week swing on week 6. Closed by week 5's
   promotion work, which is where the answer surfaces from the leases themselves.
3. **What does the Priority export actually contain** — units and tenancies both, or units only?
   Decides whether week 2 is one importer or two. The keys fuse answers it.
4. **Are the Shoham buildings still inside תקופת הבדק?** Decides whether week 6's ternary
   responsibility has a live case to demo or a synthetic one.
5. **Where does the in-house crew's availability live?** Determines whether month three integrates a
   calendar or invents scheduling. Not on the critical path until week 11.
6. **Which document types does the seed catalogue start with?** The eight in the Data Model are the
   floor. What else is already in the Drive folders — ועד בית agreements, sub-metering, inspection
   certificates — decides how much of A9's dynamism gets exercised before month two. Answered by
   looking, in week 1, once Drive access lands.

---

## Task list

Tasks live in [roadmap.md](roadmap.md) — weeks 1–4 as slices with acceptance criteria, weeks 5–16 at
week level. The current week's working copy is [todo.md](todo.md), rewritten every Monday with the
declared demo kind at the top.

| Phase | Weeks | Gate |
|---|---|---|
| Foundation — the record exists and you can trust it | 1–4 | **M1** |
| The rules are explicit, and the console works without AI | 5–8 | **M2** |
| The agent takes the call and books the visit | 9–12 | **M3 · go/no-go** |
| It survives contact with reality | 13–16 | **M4 · scale decision** |
