# Dona Dom — tenant service platform

An AI service platform for **Dona Dom**, the rental arm of the Dona group: ~1,500 long-term rental
apartments in Israel under **דירה להשכיר** government tenders. Two halves — an **admin web app**
covering all 1,500 units from day one, and a **WhatsApp agent on both ends of a service call**,
piloting on one 72-unit building in Shoham.

**No application code exists yet.** This repo currently holds thinking, not software: four published
design documents, the handoff that carries the reasoning behind them, and a field-level model
workbook that specifies the first month's tables.

---

## Read these first

1. **[HANDOFF.md](HANDOFF.md)** — settled decisions *with their reasoning*, so they don't get
   relitigated. Read it before proposing anything.
2. **[docs/from-v3.md](docs/from-v3.md)** — what v5 inherits from the v3 codebase and what it must
   not. Read it before writing any application code, and before planning week 1: some of that work
   already exists, and one external dependency on the critical path has been running since August.
3. The documents below, as needed for the task at hand.

## The documents

All four are published Claude artifacts. The `docs/` files are the **exact sources** they were
published from — edit the local file, then republish it to the same URL with the `Artifact` tool
(pass `url` so it updates in place rather than creating a new one).

| Document | Local source | Published |
|---|---|---|
| **Data Model** — Rev B | [docs/data-model.html](docs/data-model.html) | https://claude.ai/code/artifact/9459f369-55e4-46fb-88e5-df7b1ab083bc |
| **Platform Brief** — Rev B | [docs/platform-brief.html](docs/platform-brief.html) | https://claude.ai/code/artifact/8c232d40-295c-4fbd-815d-eea6a3b530c5 |
| **Rollout Cadence** — *Sixteen Demos to Pilot* | [docs/rollout-cadence.html](docs/rollout-cadence.html) | https://claude.ai/code/artifact/60947a87-41ff-4e1b-8b25-cc03d18cc91c |
| **Stack Map** — vendors, costs, lock-in | [docs/stack-map.html](docs/stack-map.html) | https://claude.ai/code/artifact/571f6a8d-3f93-48db-9b94-361fa71a16c4 |

### The working model — `docs/model/`

Not an artifact. The **building/unit entity model** as a spreadsheet, and the Python that builds it.
See [docs/model/README.md](docs/model/README.md) before touching either file.

| File | What it is |
|---|---|
| [dona-building-unit-model-draft.xlsx](docs/model/dona-building-unit-model-draft.xlsx) | **Rev A2, English — the working copy.** "The excel file" means this one. |
| [dona-building-unit-model-draft-HE.xlsx](docs/model/dona-building-unit-model-draft-HE.xlsx) | Hebrew, RTL. **Frozen at Rev A** for stakeholder presentations — update only when asked. |
| `build_model.py` / `build_model_he.py` | The generators. **These are the source; the .xlsx are build outputs.** Edit the script, re-run it, never hand-edit the workbook. |

Six sheets: READ ME · ENTITIES (E1–E14) · RELATIONSHIPS (R1–R16) · FIELDS · ADMIN VIEWS ·
DECISIONS FOR YOU. It sits *under* the Data Model — the Data Model says what the system is, this
says which columns to create — and it is where the schema work continues.

Also published, not stored locally: **Handoff (HTML)** —
https://claude.ai/code/artifact/328f8a74-b426-4a0e-bb74-2831e098f144 — now behind
[HANDOFF.md](HANDOFF.md); republish it before showing it to anyone.

**As of 2 Sep 2026 all four local sources are byte-identical to what is published.** If you edit
one, republish it — do not leave the repo and the artifact out of step. If you suspect drift, recover
the live version with `Artifact action:"read"` and diff before editing.

### Which document wins

The first three were reconciled deliberately on 2 Sep 2026. Preserve the hierarchy:

- **Data Model** is the authority on *what the system is* — entities, states, policy, isolation.
  Everything else follows it.
- **Rollout Cadence** is the authority on *schedule* — sixteen weeks, four monthly gates M1–M4,
  a demo every Thursday. Brief §05 is its four-phase summary and says so.
- **Platform Brief** is the client-facing argument. It defers to both above.
- **Stack Map** is a reference, not an authority — vendors, unit costs at pilot and at scale,
  lock-in and exit cost, and the decisions still needed from the client. It carries no schedule of
  its own (its only date is Meta's 4–6 week lead time, which agrees with the other three), so it was
  not part of the reconciliation and did not need to be. Costs are from published pricing and are
  marked *verify at contract* — treat them as estimates, not quotes.

Sequence facts that must stay consistent everywhere: **16 weeks total · pilot live at week 12 ·
M3 is the go/no-go · M4 is the scale decision.**

The HTML sources are artifact bodies — no `<!doctype>`, `<html>`, `<head>` or `<body>` tags, by
design. The publish step wraps them. Don't add them.

---

## Constraints that are not up for negotiation

These came from the client. Do not soften them, and do not design around them.

- **Tenant isolation is absolute.** A tenant may only ever receive information derived from their own
  documents and the global knowledge base. A tenant must **never** get information about or for
  another tenant. Enforced as a temporal join in SQL *before* any model call:
  `phone → Party → active Tenancy (today ∈ [start,end]) → Unit`. **No stored `current_tenant`
  column anywhere** — it is a view, not a column.
- **Money never touches the agent.** No tenant-facing prices or balances — **ever, not just v1**.
  Financials stay in the Priority ERP behind read-only keys.
- **No AI in the responsibility decision or the state machine.** Both must be inspectable, versioned
  and defensible in a dispute a year later. Every resolved call snapshots the `policy_version_id`
  that decided it; rules supersede by `effective_from` and never overwrite.
- **Responsibility is ternary** — tenant / operator / **contractor**, because of **תקופת הבדק**.
  Binary models of it are wrong.
- **Emergency calls never reach the agent.** An 02:00 burst pipe bypasses triage and reaches the duty
  phone. The bypass is a policy row plus a routing rule, in v1, live before the first real message.
- **Meta business verification is the critical path** — 4–6 weeks, bureaucratic, uncompressible.
  Filed week 1. The WhatsApp number must belong to Dona Dom's legal entity, never a personal mobile.

## Settled in the model workbook, 3 Sep 2026

Six decisions taken by the client. They are recorded in the workbook's DECISIONS FOR YOU sheet with
what each one changed; the short version, because these now bind the schema:

- **A building is a set of Spaces** — `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING · STORAGE`.
  Anything that can break or needs inspecting is an **Asset** in exactly one Space. A Unit is a 1:1
  extension of a Space (`Unit.unit_id = Space.space_id`) — the leasable kind. **Responsibility falls
  out of location:** `UNIT` is the only kind that can ever be the tenant's.
- **Project sits above Building and is optional** — `Building.project_id` nullable; `project_code`
  lives on Project, not Building.
- **A guarantor (ערב) can never receive service information.** `is_service_contact` is *forced* false
  when `role = GUARANTOR` — a database constraint, not a form default. No toggle exists.
- **Obligation types are an admin-managed catalogue** (`ObligationType`), deactivated never deleted,
  with `responsible_party` copied onto the obligation at creation so editing the catalogue cannot
  rewrite history.
- **`asset_type` is guarded, not admin-editable** — the responsibility matrix keys on it, so editing
  it edits policy.
- **Relationship numbers are append-only.** R1–R14 must keep their numbers — the frozen Hebrew file
  cites them. Append, don't insert. Entity numbers may shift.

## Working style, learned on this project

- The documents are the deliverable right now. They are dense, argued, and written to be shown to a
  client — match that register. Don't pad, don't hedge, don't restate.
- Changes to the Data Model, Brief or Cadence are checked against the other two. Three docs, one
  vocabulary: the state names, entity names and week numbers mean the same thing everywhere.
- Say what was deliberately *not* changed and why. Silent scope changes are the failure mode here.

---

## Where we are

The refinement arc is done: problem framed, direction chosen, data model settled, stack mapped,
rollout cadence written, and all three documents reconciled against each other. On top of that, the
**building/unit model has been drafted to field level and its six open questions answered**
(`docs/model/`, Rev A2, 3 Sep 2026) — so the first month's tables are specified, not just described.

**Next: the development pipeline** — a granular roadmap decomposing the sixteen weeks into workable
detail, and the path from this spreadsheet to a running schema. See the end of
[HANDOFF.md](HANDOFF.md) for what is still open and what would change the plan's shape.
