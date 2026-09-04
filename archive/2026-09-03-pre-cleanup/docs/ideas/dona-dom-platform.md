# Dona Dom Tenant Service Platform

> Rev A — 1 Sep 2026. Companion artifacts:
> [Platform Brief](https://claude.ai/code/artifact/8c232d40-295c-4fbd-815d-eea6a3b530c5) ·
> [Data Model](https://claude.ai/code/artifact/9459f369-55e4-46fb-88e5-df7b1ab083bc) ·
> [Stack Map](https://claude.ai/code/artifact/571f6a8d-3f93-48db-9b94-361fa71a16c4) ·
> [Handoff](https://claude.ai/code/artifact/328f8a74-b426-4a0e-bb74-2831e098f144)

## Problem Statement

**How might we** let a 1,500-unit rental operator run every tenant interaction and maintenance job
through WhatsApp — with the agent resolving or dispatching most of them unattended — while
guaranteeing that no tenant ever sees a byte of another tenant's world?

Two tensions shape every decision:

- **Trust vs. autonomy.** An agent that answers is low-risk. An agent that commits a technician's
  time is not. Different products, different failure modes.
- **Supply is the bottleneck.** Getting a tenant to describe a leak is easy. Getting a technician
  to confirm, show up, and close the loop is where operations break.

## Context

Dona Dom is the rental arm of the Dona group, built around Israel's **דירה להשכיר** tenders —
long-term rental projects that must operate as rentals for 20+ years. Roughly 72 units in Shoham,
~200 in Beit Shemesh, ~400 in Ashdod, ~500 each in Lod and Ashkelon.

This is materially different from a scattered private-landlord portfolio, and all of it is good news:

- Whole buildings, one owner, dense sites. One technician, one address, nine calls.
- Largely **standardised state-regulated lease templates**, not 1,500 bespoke contracts.
- Under Israeli rental law most wear-and-tear and infrastructure defects fall on the landlord, and
  the operator's pitch is already "we maintain it for you" — so responsibility is far less ambiguous
  than in the private market.

Consequence: the scariest-sounding requirement ("the AI must understand the contract and decide
responsibility") is the *small* problem. It is a lookup table with an AI front-end. The hard problem
is that there is no reliable system of record underneath.

## Recommended Direction

**Build the ticket and its state machine as the product, put a five-language WhatsApp agent on both
ends of it, run it in one building, and let autonomy expand category by category as it earns it.**

The agent is a **switchboard, not a chatbot**. One service call; two WhatsApp threads bound to it
(tenant on one side, provider on the other); one admin console looking down at both. Providers keep
doing exactly what they already do — read a message, reply to it — so there is no provider app to
adopt and no habit to change.

Layering, boring to sexy:

| Layer | What it is | AI? |
|---|---|---|
| 1. Record | buildings → units → tenancies → parties → documents → assets → tickets | No |
| 2. Policy | responsibility matrix, SLA clocks, escalation rules | **No — deliberately** |
| 3. Orchestration | the ticket state machine, timeouts, retries | No |
| 4. Agents | tenant-facing, provider-facing, admin-facing; scoped tools only | Yes |
| 5. Transport | WhatsApp Cloud API (both directions) + admin web app | No |

Layer 2 is what people get wrong. "Who pays for the broken faucet" must be a deterministic lookup
the AI *reads*, never a judgment it *makes*.

### Vocabulary

**"Lease" means only a piece of paper. A "tenancy" is the reconciled truth about a household in a
unit.** A lease, an amendment, and a termination notice all describe the same tenancy, so something
must reconcile them into one answer — either once, at promotion, or repeatedly inside every query.
Time changes truth too: a tenancy becomes active and later ends because a date passed, with no
document involved.

Document types are **declared by the flow before upload** ("upload the lease for unit 14"), never
detected — which removes classification, the riskiest step in ingestion. What remains is a cheap
verification guard for the real error: the right slot, the wrong file.

### The cut: narrow the mouth, not the loop

Do **not** shorten the loop (intake now, dispatch later) — that guts the value. Instead keep the loop
complete end-to-end and narrow **what enters it**: lease/account questions, six maintenance
categories, in-house crew dispatch, one external trade, one building. Anything else exits to a human
immediately and gracefully, in the tenant's language.

Three ordering choices inside that:

1. **The agent's first autonomous act is *answering*, not *acting*.** Lease dates, rent terms,
   building info, document requests. Probably 40%+ of inbound volume, far easier than maintenance,
   and being wrong costs embarrassment rather than a flooded apartment.
2. **Dispatch to the in-house crew before external providers.** Their calendar is ours — no
   negotiation, no timeout, no silence — so the happy path is deterministic and testable.
3. **Pilot one building** (Shoham, 72 units) — but the **admin app covers all 1,500 units from day
   one**. Data breadth is cheap; agent blast radius is expensive. Scale them separately.

## Key Assumptions to Validate

- [ ] **Tenants will message a number instead of a person they already know.** *The competitor is the
      building group chat and the technician's private mobile.* → Ask how a fault is reported today;
      ask a crew member how many WhatsApps they personally get per week.
- [ ] **Tenant phone numbers on file are accurate.** *Identity binding is the whole isolation model.*
      → Sample 50 records in the pilot building.
- [ ] **The responsibility matrix can be written down.** → Ask ops for the rule on five faults
      (dripping AC, blocked drain, dead boiler, cracked tile, broken blind). Five clear answers = a
      policy layer. "It depends" = a research project.
- [ ] **Providers reply to an unrecognised business number.** → Have the dispatcher send three real
      jobs from a new number this week; count replies and response times.
- [ ] **Dona Dom will commit a live building, real data, and their WhatsApp number.** → Get it in
      writing before writing code.
- [ ] **Self-service actually deflects calls.** → Measure deflection per category from week one.

**Pre-mortem.** Three ways this is dead in twelve months: a tenant saw another tenant's data once and
the project was cancelled that week; the agent stated responsibility confidently and wrongly twice
and ops stopped trusting it; providers never answered, humans did everything manually anyway, and we
built an expensive logging tool. Only the first is a security problem. None is a model-quality
problem.

## MVP Scope

**In (v1)**

- Admin web app across all 1,500 units — buildings, units, parties, tenancies, documents, assets,
  providers. Hebrew, RTL.
- Document ingestion: type declared by the flow, schema per type, extraction proposes, human
  promotes, review queue. Documents readable by admins *and* by the tenant they belong to.
- Tenancy history (`TenancyEvent`): every change, its cause, and its source document.
- Tenant agent — **answering only** at first: lease dates, terms, building info, five languages.
- Maintenance intake, triage, self-help — six categories, photos and voice notes in.
- Responsibility determination via policy lookup, stated to the tenant **without a price**.
- Dispatch to in-house crew (full loop to closed), plus one external trade over WhatsApp
  (offer → counter → confirm → timeout → escalate).
- Break-glass human takeover — week two, not month five.
- Expiry and missing-document alerts (falls out of the schema nearly free).
- Audit log of every scoped read.

**Out (not v1)** — see below.

## Not Doing (and Why)

- **No tenant-facing price or balance — ever, not just v1.** "Around ₪400" against an ₪850 invoice
  reads as a broken promise, in writing, timestamped, on the client's behalf. The internal version
  ("similar calls averaged ₪380", on the admin dashboard) carries the information with none of the
  exposure. Log `actual_cost` from day one and it builds itself later.
- **No payments, invoices, or provider billing.** Lives in the ERP; we hold foreign keys only.
- **No AI in the responsibility decision or the state machine.** Both must be inspectable, versioned,
  and defensible a year later in a dispute.
- **No tenant app and no provider portal.** WhatsApp is the app. Every additional surface is an
  adoption tax paid by the people least willing to pay it — and "providers change nothing" is
  precisely why the switchboard model works.
- **No move-in / move-out workflow.** Genuinely valuable, genuinely separate. It's the second sale.
- **No predictive fault clustering.** Needs six months of clean ticket history. *Design for it* —
  tag every ticket with unit, floor, riser, and asset from day one — but don't build it.
- **No renewals or escalation automation.** Alerting yes, acting no. Money-adjacent.
- **No emergency handling by the agent.** A 02:00 burst pipe bypasses triage and reaches a human.
- **No rollout beyond the pilot building until the loop closes reliably once.** Scaling a workflow
  that still needs human rescue multiplies the rescues, not the value.

## Twelve Weeks, Ordered by Risk

| When | What |
|---|---|
| **Week 0** | Start Meta business verification + WhatsApp number provisioning — a 4–6 week *bureaucratic* critical path, and every business-initiated message needs a pre-approved template. Run discovery. Get the pilot commitment in writing. |
| **Weeks 1–3** | The record: schema, admin CRUD, all 1,500 units loaded, RTL. Document schemas for lease, amendment, termination notice, ID, insurance, guarantee, ארנונה + extraction review queue. Success = ops prefer this to their spreadsheet, before any agent exists. |
| **Weeks 4–5** | Identity and the answering agent: phone→party enrolment, row-level scoping, audit log, break-glass. Then read-only tenant Q&A in five languages. |
| **Weeks 6–8** | Intake, triage, responsibility: six categories, voice-note transcription, self-help content, policy table + admin editor. Humans still dispatch. Deflection becomes measurable. |
| **Weeks 9–11** | The loop closes: availability collection, in-house scheduling, then external WhatsApp negotiation with timeouts, counters, escalation. Distributed-systems work, not prompting. |
| **Week 12** | Pilot live in one building. 72 units, supervised, daily conversation review for two weeks. |

## Open Questions

1. How does a tenant report a fault *today*? Trace one real call end to end, including who they
   actually message.
2. Where do units/leases/tenants live now — Priority, spreadsheets, a property system? Can we read
   it, and who is master? (Decided: **we own `Tenancy`**; financials stay in the ERP.)
3. How many service calls per month, and what are the top ten categories by volume?
4. What SLA was committed under the tender, and what is the 02:00 emergency path?
5. Are the pilot buildings still inside **תקופת הבדק**, and who handles warranty defects today?
6. How many distinct **terms profiles** are in force — does each project have its own maintenance
   annex, or do all sites share one? If they share one, the responsibility matrix loses a dimension.
7. Where does the in-house crew's availability live — a calendar, a whiteboard, or someone's head?
8. What share of tenants writes in each language, per site?
9. Does the agent ever state a balance? (Recommendation for v1: acknowledge, hand to billing.)
10. How is a phone number bound to a party the first time — including shared numbers and numbers
    that change mid-tenancy?
