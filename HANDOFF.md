# Dona Dom Platform — Session Handoff

> **Read this first in a new session.** It carries the decisions *and the reasoning behind them*,
> so they don't get relitigated. Last updated 3 Sep 2026. No application code exists yet.
> [CLAUDE.md](CLAUDE.md) is the shorter orientation; this file is the depth behind it.

## Companion documents

The three design documents are stored in this repo as the exact sources they were published from.
**As of 2 Sep 2026 every local file is byte-identical to its published artifact.** Edit locally, then
republish to the same URL with the `Artifact` tool, passing `url` so it updates in place.

| Document | What's in it | Local | URL |
|---|---|---|---|
| **Data Model** | Three planes, five tests, entity catalogue, ER diagram, three lifecycles, responsibility matrix, ingestion, isolation, acceptance queries, open questions | [docs/data-model.html](docs/data-model.html) | https://claude.ai/code/artifact/3212edef-b3ca-4046-a03d-0de9eaf4afc7 |
| **Platform Brief** | Problem, direction, kill-assumptions, MVP scope, the 16-week sequence in four phases, not-doing list, discovery questions | [docs/platform-brief.html](docs/platform-brief.html) | https://claude.ai/code/artifact/43ffdae6-7764-4224-ac71-8b49f13179a4 |
| **Rollout Cadence** — *Sixteen Demos to Pilot* | Week-by-week demo schedule, four monthly gates, the demo protocol, risks with the week each one bites | [docs/rollout-cadence.html](docs/rollout-cadence.html) | https://claude.ai/code/artifact/e925452e-7916-4ce7-8ebd-294f5b323fd2 |
| **Stack Map** | Every third-party dependency, costs at pilot and scale, lock-in analysis, decisions needed from the client | [docs/stack-map.html](docs/stack-map.html) | https://claude.ai/code/artifact/21f24a10-24fc-4908-8d71-3d6a76270337 |
| **Handoff (HTML)** | An older formatted copy of this file — **now behind it**; reconcile before showing it to anyone | *(artifact only)* | https://claude.ai/code/artifact/328f8a74-b426-4a0e-bb74-2831e098f144 |

Also local, and **not** published as artifacts:

- [docs/model/](docs/model/) — the **building/unit model workbook**, drafted to field level and
  answered. English `.xlsx` is the working copy; the Hebrew `.xlsx` is frozen at an older state for
  stakeholder presentations. The `.py` files are the source — edit those and re-run, never hand-edit
  the workbook. Read [docs/model/README.md](docs/model/README.md) first.
- [docs/ideas/dona-dom-platform.md](docs/ideas/dona-dom-platform.md) — the original one-pager.
- [archive/2026-09-03-pre-cleanup/](archive/2026-09-03-pre-cleanup/) — every document as it stood
  before the 3 Sep editorial cleanup, which stripped change-log framing out of the client-facing
  documents. The four **original artifacts were not modified** and are still live at their old URLs;
  the table above points at the cleaned versions, which are new artifacts. Nothing is maintained in
  the archive — it exists so an earlier argument can be recovered.

**Where the reasoning lives.** This file and [docs/from-v3.md](docs/from-v3.md) are the designated
home for it. The four published documents state what the system *is*; they deliberately no longer
carry the record of what an earlier draft got wrong, which direction was rejected, or what changed
between revisions. When that history matters, it is here — not in a document a client reads.

**Which document wins.** The three were reconciled deliberately on 2 Sep 2026; preserve the order.
The **Data Model** is the authority on what the system *is*. The **Rollout Cadence** is the authority
on *schedule*. The **Platform Brief** is the client-facing argument and defers to both — its §05 is
explicitly a four-phase summary of the cadence.

---

## What this is

An AI-based tenant service platform for **Dona Dom**, the rental arm of the Dona group, managing
1,500+ apartments in Israel. Two halves:

1. **An admin web application** — buildings → units → tenancies → parties → documents → assets →
   service providers. Covers all 1,500 units from day one.
2. **A WhatsApp agent on both ends of a service call** — takes tenant calls, understands who is
   responsible under the lease, gives self-service advice, and when it can't resolve, negotiates a
   visit with a provider over WhatsApp and books it.

**Hard constraint, stated by the client and never to be softened:** a tenant may only ever receive
information derived from their own documents and the global knowledge base. A tenant must never get
information about or for another tenant.

## Context that changes the design

Dona Dom operates under Israel's **דירה להשכיר** government tenders — projects that must run as
rentals for 20+ years. Roughly 72 units Shoham, ~200 Beit Shemesh, ~400 Ashdod, ~500 each Lod and
Ashkelon.

- Whole buildings, one owner, dense sites. One technician, one address, nine calls.
- Largely **standardised state-regulated lease templates**, not 1,500 bespoke contracts.
- Israeli rental law puts most wear-and-tear and infrastructure defects on the landlord.
- **תקופת הבדק** (defect/warranty period on new construction) makes responsibility **ternary** —
  tenant / operator / **contractor-warranty** — not binary.
- **חוק התקשורת** — service messages and marketing must ride separate rails.

**Consequence:** the scariest-sounding requirement ("the AI must read the contract and decide
responsibility") is the *small* problem — a lookup table with an AI front-end. The hard problem is
that there is no reliable system of record underneath.

---

## Architecture

**The agent is a switchboard, not a chatbot.** One `ServiceCall`; two WhatsApp threads bound to it
(tenant side, provider side); the admin console as a third view. No provider app — providers change
nothing about their habits.

| Layer | What | AI? |
|---|---|---|
| 1. Record | buildings → units → tenancies → parties → documents → assets → tickets | No |
| 2. Policy | responsibility matrix, SLA clocks, escalation rules | **No — deliberately** |
| 3. Orchestration | ticket state machine, timeouts, retries | No |
| 4. Agents | tenant-facing, provider-facing, admin-facing; scoped tools only | Yes |
| 5. Transport | WhatsApp Cloud API (both directions) + admin web app | No |

The hardest engineering is **two-sided asynchronous negotiation** in the `OFFERED` state — two humans
never online at once, no delivery guarantee, either side can go silent. Roughly 70% of the work.
That is distributed systems, not prompting.

---

## Settled decisions (with the reasoning — do not relitigate without new information)

1. **The agent is in front, not in the loop.** It handles calls directly and clears humans from
   handling all of them. A human-drafts-replies design was explicitly rejected by the client. Humans
   appear on escalation only.

2. **Switchboard, no provider portal.** Building for providers is the most complicated path —
   tradesmen are very hard to move off their habits. The agent WhatsApps them with the call details
   and options; they approve, counter-propose, or reject in a normal chat.

3. **Money never touches the agent.** Client's instruction. Decomposed into: *liability* (who pays —
   v1, stated without a number), *ballpark cost* (internal, admin dashboard only, later), *payment*
   (never — Priority ERP). Log `actual_cost` from day one so the ballpark feature builds itself.

4. **Document type is declared, not detected.** The flow knows what it asked for ("upload the lease
   for unit 14"), so classification — the riskiest ingestion step — simply doesn't exist. What
   remains is a cheap **verification guard** for the real error: right slot, wrong file.

5. **Evidence vs. fact.** A `Document` is what a piece of paper says — immutable, hashed, dated.
   A `Tenancy` is what is true about a household in a unit right now. A lease, an amendment and a
   termination notice all describe one tenancy, so something must reconcile them into a single
   answer — either **once, at promotion**, or repeatedly inside every query that ever touches a
   tenancy. Time also changes truth with no document involved: a tenancy becomes active, then ends,
   because a date passed.

6. **"Promotion"** = copying an extracted value onto a typed column of the business record, keeping
   `(document_id, page, bbox, confidence, promoted_by, promoted_at)`. **Provenance is what makes the
   agent trustworthy** — an operator can click a value and see the pixels it came from.

7. **Vocabulary: "lease" only ever means paper.** The reconciled truth is a `Tenancy`
   (participants via `TenancyParty`). Renamed from `Lease` because it was confusing.

8. **Tenant isolation is a temporal data-modeling problem, not an AI problem.** The chain is
   `phone number → Party → active Tenancy (today ∈ [start, end]) → Unit → scoped rows`, enforced in
   SQL *before* any model call. **`current_tenant` must be a view, not a column.** A model that
   misbehaves cannot widen the scope because it never held the wider scope.

9. **Mutable `Tenancy` row + append-only `TenancyEvent`** (field, old→new, actor,
   `source_document_id`). Deliberately **not** event-sourced — state is never replayed from the log;
   reads hit a normal row.

10. **We own `Tenancy`. Financials stay in Priority.** We hold foreign keys and read-only reference
    data. We never write to the ERP.

11. **No AI in the responsibility decision or the state machine.** Both must be inspectable,
    versioned, and defensible in a dispute a year later.

12. **Narrow the mouth, not the loop.** Do *not* ship intake-now-dispatch-later — that guts the
    value. Keep the loop complete end to end and narrow what enters it. **The admin app covers all
    1,500 units from day one; the agent serves one 72-unit building.** Data breadth is cheap; agent
    blast radius is expensive. Scale them separately.

13. **Reading documents is two jobs, two engines.** *(Newest decision — client-driven.)*
    **Google Document AI** does OCR (Hebrew print *and* handwriting, word boxes, per-word
    confidence, signature/checkbox detection). **OpenAI** does comprehension (mapping into the
    declared schema). Rationale: decision #6 promises page/bbox/confidence provenance — *a language
    model asked for coordinates produces plausible coordinates; an OCR engine measures them.* Buy the
    **general OCR processor, not Form Parser** — the schema is already declared, so Google needn't
    infer structure (~20× cheaper).

14. **OTP over WhatsApp first, SMS only as fallback.** What must be bound is *this phone's WhatsApp*,
    since that carries every future conversation — so delivering the code through that exact channel
    proves precisely the right thing.

15. **WhatsApp Cloud API direct, not through a BSP.** No per-message markup, no layer between us and
    the message log. Keep a BSP in reserve only if Meta verification stalls.

16. **Sixteen weeks with a weekly demo, not twelve weeks of heads-down build.** Four monthly gates
    carry the decisions; the weeks between carry the proof. A weekly demo is *evidence of progress*,
    not a weekly feature — promising a working feature every week guarantees a broken promise around
    week three, when the work is Meta verification and a data backfill. Three currencies count
    (working software / real data / evidence) and the week's kind is declared Monday. The cadence
    costs ~6–8% of engineering capacity; that belongs in the plan, not absorbed silently and blamed
    for a slip in month three. **M2 is the most valuable point in the plan** — a console covering all
    1,500 units that depends on no agent, no Meta and no model behaving. Everything after it is
    upside built on ground already owned.

17. **Google Drive is a source, never the system of record.** The documents already exist there,
    organised per apartment — which shapes month one as ingestion rather than expedition. Copy and
    hash at ingest; keep `drive_file_id` as provenance and the folder path as a *hint* that pre-fills
    a binding. The path is never itself the binding. See open question #0.

## Explicitly rejected

- **Agent-in-the-loop only** (human drafts, agent assists) — misses the point; agent must be in front.
- **A provider app or portal** — the adoption tax falls on the people least willing to pay it.
- **Tenant-facing prices or balances — ever, not just v1.** "Around ₪400" against an ₪850 invoice is
  a broken promise, in writing, timestamped, on the client's behalf.
- **A ticketing SaaS (Zendesk/Freshdesk)** — the ticket and its state machine *are* the product.
- **A CRM, a chatbot platform, a vector DB (use `pgvector`), a payment processor, a BI tool.**
- **Move-in/move-out workflow** — valuable, genuinely separate. The second sale.
- **Predictive fault clustering** — needs six months of clean history. *Design for it* (tag every
  ticket with unit, floor, riser, asset) but don't build it.
- **Emergency handling by the agent** — a 02:00 burst pipe bypasses triage and reaches a human.

---

## Data model spine

```
Building → Unit → Tenancy → TenancyParty → Party
                     ↑
                  Document → DocumentSchema
                     │           ↑
              ExtractedField   DocumentRequirement
Asset ─┐
       ├→ ServiceCall ← ResponsibilityPolicy ← IssueCategory
Unit ──┘        ↓              ↑
              Visit         SlaPolicy
            Provider
     Conversation → Message
     TenancyEvent · AuditEvent · Financials [erp, read-only]
```

Key fields worth remembering:

- `Unit` — **no `current_tenant` column** (see decision #8).
- `Tenancy` — `terms_profile_id`, `start_date`, `end_date`, `status`
  (`upcoming|active|ending|ended|terminated`), `rent_amount`, `escalation_rule`, `erp_contract_id`.
- `TenancyParty` — `role` (`tenant|co_tenant|guarantor|occupant`), `may_speak_for_tenancy`.
- `Party` — `phones[]`, `language` (locked field), `national_id`, `erp_customer_id`.
- `Document` — `schema_id`, `file_hash`, `subject_type/id`, `valid_from`, `expires_at`,
  `tenant_visible` (readable by admins **and** by the tenant it belongs to).
- `DocumentSchema.type_key` — `lease`, `lease_amendment`, `termination_notice`, `arnona`,
  `insurance`, `id`, `bank_guarantee`, `handover_protocol`.
- `ResponsibilityPolicy` — `(category_key, terms_profile_id, asset_in_warranty) → responsible`,
  with `effective_from/to`. The `asset_in_warranty` dimension is what makes תקופת הבדק work.
- `Asset` — `warranty_until`, `warranty_holder`, `install_batch`.

**Languages:** five (he/ru/ar/fr/en). Store `body_original` + `body_he` (canonical for ops);
provider-facing is always Hebrew. **Voice notes are day-one table stakes** — Israeli tradesmen
answer in them.

---

## Stack and cost (see Stack Map for detail)

Four vendors matter: **Google** (Cloud Run, Cloud SQL + pgvector, Cloud Storage, Cloud Tasks,
Document AI), **OpenAI**, **Meta** (WhatsApp), and an **OTP** provider. Region `me-west1` (Tel Aviv).

- Pilot (72 units): **≈ $200–450 / month**. Steady state (1,500 units): **≈ $750–1,850 / month**.
- One-time document backfill: **$400–1,200** (OCR is under $100 of that).
- **Lock-in:** Meta = High (no substitute; mitigation is that every message lives in our Postgres).
  Google Cloud = Medium. OpenAI, Document AI, OTP, ops tools = Low.
- **Residency flag:** Document AI likely does not run in `me-west1` — processing would land in the
  EU or US multi-region. If Israeli residency is contractual, this is the one component needing an
  exception.

**The critical path is bureaucratic, not technical:** Meta business verification takes 4–6 weeks and
no engineering speed compresses it. Start it the week the project is approved.

---

## Open questions, ranked by what they change

0. ~~**Where does the data physically live today?**~~ **Half answered, 2 Sep 2026.** Lease and
   building **documents** are organised per apartment on **Google Drive** — so the document backfill
   is an ingestion problem against a known source, not an expedition. Drive is a *source*, never the
   system of record: files are copied into object storage and hashed at ingest, `drive_file_id` kept
   as provenance and the folder path kept only as a hint that pre-fills a binding. **A folder name
   must never itself be a binding** — if isolation resolved through one, someone tidying Drive on a
   Tuesday would break the client's absolute constraint. *What remains open is #1.*
1. **Does the structured register exist, and is Priority its master?** *(biggest remaining unknown)*
   Units, tenancies and parties as data — not as leases. A clean Priority export means month one
   holds. A spreadsheet per site, or nothing but the leases themselves, and backfill becomes its own
   workstream on **Dona Dom's** calendar — the real critical path, worse than Meta verification.
   Bites week 2.
2. **How many distinct `terms_profile`s are in force?** One shared maintenance annex → the
   responsibility matrix is a flat category-to-party table and week 6 shrinks. Five per-project
   variants → the policy layer needs versioning and an admin editor. Multi-week swing.
3. ~~**Who is the named pilot owner, and what three numbers define success?**~~ **Downgraded,
   2 Sep 2026 — not a blocker.** *Pilot owner:* the client has a contact person at Dona Dom and will
   name the daily queue-watcher later; do not raise it again unprompted. *Success numbers:* the
   headline one is settled — **calls closed with no human involved**. The other two are ours to
   propose and agree with the client while we write the granular roadmap. Until all three exist,
   M3 at week 12 is a judgement call rather than a measured gate, and M4 has nothing to count —
   so the roadmap must define them, not assume them.
4. **Where does the in-house crew's availability live** — a calendar API, a whiteboard, or someone's
   head? Determines whether month three is integration or inventing scheduling.
5. **Actual language mix per site.** If 90% Hebrew, ar/fr/en become v1.1 and week 10 lightens.
6. **Fixed-price or T&M** — does the rollout plan double as a contract schedule? Changes buffer and
   milestone granularity.
7. Who owns the Meta Business account and the WhatsApp number? (Must be Dona Dom's legal entity and
   a company-controlled number — never a personal mobile.)
8. Whose GCP organisation does this run in — theirs, or ours re-billed?
9. Is US processing of message content acceptable under a zero-retention agreement? If not, the model
   layer moves to Gemini in-region, at a real cost in Hebrew quality.
10. Is data residency in Israel contractual or merely preferred?
11. What does Priority actually expose, and who is the IT contact?
12. Is Dona Dom on Google Workspace? (If so, admin SSO/MFA costs nothing extra.)
13. How is a phone number bound to a party the first time — shared numbers, numbers changing
    mid-tenancy?
14. Are the pilot buildings still inside תקופת הבדק?
15. Do tenants already message a person they know? *(the sneaky adoption killer — the real competitor
    is the building WhatsApp group and the technician's private mobile)*
16. What SLA was committed under the tender, and what is the 02:00 emergency path?

---

## The sequence, in one place

Set by **Rollout Cadence**; summarised in Brief §05. Every week number anywhere in this repo means
this schedule.

| | Weeks | What is true at the end of it | Gate |
|---|---|---|---|
| **Month one** | 1–4 | A system of record for 1,500 units where every value traces to the paper it came from. Meta verification filed week 1. | **M1** |
| **Month two** | 5–8 | The console works without AI: promotion with provenance, the ternary responsibility table, the state machine walked by hand, isolation attacked live and holding. | **M2** |
| **Month three** | 9–12 | The number is live, the agent answers, the loop closes, and the 72-unit building is on it with real tenants. | **M3 · go/no-go** |
| **Month four** | 13–16 | Failure modes rehearsed on purpose, five languages and voice, and four weeks of measured history. | **M4 · scale decision** |

**Pilot live at week 12; the plan runs to 16.** Two different dates, both real. Week 12 is the
earliest honest claim that it works; M4 is when there is a number to decide on.

The demo contract: a weekly demo is **not** a weekly feature. Each week delivers *working software*,
*real data* or *evidence*, declared Monday, frozen Wednesday, shown Thursday. Week 13 deliberately
has no new screen.

---

## Where we left off

The refinement arc is complete and **all three documents have been reconciled against each other**
(2 Sep 2026). The Data Model was approved first and treated as authority; the Brief was aligned to
it; then the Brief's schedule and the Rollout Cadence were aligned, and the Cadence's content was
brought up to the Data Model. Three documents, one vocabulary — the state names, entity names and
week numbers now mean the same thing in all three.

**Then the model went one level down (3 Sep 2026).** The building/unit half of the Data Model was
drafted to field level as a workbook — entities, relationships, every column, the admin screens
those columns have to produce — and the six genuine forks in it were put to the client and answered.
That is the workbook in `docs/model/`, and it is what makes M1 buildable rather than merely described. The
six answers are summarised in [CLAUDE.md](CLAUDE.md) under *Settled in the model workbook*; the
reasoning behind each sits on the workbook's own DECISIONS sheet.

Deliberately **not** covered by that pass, and still only at Data-Model level of detail: service
calls, visits, providers, the state machine, and the agent. Those sit downstream of building and
unit. `Provider` appears in the workbook once, as a stub, only because an asset inside תקופת הבדק
must point at whoever owes the fix.

One structural edge is knowingly open: `Space.building_id` is mandatory, so a garden shared between
three cores currently hangs off one of them. Reopen it if Shoham proves multi-core — cheap now that
Project exists. Recorded as R15.

**Next task: the development pipeline.** Two strands, and they meet:

1. **A granular roadmap** decomposing the sixteen weeks into workable detail. Open question **#1** is
   the one that changes the plan's *shape* rather than its detail and is worth chasing first; the
   rest can be carried as flagged assumptions with a note on which week each would bite. **#3 is no
   longer a blocker** — the pilot owner is the client's to name later, and of the three success
   numbers the headline is settled (calls closed with no human); defining the other two is part of
   the roadmap work itself, to be agreed together rather than assumed.
2. **The path from the workbook to a running schema** — stack choices from the Stack Map turned into
   a repo, migrations, and the ingestion path that fills 1,500 units with provenance intact. The
   workbook is the specification for the first month's tables; nothing about it should have to be
   re-decided while writing them.

### Seed prompt for the next session

```
Read CLAUDE.md and HANDOFF.md. We're building the Dona Dom tenant service platform.
The refinement phase is done — data model, platform brief and rollout cadence are
published, approved, and reconciled with each other. All four sources are in docs/
(the fourth is the stack map: vendors, costs, lock-in). On top of them, the
building/unit model is drafted to field level and its six open questions are
answered: docs/model/ — read docs/model/README.md first.
Next up: define the development pipeline — break the sixteen-week cadence into a
granular roadmap, and lay out the path from that workbook to a running schema.
Also propose the two success numbers that sit alongside "calls closed with no human".
Don't re-derive the settled decisions; challenge them only if you have new information.
```
