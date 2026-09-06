# SPEC: estate

**Owns the spine — where everything is.** Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here. The column lists below are the workbook's FIELDS sheet ([docs/model/](docs/model/)),
which is a specification and not a description; where this file and the workbook disagree, the
workbook is right and this file is a bug.

- **Owns:** E1–E4, E11 — Project · Building · Space · Unit · Asset.
- **Depends on:** kernel.
- **Built:** Project · Building · Space · Unit at week 1, slice 1.9; the natural keys, the importer
  and the first two screens at slice 1.11; `upsertUnitRow` for the register importer at slice 2.4;
  the portfolio-scale surface — search, Q5, the occupancy chip and the root index — at slice 2.6.
  Asset at week 3, slice 3.5, seeded from handover protocols.

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

The workbook's 28 columns, plus what enforcement needs — `address_key` on Building and the three
constant discriminators on Unit, none of which carry a fact. Ids are `uuid`, enums are `text` with a
`CHECK`, and there are no timestamp columns: the workbook gives E1–E4 none, and a `created_at`
written by anything but the injected clock is a second source of truth no test can see.

| Table | Columns |
|---|---|
| `project` | `project_id` PK · `name` · `project_code` · `tender_ref?` · `status` |
| `building` | `building_id` PK · `name` · `address_line` · `city` · `project_id?` FK → project · `handover_date` · `warranty_end_date` · `status` · `address_key` generated, UNIQUE |
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

## The natural keys — `src/kernel/migrations/0005_estate_natural_keys.sql`

Slice 1.9 left the spine with nothing unique but its primary keys, which is fine for a schema and
wrong for an importer: run the same import twice and the building exists twice. The key is what makes
a re-run a no-op, and it is decided here rather than pushed into an application that has to remember
to look before it writes.

| Table | Key | Why this one |
|---|---|---|
| `project` | `UNIQUE (project_code)` | The דירה להשכיר tender code. It is the identifier the client already uses, so one code is one project by definition. |
| `building` | `UNIQUE (address_key)` | An address is what identifies a building to everyone who is not a database. |
| `space` | `UNIQUE (building_id, space_kind, name)` | The kind is in the key because a bay and an apartment may both be called `12`. |
| `unit` | — | R2 already settled it: `Unit.unit_id = Space.space_id`, so a unit's natural key *is* its space's and a second one could only disagree with it. |

**`address_key` is an enforcement column, not a fact** — the same standing the three constant
discriminators on `unit` have. It is `GENERATED ALWAYS AS … STORED` from `city` and `address_line`,
lower-cased with runs of whitespace collapsed, because address text arrives from every export with
inconsistent spacing and casing and normalising it in the database means every writer gets it. Nothing
writes it and nothing reads it but the constraint; `address_line` and `city` remain the facts.

## The surface — five routes, `src/estate/internal/views.ts`

`GET /estate` lists the buildings; `GET /estate/buildings/:buildingId` shows one building, its spaces
by kind and its units. Slice 2.6 added three more: `GET /` is an index of the screens,
`GET /estate/search?q=` searches the portfolio, and `GET /estate/expiring` is Q5.

Server-rendered through the kernel's `h` template, which escapes every interpolation — so there is
**no client JavaScript at all**, and no JSON API that would have to be scoped before the screens can
be shown to anyone. Hebrew, RTL, and every colour, face and physical side comes from
`/ui/tokens.css`; `tests/ui/tokens.test.ts` renders each screen and fails on a hex colour, a
`font-family`, a `fonts.googleapis` URL, a physical `left:`/`right:` or a `<script>` tag.

The unit total on the list screen is **counted, never stored** — R6, made visible. So is the
occupancy beside it, from 2.6.

### The three screens 2.6 added

**`GET /` stopped being a 302.** It redirected to `/estate` because `/estate` was the only screen in
the system, and 1.11 said it would stop the week a second one existed. **It runs no query**: a
portfolio headline belongs on the buildings list, where those numbers are already being read for the
cards, and an index that ran three portfolio queries to render three links would be a worse root than
the redirect was. It moves to the composition root the week a second *module* has a screen — week 5's
staff console — because an index of screens is not estate's fact. All three are estate's today.

**`GET /estate/search?q=` searches buildings and units, and deliberately not people.** A search that
reached `party` would put a real person behind a route with no session, the week the register
arrives; an address and a unit number are not personal data, and a name is. The name search is week
5's, behind the login that makes showing it lawful. A **city matches buildings and not units**: a city
holds hundreds of apartments and sixty arbitrary ones is a worse answer than the buildings that
contain them, while a building name or an address narrows to one building and matches both.

The term is trimmed, capped at 80 characters, and its **LIKE metacharacters are escaped**. A bound
parameter is not the same thing as a safe pattern: unescaped, a lone `%` matches the whole portfolio
and `_` matches every one-character name. Both halves fetch one row past the limit, which is how a
list learns it was cut off without a second `count(*)` over the predicate it just decided not to
read.

**`GET /estate/expiring` is Q5** — every ACTIVE lease in the portfolio ending inside sixty days, one
indexed query, ordered by date. It shows a unit, a building and a date and **no party at all**.

It asks *when a lease ends*, which is not the same question as whether a tenancy counts today, and
that is why it lives here rather than in `src/scope/`. The isolation join's tenancy-active predicate
decides who may be told what; `end_date` inside a window decides what an operations team does next
week. Guard two protects the first and has nothing to say about the second — and the moment this
query needs "active on a given day" it has to ask `src/scope/` for it, which is the guard working
rather than a line to walk up to.

### The occupancy chip — derived on every load, stored nowhere

Every unit card says whether the unit is let today and by how many residents, and the building page
and the buildings list both carry the total. **It is R6 on a card**: there is no column to read and no
count to drift, in the same way the unit total has been since 1.11.

The chip calls `resolveOccupiedUnits` in `src/scope/` — **once for the page, not once per card**
([SPEC-scope.md](SPEC-scope.md)). Estate never applies the day itself: `occupancy` carries no day
predicate on purpose, so writing `today` here would put the tenancy-active predicate in a second file
and fail guard two.

**Two questions, two modules, and neither learns the other's rule.** `src/scope/` says *which* units
are let today, because deciding when a tenancy counts is what only that module may do;
`countUnitsByBuilding` says *where* they are, because that is estate's own structure. The buildings
list costs two queries rather than one per building.

The chip is a state and a count and never a name, which is the rule every screen here keeps until
week 5 gives them a session.

**There is no authentication on any of these screens, and that is a dated state, not a design.** Staff auth
is Identity Platform with enforced MFA at week 5. Until then the screens serve fixture data with no
personal data in it, and carry `noindex`. The week-5 row in [tasks/roadmap.md](tasks/roadmap.md) owns
closing it; nothing may put a real party, contact or document behind these routes before it does.

## The importer — `importEstate`, `src/estate/internal/importer.ts`

One transaction, one statement per row, every statement `INSERT … ON CONFLICT (natural key) DO UPDATE
… RETURNING` the primary key. Ids are *proposed*: on a re-run Postgres returns the id already there,
which is what makes the second run a no-op instead of a second building. Spaces are written before
units, because `unit.parking_space_id` and `storage_space_id` point at them.

`DO UPDATE` rather than `DO NOTHING`, for two reasons: `DO NOTHING` returns no row, so the importer
would have to re-select to learn the id it just failed to insert; and an import correcting a typo in a
floor or an area should correct it.

The report is created / updated per table, taken from `(xmax = 0)` on each statement's own returned
row rather than from a whole-table count, so "the second run created nothing" is a number about *this*
import and not about whatever else is in the database.

**`upsertUnitRow` is the same importer entered one row at a time, added at 2.4.** The register
([SPEC-register.md](SPEC-register.md)) arrives as a flat file whose rows repeat their building, so it
needs a call that upserts one project, one building, one `UNIT` space and one unit and **returns the
`unit_id`** — which `importEstate` does not, because a plan-shaped caller already knows its own
shape. It is the identical four upserts, extracted rather than copied: one function per table, called
by both entry points. The register writes no estate SQL of its own, which is what keeps the table's
rules in the module that owns them.

## What is deliberately not a column

- **`Building.unit_count`** — counted, never stored. A stored count drifts the first time someone
  adds a unit.
- **`Unit.occupancy`** — derived from tenancy dates (R6). `condition_status` is *not* occupancy: a
  unit can be `READY` and occupied, or `READY` and empty.
- **`current_tenant`** — foundation rule 1. The scope is a view, never a column; a grep guard over
  `src/kernel/migrations/*.sql` fails the build over the string, and `src/estate/schema.test.ts`
  asserts the absence of all three against `information_schema`.

## Open

**Closed at 1.11 — the natural keys exist**, above. They were chosen against a fixture designed for
coverage rather than against Shoham's real addresses: the director's decision this week is that
functionality is established on mock addresses and example leases first, and real data applies to it
afterwards, which is [docs/pipeline.md](docs/pipeline.md) §1 principle 5. The week-2 Priority import
is what puts real addresses through the same keys, and `address_key` normalises precisely the
variation that import will bring.

**`Space.building_id` is mandatory**, so a garden genuinely shared between three cores has to hang
off one of them. Making it optional would reintroduce the two-nullable-columns fork the Space idea
exists to remove. Reopen if Shoham turns out to be multi-core — cheap, now that Project exists.
