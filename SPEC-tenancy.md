# SPEC: tenancy

**Owns who holds which unit, when, and under what obligations.** Shared conventions live in
[SPEC.md](SPEC.md) and are not repeated here. The column lists below are the workbook's FIELDS sheet
([docs/model/](docs/model/)), which is a specification and not a description; where this file and the
workbook disagree, the workbook is right and this file is a bug.

- **Owns:** E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType, plus an append-only
  `TenancyEvent` beside the mutable row.
- **Depends on:** estate, parties.
- **Built:** week 2, slice 2.2 — Tenancy and TenancyParty; `terms_profile`'s natural key and the
  module's three write commands at slice 2.4. Obligation, ObligationType and `TenancyEvent` are week
  5's.

## The shape, and why it is this one

**A tenancy is the join between a unit and the people in it, in time.** It is not a field on the
unit, and there is no `current_tenant` column anywhere — foundation rule 1, and a grep guard fails
the build on one. Who lives in a unit today is computed from dates on every load (R6): a stored
pointer goes stale silently, someone moves out, the column still says their name, and the agent
answers the wrong person about their own home. A date range cannot go stale.

**A unit accumulates tenancies and never overwrites them** (R5). The old one *ends*; the next one
starts. "Who lived here in March 2025" must always be answerable, because that is the question a
dispute asks.

**A lease usually has more than one name on it** (R7), so the role lives on `TenancyParty` and never
on the party. Two spouses on one lease are two parties on one tenancy; one person renting three units
over five years is one party on three tenancies. Without the join table a second signatory has
nowhere to go and gets typed into a notes field, where no rule can read them.

## Tables — `src/kernel/migrations/0007_tenancy.sql`

The workbook's E7 and E8 columns and no others, plus the one table a NOT NULL foreign key needs to
exist. Ids are `uuid`, enums are `text` with a `CHECK`, and there is no `DEFAULT now()` anywhere: the
FIELDS sheet gives these entities no timestamp, and every date here is a fact somebody records.

| Table | Columns |
|---|---|
| `terms_profile` | `terms_profile_id` PK · `name` |
| `tenancy` | `tenancy_id` PK · `unit_id` FK → unit · `start_date` · `end_date` · `status` · `terms_profile_id` FK → terms_profile · `notice_date?` · `actual_move_out?` |
| `tenancy_party` | `tenancy_id` + `party_id` composite PK, both FK · `role` · `is_service_contact` |

Vocabularies: `tenancy.status` = `DRAFT · ACTIVE · ENDED · TERMINATED_EARLY`; `tenancy_party.role` =
`PRIMARY_TENANT · CO_TENANT · GUARANTOR · OCCUPANT`, where GUARANTOR is ערב — on the lease, but not a
resident.

**No money.** No rent, no deposit, no balance, deliberately and permanently (foundation rule 2).
Financials live in Priority behind read-only keys, and a column here would be the first place someone
put an amount the agent could read.

**No `-- pii` marker on any column**, and that is a claim the guard checks rather than a claim this
file makes: nothing here is person-shaped. The people are in `party`, reached through
`tenancy_party.party_id`.

## The rule this schema exists to enforce

> **A guarantor never receives service information.**

Foundation rule 7, D4 in the workbook, and one of the three things the client called non-negotiable.
`is_service_contact` is **forced false** when `role = 'GUARANTOR'` by a database constraint:

```sql
CONSTRAINT guarantor_is_never_a_service_contact CHECK (
  role <> 'GUARANTOR' OR is_service_contact = false
)
```

The insert is **rejected**, not defaulted politely — there is no toggle, no import path and no agent
override, because a default is a thing someone trying to be helpful flips at 16:00 on a Thursday.
Treating everyone on a lease as "the tenant" leaks a household's business to the parent who
co-signed, and the parent is on the lease precisely because they are not in the apartment.

The constraint is **spent** rather than merely stored: `src/scope/`'s isolation join carries
`AND tp.is_service_contact` as its fourth hop, so a guarantor resolves to no unit at the front door.
Both sides are policy cases — the rejection is case 3 (`tests/policy/guarantor.test.ts`) and the join
is asserted from the other side in `tests/policy/isolation.test.ts`.

## The occupancy window

> **No two ACTIVE tenancies overlap on one unit.**

The workbook's note on `end_date`: *"Together with start_date this is the isolation window. No
overlap allowed on one unit."* An overlap means Q1 — who lives in unit 12 today — returns two
households for one apartment, which is the mirror of 2.1's *two units for one inbound number* and is
declared the same way, as a statement about overlap:

```sql
CONSTRAINT one_active_tenancy_per_unit EXCLUDE USING gist (
  unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&
) WHERE (status = 'ACTIVE')
```

`'[]'` is inclusive at both ends, matching the join's own day-grained reading, so a tenancy ending
30 June and another starting 30 June conflict — on that day the unit would have two households.

**It is partial on `status = 'ACTIVE'`, and that is the whole of the design.** `TERMINATED_EARLY`
keeps its *contractual* `end_date` while `actual_move_out` records reality: a tenant who leaves in
June on a lease running to December, with the next tenancy starting in August, is a correct history
that a blanket constraint would reject. `ACTIVE` is exactly the set the isolation join reads, so the
constraint covers exactly the rows that can produce the defect and no others.

**Natural key `(unit_id, start_date)`.** One lease per unit per start date, so a re-run of the
importer is a no-op rather than a duplicate. It covers every status, where the exclusion constraint
covers only `ACTIVE`. 1.9 shipped the estate spine without keys and 1.11 measured what that cost —
the same fixture applied twice produced two buildings, 368 spaces and 144 units — so this one lands
with the table rather than with its first importer.

`tenancy_period_is_ordered` (`end_date >= start_date`) is written in that direction rather than as
`start_date <= end_date` on purpose: guard 2 matches the join's tenancy-active predicate over
whitespace-collapsed text, and the mirrored spelling cannot collide with it. 2.1 learned that lesson
by tripping the guard rather than by anticipating it.

## What is deliberately not here

- **`terms_profile` has one column beyond its key, and that is not an oversight.** The workbook makes
  `Tenancy.terms_profile_id` a NOT NULL foreign key, and a NOT NULL foreign key needs a target that
  exists. Which maintenance annex governs a lease is what Q4 — the responsibility decision — keys on,
  so it may not be nullable and quietly absent. E1 `project` landed the same way at 1.9: identity
  now, fields when we know what they must carry. **Open question 2 — how many profiles are in force —
  is week 5's, and the responsibility matrix that reads them is week 6's.** Until then the table
  holds a name, and the importer has to say which profile each lease is on, which is a question for
  the client that a nullable column would have hidden until week 6.

  **Its natural key is `UNIQUE (name)`, chosen at 2.4** in `0009_import_natural_keys.sql`. The
  importer needs to look a profile up idempotently and a register names one by its name; *how many*
  are in force is a different question from *what identifies one*, and only the second was owed here.
  **A lease naming no profile is a reject with its line number, not a defaulted row**
  ([SPEC-register.md](SPEC-register.md)) — defaulting to `standard` would have answered a question
  the client has not been asked, which is exactly what the NOT NULL exists to prevent.
- **Obligation, ObligationType and `TenancyEvent`** — E9, E10 and the append-only log — are week 5's.
  `ObligationType` will be an admin-managed catalogue, deactivated never deleted, with
  `responsible_party` copied onto the obligation at creation so editing the catalogue cannot rewrite
  history (foundation rule 8).
- **No read model.** `contract.ts` exists from 2.4 and exports three write commands —
  `upsertTermsProfile`, `upsertTenancy` and `upsertTenancyParty` — because the register importer is
  the caller 2.2 predicted. There is still no query on this module's contract: who is in a unit today
  is `src/scope/`'s answer and never this module's, which is foundation rule 1 expressed as a module
  boundary.
- **No index on `end_date`.** Q5 — leases ending in the next 60 days across the whole portfolio — is
  one indexed query at **2.6**, decided at full row count with a timing in front of it rather than
  assumed at a few thousand rows. `tenancy_party (party_id)` does exist, because the composite
  primary key `(tenancy_id, party_id)` does not serve the isolation join's third hop.

## Open

- **Which `terms_profile` a real lease is on.** 2.4 settled how one is *identified* — by name — and
  left this open, because it is a fact about the client's leases and not about the schema. The
  register format requires the column, so an export that does not carry it is a question raised at
  import time rather than a gap discovered at week 6 by a matrix with no input. **2.5's.**
- **What the overlap constraint does to the real register.** A register with sloppy dates will have
  rows rejected at 2.5. That is the intended direction — a reject with a line number rather than two
  households in one apartment — but the count is a fact about the client's data and is recorded when
  it is measured.
