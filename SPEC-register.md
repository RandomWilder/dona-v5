# SPEC: register

**Owns the way a register file becomes rows.** Shared conventions live in [SPEC.md](SPEC.md) and are
not repeated here. This module owns no entities: it composes four modules that do, exactly as
[SPEC-scope.md](SPEC-scope.md) owns a join over tables it does not own.

- **Owns:** the register file format, the reject contract, and the order the writes happen in.
- **Depends on:** estate, parties, tenancy, scope — all four through their `contract.ts`, never an
  `internal/`.
- **Built:** week 2, slice 2.4; the generated register at volume, slice 2.6.

## Why this is a module of its own

The importer has to call `normalisePhone`, which is on `src/scope/`'s contract for exactly this
caller ([SPEC-scope.md](SPEC-scope.md), slice 2.3). `src/scope/` depends on parties, tenancy and
estate, so an importer living inside any of those three would be a cycle: `tenancy → scope →
tenancy`. It has to sit **above** all four, and the only two places above them are the composition
root and a module of its own.

A module, because it is not one file. It is a parser, a row validator, a write sequence and a report,
with a test suite and a fixture, and the composition root is where wiring lives rather than where
logic does. `src/register/` is also what the write hook keys on: an edit under `src/<module>/` runs
that module's tests.

**It writes no SQL against a table it does not own.** Estate upserts buildings, spaces and units;
parties upserts parties and contacts; tenancy upserts profiles, tenancies and tenancy parties. This
module supplies the order and the transaction, and owns the decision about what a bad row does.

## The file — one row per party-on-a-tenancy

`SPEC.md`'s tier 3 is *"the tenant / unit / phone table"*, and that is the shape a register export
from a property system has: one line per person on one lease on one unit. A unit with two signatories
is two lines. A party on two tenancies over five years is two lines. Buildings and units repeat
across lines and converge through their natural keys, which is what the keys added at 1.11, 2.2 and
2.4 are for.

CSV, because the acceptance bar is a **line number**. A typed plan object like
[`EstatePlan`](src/estate/internal/plan.ts) has array indices, and an array index is not something an
administrator can find in a spreadsheet. Line 1 is the header; data starts at line 2, and a reject
names the physical line it came from.

| Column | Notes |
|---|---|
| `project_code` · `project_name` | Optional. Blank means a building with no project (R15). |
| `building_name` · `address_line` · `city` | `address_key` normalises the last two in the database. |
| `unit_number` · `rooms` · `area_sqm` · `has_mamad` | `area_sqm` is optional; `rooms` is numeric (3, 3.5, 4). |
| `tenancy_start` · `tenancy_end` · `tenancy_status` | `DRAFT · ACTIVE · ENDED · TERMINATED_EARLY`. |
| `terms_profile` | The profile's name. **Required** — see below. |
| `party_kind` · `national_id` · `full_name` · `preferred_language` | `national_id` is **required** — see below. |
| `role` · `is_service_contact` | `PRIMARY_TENANT · CO_TENANT · GUARANTOR · OCCUPANT`. |
| `phone` · `contact_from` · `contact_to` | Normalised to E.164 before insert. `contact_to` blank = still current. |

The `UNIT` space a register row implies is named by its `unit_number`. A register carries apartments
and nothing else — no lobby, no plant room — so the space taxonomy the estate importer supports is
not in this file. Those arrive with a handover protocol at week 3, through a different door.

**The parser is written rather than installed.** It handles quoted fields, embedded commas, embedded
newlines inside quotes, doubled quotes and a UTF-8 BOM, which is the whole of RFC 4180 that a
spreadsheet export produces. `AGENTS.md` asks for a stated reason before a runtime dependency, and
"one file format with four rules" is not one. **A field containing a newline moves the line counter
by the number of newlines it swallowed**, so a reject's line number is the line in the file and not
the index of the record.

## The two natural keys this slice chose, and the one it declined

### `party` — a generated `national_id_key`, `UNIQUE`

This is [`address_key`](SPEC-estate.md)'s technique applied to the identifier, and for the same
reason: the normalisation belongs in the database, so every writer gets it rather than every writer
remembering it.

```sql
national_id_key text GENERATED ALWAYS AS (...) STORED,  -- pii
CONSTRAINT party_natural_key UNIQUE (national_id_key)
```

Three decisions are inside that expression, and 2.1 named all three as open:

- **Leading zeros.** A ת.ז. is nine digits and every spreadsheet export drops the leading ones, so
  `042…` and `42…` are one person. An all-digit identifier of nine characters or fewer is left-padded
  to nine. A naive `UNIQUE (national_id)` is a key that disagrees with itself the first time a
  register arrives.
- **Two registries.** A ת.ז. and a ח.פ. are different registries and can be the same nine digits, so
  `party_kind` is part of the key.
- **Nullable.** A `UNIQUE` index ignores nulls, so a party with no identifier simply has no natural
  key — which is correct, not a gap. The column stays nullable because the lease flow (A2,
  [SPEC-flows.md](SPEC-flows.md)) legitimately creates parties from a document that names no ת.ז.

An identifier that is not all digits — a passport number — is normalised only for case and
separators and is otherwise left alone, because padding it would be inventing a fact.

**The importer requires `national_id` and rejects a row without one, with its line number.** A
register row with no identifier cannot be re-imported idempotently, and a surrogate built out of
name and phone would be the key that disagrees with itself in the other direction: two people with
one name, or one person whose number was recycled. The schema permits a party without an identifier;
*this file format* does not. That distinction is deliberate and is the answer to 2.1's open question.

**This is a question for the client, raised now rather than discovered at 2.5.** The data request
derived from this template marks ת.ז./ח.פ. required. If the real export does not carry it, 2.5
reopens the decision with the export in hand instead of 2.4 having guessed at it.

### `terms_profile` — `UNIQUE (name)`

The importer needs to look a profile up idempotently, and the export names it by name. **How many
profiles are in force is week 5's** and is a different question from what identifies one.

**A lease naming no profile is a reject with its line number, not a defaulted row.**
`tenancy.terms_profile_id` is NOT NULL precisely so the question cannot be hidden until week 6, when
the responsibility matrix keys on it ([SPEC-tenancy.md](SPEC-tenancy.md)). Defaulting to `standard`
here would have answered a question the client has not been asked.

### `party_contact` — `UNIQUE (party_id, channel, value, valid_from)`

Not a decision about the domain so much as one the upsert forces: `ON CONFLICT` needs a unique
constraint as its target and an `EXCLUDE` constraint cannot be one. One party, one channel, one
value, one start date is one contact row, and that key sits *inside* 2.1's exclusion constraint
rather than competing with it — every pair it rejects, the exclusion constraint already rejected.

### `is_primary` — no uniqueness, and that is 2.1's reasoning confirmed rather than revisited

"At most one primary contact per party per channel" is a plausible rule the workbook does not state.
This file carries one contact per row and does not say which of a party's numbers is primary, so as
a partial unique index it would fail an import that touched two rows in the wrong order, on a rule
nobody asked for. Left out.

## What a bad row does — the reject contract

> **A malformed row is reported with its line number. The file continues.**

Two layers, and the second is the one the acceptance bar actually turns on.

**Validation, before any SQL.** Column count, the four vocabularies, date shape, numeric shape, and
`normalisePhone` from `src/scope/`'s contract. A bare nine-digit number is *refused* rather than
assumed Israeli — `521234567` would pass E.164's shape as `+521234567`, a Mexican subscriber, and a
row that silently becomes another country's number is worse than a row rejected with its line
number (slice 2.3).

**A `SAVEPOINT` per row.** A row that passes validation and is then rejected by the database is
rolled back to its savepoint, recorded with its line number, its SQLSTATE and its constraint name,
and the import continues with the next line. Without this the first constraint violation poisons the
transaction and every subsequent statement fails with `25P02` — which is *failing whole* wearing a
report.

The constraints that legitimately reject a register row are the ones that matter most, and each is
a rule somebody decided rather than an accident:

| Rejected by | Means |
|---|---|
| `one_active_tenancy_per_unit` | Two ACTIVE leases overlapping on one apartment. **The count of these is a fact about the client's data and is measured at 2.5**, not here. |
| `tenancy_natural_key` | Two leases on one unit starting the same day — one lease typed twice. |
| `guarantor_is_never_a_service_contact` | Foundation rule 7. There is no import path around it, which is the whole point of it being a constraint. |
| `contact_value_resolves_to_one_party` | One number claimed by two people on overlapping days. |
| `phone_is_e164` | A number that reached the database unnormalised — a defect in this module, and it is loud rather than silent. |

The report is `{ counts, rejects, accepted }`. Every count is `created` / `updated` taken from
`(xmax = 0)` on the statement's own returned row, never from `count(*)`: a whole-table count is not a
fact about *this* import, which slice 1.11 shipped wrongly and CI caught within the hour.

## What is deliberately not here

- **No cross-tenancy identity resolution.** The `national_id_key` deduplicates a party *by
  identifier*, which is a key and not a judgment. Matching a name against the register is a month-two
  problem and is forbidden to the lease flow by [SPEC-flows.md](SPEC-flows.md) A2 step 5 for the same
  reason.
- **No caller-supplied intent key.** The natural keys do the work. An idempotency key would make the
  *call* repeatable; the natural keys make the *data* convergent, which is the property a re-run
  needs.
- **No batching, and no `COPY`. 2.6 measured it and kept it.** A savepoint per row costs a round
  trip per row, which is what makes a rejected row a reject instead of a failed file. At 1,500 units
  — 2,908 rows, nine upserts and two savepoint statements each, about 32,000 round trips — the whole
  import takes **6.5 seconds, 2.2 ms a row**, and a second run of the same file takes 6.0 and creates
  nothing. A register is loaded by a person who chose the file; six seconds is not a number worth
  trading a line number for, and batching would coarsen the reject boundary to buy something nobody
  is waiting on. Reopened if a register ever arrives that is an order of magnitude larger.
- **No screen.** The register is loaded by a script. `src/estate/`'s two screens and 2.6's grid are
  the surface; this module has no route.

## The generated register — `fixtures/generate.ts`, slice 2.6

Volume and realness are different facts, and an index decision needs only the first. The real
register is step 4 of the method ([SPEC-flows.md](SPEC-flows.md)) and 2.5 imports it; 2.6 needed
1,500 units in these same twenty-two columns, through this same importer, so that the path under
measurement is the path that ships.

`generateRegister({ units, today, seed, cities, block })` returns the file and a summary of what is
in it. **Same seed and same day, same bytes** — `today` is a parameter and never a clock reading
(SPEC.md), and here it has a second job: "leases ending in the next 60 days" is a question about a
day, so seed *and* day are what make a file reproducible. Two entry points, neither in any workflow:
`npm run register:generate -- <units> <file.csv> [seed]` writes the artefact an administrator would
be handed, and `npm run seed:register -- <units> [seed]` generates in memory for an environment that
needs volume without a 600KB file in the image.

**It is the nine-row fixture at volume, not fifteen hundred copies of one household.** Every case
that breaks an importer is still in the file and each is counted in the summary: a recycled number,
one person under two spellings of one ת.ז., a guarantor, a company whose name carries a quotation
mark, a unit let twice, a lease that has not started, a building with no project, a split unit
number, a missing area.

**Zero rejects, by construction.** A generated register that loses rows measures the generator. How
many rows a *real* register loses to `one_active_tenancy_per_unit` is a fact about the client's data,
it is 2.5's to measure, and inventing a number for it here would be worse than not having one.

**Every fixture in this module owns a block**, `058-Bxx-xxxx` / `07B…` / `51B…`: `2` is the nine-row
fixture, `4` the generated register, `7` the generator's own suite. `node --test` runs files in
parallel against one database, and two files sharing a block claim one contact value on overlapping
days — which the exclusion constraint rejects and which two transactions deadlock over (2.4 met that
as `40P01`).

**`terms_profile.name` is part of that namespace, and 2.4 missed it.** The key is global — a profile
is identified by its name and by nothing else — so a fixture naming a plausible annex collides with
the register that eventually names the real one. Loading a generated register into the development
database turned three suites red on `terms_profile_natural_key`, which is the same lesson 1.11
learned about addresses and 2.4 about phone numbers, met a third time on the one global key nobody
had thought of. Every fixture profile now carries the suffix its cities do.

## Open

- **Whether the real export carries a ת.ז. on every row, and a profile name on every lease.** Both
  are required by this format and both are questions for the client. 2.5 answers them with the export
  in hand.
- **Whether a register row should be able to name a space that is not a unit.** It cannot today, and
  nothing has asked for it. Parking bays and storage rooms reach the system through the estate plan
  (D3 in the workbook), which the handover protocol at week 3 fills in.
