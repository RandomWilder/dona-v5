# SPEC: estate

**Owns the spine — where everything is.** Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here. The column lists below are the workbook's FIELDS sheet ([docs/model/](docs/model/)),
which is a specification and not a description; where this file and the workbook disagree, the
workbook is right and this file is a bug.

- **Owns:** E1–E4, E11 — Project · Building · Space · Unit · Asset.
- **Depends on:** kernel.
- **Built:** Project · Building · Space · Unit at week 1, slice 1.9. Asset at week 3, slice 3.5,
  seeded from handover protocols.

## The shape, and why it is this one

**A building is a set of Spaces** — `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING · STORAGE` — and
a Unit is the leasable kind, a 1:1 extension sharing the Space's key (`Unit.unit_id =
Space.space_id`, R2). An apartment is a Space *and* a Unit; a lobby is a Space and nothing else.
Every Asset will sit in exactly one Space, so **responsibility falls out of location** and `UNIT` is
the only kind that can ever be the tenant's (foundation rule 6, R4).

Flattening Space and Unit into one table would make every query remember that half its rows are not
apartments. Separating them entirely would give Asset two nullable location columns. The shared key
avoids both.

**Project sits above Building and is optional** (R15). `Building.project_id` is nullable and nothing
downstream requires it; `project_code` lives on Project, so the tender code has one home.

## Tables — `src/kernel/migrations/0004_estate.sql`

28 stored columns across four tables. Ids are `uuid`, enums are `text` with a `CHECK`, and there are
no timestamp columns: the workbook gives E1–E4 none, and a `created_at` written by anything but the
injected clock is a second source of truth no test can see.

| Table | Columns |
|---|---|
| `project` | `project_id` PK · `name` · `project_code` · `tender_ref?` · `status` |
| `building` | `building_id` PK · `name` · `address_line` · `city` · `project_id?` FK → project · `handover_date` · `warranty_end_date` · `status` |
| `space` | `space_id` PK · `building_id` FK → building · `space_kind` · `name` · `floor?` · `access_note?` |
| `unit` | `unit_id` PK, FK → space · `unit_number` · `rooms` · `area_sqm?` · `has_mamad` · `parking_space_id?` · `storage_space_id?` · `warranty_end_date?` · `condition_status` |

Vocabularies: `project.status` = `PLANNING · ACTIVE · EXITED`; `building.status` = `ACTIVE ·
IN_CONSTRUCTION · EXITED`; `space.space_kind` = `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING ·
STORAGE`; `unit.condition_status` = `READY · RENOVATION · WITHHELD`.

`unit_number` is text, not a number — `12A` exists. `rooms` is numeric because the Israeli
convention is 3, 3.5, 4. `handover_date` starts תקופת הבדק and `warranty_end_date` ends it; a unit
handed over separately overrides the building's date (R14), which is why the column is on both and
nullable on Unit.

`space.access_note` is commented `-- pii`. It is free text about how a technician physically gets
into a home, and it acquires a name and a phone number the first week it is used.

## Three rules the schema enforces, rather than the application

- **R1 — every Space belongs to exactly one Building.** `space.building_id` is `NOT NULL` with an FK,
  and a building with spaces cannot be deleted.
- **R2 — a Unit is a Space of kind `UNIT`, and cannot exist without one.** `space` carries
  `UNIQUE (space_id, space_kind)`; `unit` carries `space_kind text NOT NULL DEFAULT 'UNIT' CHECK
  (space_kind = 'UNIT')` and a composite `FOREIGN KEY (unit_id, space_kind)` into it. One key buys
  three guarantees: a Unit with no Space is rejected, a Unit on a `COMMON` space is rejected, and a
  space's kind cannot be changed out from under a Unit that exists. No trigger.
- **R15 — Project is optional.** `building.project_id` is nullable, and a bogus one is rejected.

The same composite-key technique constrains `parking_space_id` to a `PARKING` space and
`storage_space_id` to a `STORAGE` one (workbook decision D3 — bays and storage rooms are Space rows,
so they can hold a gate motor and receive service calls). Both are nullable, and `MATCH SIMPLE`
leaves the foreign key unenforced when the id is null, which is precisely the unassigned case.

## What is deliberately not a column

- **`Building.unit_count`** — counted, never stored. A stored count drifts the first time someone
  adds a unit.
- **`Unit.occupancy`** — derived from tenancy dates (R6). `condition_status` is *not* occupancy: a
  unit can be `READY` and occupied, or `READY` and empty.
- **`current_tenant`** — foundation rule 1. The scope is a view, never a column; a grep guard over
  `src/kernel/migrations/*.sql` fails the build over the string, and `src/estate/schema.test.ts`
  asserts the absence of all three against `information_schema`.

## Open

**No natural key yet.** There is no `address_key` and no uniqueness constraint beyond the primary
keys, because the FIELDS sheet specifies none and nothing yet re-runs against this schema. The real
need is an importer that can be run twice, which is slice 1.11's — and 1.11 is also the first time
real Shoham addresses say what the natural key should be. It costs a migration whenever it lands.

**`Space.building_id` is mandatory**, so a garden genuinely shared between three cores has to hang
off one of them. Making it optional would reintroduce the two-nullable-columns fork the Space idea
exists to remove. Reopen if Shoham turns out to be multi-core — cheap, now that Project exists.
