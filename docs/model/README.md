# Building / Unit model — working draft

The **physical and contractual skeleton** of the admin application: what a building contains, what a
unit is, who is in it today, what hangs off it, and what the agent is allowed to see. It is the
Data Model made concrete enough to build from — the entity catalogue in
[../data-model.html](../data-model.html) says *what the system is*; this says *which columns to
create*.

Two workbooks, and they are **not** kept in step with each other.

| File | Language | Status | Rule |
|---|---|---|---|
| `dona-building-unit-model-draft.xlsx` | English | **Current** — 3 Sep 2026 | The one we edit. "The excel file" means this one. |
| `dona-building-unit-model-draft-HE.xlsx` | Hebrew, RTL | **Frozen** — an older state | Stakeholder-facing. Update **only when Asaf asks.** |

The Hebrew file is a presentation tool for Dona Dom's non-technical stakeholders, and it is
deliberately allowed to lag the English one. Do not "helpfully" regenerate it to match — that is a
decision, not a chore, and it is Asaf's to make.

## Regenerating

The `.xlsx` files are **build outputs**. The Python scripts are the source; edit those, never the
workbook.

```bash
python3 docs/model/build_model.py
```

Each script writes its workbook into the directory it lives in. `openpyxl` is the only dependency.
The scripts contain no formulas, so no recalculation step is needed.

## The six sheets

| Sheet | What it holds |
|---|---|
| **READ ME** | The shape of the model in one page, and the conventions the rest of the workbook obeys |
| **ENTITIES** | Fourteen entities (E1–E14), one line each, plus why it exists |
| **RELATIONSHIPS** | R1–R16 — the edges, their cardinality, and the rule each one enforces |
| **FIELDS** | Every column: type, required, key, meaning, and the note explaining any non-obvious choice |
| **ADMIN VIEWS** | The screens these tables have to produce, panel by panel — including the settings screen |
| **DECISIONS** | Six shaping decisions, each as the rule it creates and why that rule holds |

## The rules the workbook encodes

These are the parts that must survive contact with code.

- **A building is a set of Spaces** — `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING · STORAGE`.
  Anything that can break or needs inspecting is an **Asset** in exactly one Space
  (`Asset.space_id`, a single non-null FK). A Unit is a 1:1 extension of a Space
  (`Unit.unit_id = Space.space_id`) — the leasable kind.
- **Responsibility falls out of location.** `UNIT` is the only Space kind that can ever be the
  tenant's. `COMMON`, `TECHNICAL` and `EXTERIOR` never are. `PARKING` and `STORAGE` follow the unit
  they are assigned to; unassigned, they are treated as `COMMON`. (R4)
- **Project sits above Building, optionally.** `Building.project_id` is nullable and nothing
  downstream requires it; `project_code` lives on Project, so the tender code has one home. (R15)
- **The current tenant is a VIEW.** `today ∈ [start_date, end_date]`, computed on every screen load.
  There is no `current_tenant` field on Unit and there must never be one. (R6)
- **The isolation join is five hops of SQL, before any model call:**
  `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`. (R9)
- **`PartyContact` is temporally dated** (`valid_from` / `valid_to`), so a recycled phone number
  resolves to nobody rather than to the previous tenant's unit.
- **A guarantor (ערב) never receives service information.** `is_service_contact` is forced false
  whenever `role = GUARANTOR` — a database constraint, with no toggle, no import path and no agent
  override.
- **Obligations attach to the Tenancy**, carry a derived status
  (`SATISFIED · EXPIRING · EXPIRED · MISSING`) and **never an amount**. (R10)
- **Obligation types are an admin-managed catalogue** (`ObligationType`, E10, R16). Types are
  deactivated rather than deleted, and `responsible_party` is copied onto the obligation at creation
  so editing the catalogue cannot rewrite an obligation a dispute will read.
- **Ternary responsibility under תקופת הבדק** is driven by `Asset.warranty_end_date` →
  `asset_in_warranty`, with `warranty_provider_id` naming who owes the fix.
- **`asset_type` is guarded, not admin-editable** — the responsibility matrix keys on it, so editing
  it edits policy. The settings sheet says so explicitly.

## Two conventions to preserve

**Relationship numbers are append-only.** New relationships are appended (R15, R16, …) and never
inserted, so R1–R14 keep the numbers cited elsewhere — including in the frozen Hebrew file. R6 is
the isolation view and R9 the isolation join in *both* workbooks. Entity numbers (E1–E14) carry no
such guarantee, since nothing cross-references them.

**Nothing here is published.** Unlike the four documents in `docs/`, these workbooks have no artifact
URL. They are files, handed over directly.

## Known open edge

`Space.building_id` is **mandatory**, so a garden genuinely shared between three cores has to hang
off one of them. Making it optional would reintroduce the two-nullable-columns fork that the Space
idea exists to remove. Reopen this if Shoham turns out to be multi-core — it is cheap now that
Project exists. Recorded in the workbook as R15.
