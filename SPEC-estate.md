# SPEC: estate

**Owns the spine — where everything is.** Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here. The column lists below are the workbook's FIELDS sheet ([docs/model/](docs/model/)),
which is a specification and not a description; where this file and the workbook disagree, the
workbook is right and this file is a bug.

- **Owns:** E1–E4, E11, E14 — Project · Building · Space · Unit · Asset · Provider (stub).
- **Depends on:** kernel.
- **Built:** Project · Building · Space · Unit at week 1, slice 1.9; the natural keys, the importer
  and the first two screens at slice 1.11; `upsertUnitRow` for the register importer at slice 2.4;
  the portfolio-scale surface — search, Q5, the occupancy chip and the root index — at slice 2.6.
  Asset at week 3, slice 3.5, seeded from handover protocols. The E14 Provider stub landed in the
  same migration so R11 has a table to point at. Slice 3.6 added a thin unit page and grew search by
  a documents half; both list what is filed, never who signed it. Slice 4.8 added
  `GET /estate/incomplete`, the A4 queue: a derived list of document-backed drafts and live
  lettings that miss a named completeness rule — the original ערב rule, and from #108 each
  activation-gate miss under the gate's own identifier. The query and the exception write live in
  tenancy; estate renders them through `EstateDeps`, the same injection `listLinkedDocuments`
  already uses, so this module still does not import tenancy. There is no second queue. **Slice 6.1 added this module's first write route** — `GET
  /estate/buildings/new` and `POST /estate/buildings`, flow A11, behind the new `estate.write`
  permission — and it writes through `importEstate` rather than through a command of its own.
  **Slice 6.2 added the second**, flow A13: `GET /estate/buildings/:buildingId/units/new` and
  `POST /estate/buildings/:buildingId/units`, which fills a building A11 created empty and writes
  through `upsertUnitRow` — the register's own per-row primitive, which now has a second caller.
  **#140 gave A13 optional bay and storage numbers and took the invented ones away**: from 4.6 that
  primitive wrote a `PARKING` space `חניה {unit_number}` and a `STORAGE` space `מחסן {unit_number}`
  for every caller, in a scheme no plan prints. It names what it is told and nothing else now, and
  `POST /estate/spaces/:spaceId/remove` is this module's first delete of a `space`
  outside the operator purge — narrow, refusing rather than cascading, and the only forward path the
  rows 4.6 already wrote have.

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

## Tables — `src/kernel/migrations/0004_estate.sql` and `0012_assets.sql`

The workbook's 28 columns, plus what enforcement needs — `address_key` on Building and the three
constant discriminators on Unit, none of which carry a fact. Ids are `uuid`, enums are `text` with a
`CHECK`, and there are no timestamp columns: the workbook gives E1–E4 none, and a `created_at`
written by anything but the injected clock is a second source of truth no test can see.

| Table | Columns |
|---|---|
| `project` | `project_id` PK · `name` · `project_code` · `tender_ref?` · `status` |
| `building` | `building_id` PK · `name` · `address_line` · `city` · `project_id?` FK → project · `handover_date` · `warranty_end_date` · `status` · `gush?` · `helka?` · `building_number?` · `address_key` generated, UNIQUE |
| `space` | `space_id` PK · `building_id` FK → building · `space_kind` · `name` · `floor?` · `access_note?` |
| `unit` | `unit_id` PK, FK → space · `unit_number` · `rooms` · `area_sqm?` · `has_mamad` · `parking_space_id?` · `storage_space_id?` · `warranty_end_date?` · `condition_status` |
| `provider` | `provider_id` PK · `name` · `provider_kind` — E14, stub only. Present so R11 is resolvable. Everything else about providers waits. |
| `asset` | `asset_id` PK · `space_id` FK → space, NOT NULL · `asset_class` · `asset_type` · `make_model?` · `serial_no?` · `installed_date?` · `warranty_end_date?` · `warranty_provider_id?` FK → provider · `compliance_regime` · `next_inspection_due?` · `last_certificate_document_id?` FK → document · `source_document_id?` FK → document · `status` |
| `estate_event` | `estate_event_id` PK · `entity_type` · `building_id?` · `unit_id?` · `at` · `actor` · `kind` · `field` · `old_value?` · `new_value` · `source_document_id?` · `extracted_field_id?` — append-only log of a document-caused write onto an estate column (#141). |

Vocabularies: `project.status` = `PLANNING · ACTIVE · EXITED`; `building.status` = `ACTIVE ·
IN_CONSTRUCTION · EXITED`; `space.space_kind` = `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING ·
STORAGE`; `unit.condition_status` = `READY · RENOVATION · WITHHELD`; `provider.provider_kind` =
`IN_HOUSE_CREW · CONTRACTOR · DEVELOPER_WARRANTY`; `asset.asset_class` = `FIXTURE · SAFETY ·
UTILITY`; `asset.compliance_regime` = `NONE · PERIODIC_INSPECTION`; `asset.status` = `IN_SERVICE ·
FAULTY · REMOVED`. `asset_type` is the governed list on the FIELDS sheet, and a composite CHECK
binds each type to one class so a SAFETY sprinkler cannot be filed as a FIXTURE.

`unit_number` is text, not a number — `12A` exists. `rooms` is numeric because the Israeli
convention is 3, 3.5, 4. `handover_date` starts תקופת הבדק and `warranty_end_date` ends it; a unit
handed over separately overrides the building's date (R14), which is why the column is on both and
nullable on Unit.

`space.access_note` is commented `-- pii`. It is free text about how a technician physically gets
into a home, and it acquires a name and a phone number the first week it is used.

**`gush`, `helka` and `building_number` are typed identifiers, not keys and not promotion targets
(#143).** An operator copies them onto A11 from a tabu extract or a plan; a lease recites them and
does not establish them. All three are nullable text. None is unique: two buildings may share a גוש,
`helka` is a list (`43, 46`, order varying by page) so an integer column is wrong on the first
building we own, and `building_number` (`206`) is meaningful inside one project and collapses on a
standalone building. Blank on A11 is null. The plan-shaped import and the register importer write
null where the file has no value; A13 does not invent them. A later tabu type may promote onto the
typed columns; until then they are the typed side of a cross-check, not a capture.

## EstateEvent — old → new on a place (#141)

`tenancy_event` is the letting's log. A room count or a floor written from a lease is a fact about
the flat, not about the letting, so it does not belong there. `estate_event` is the counterpart:
append-only by trigger (`restrict_violation` on UPDATE or DELETE), `at` from the injected clock
with no `DEFAULT now()`, `kind` `amended` only and that kind always names a source document.

One table, keyed by the entity the promotion wrote. `entity_type` is `BUILDING` or `UNIT`; exactly
one of `building_id` or `unit_id` is set and it matches the type. Same discriminator shape as
`document_link`. There is no `space_id`: `unit.rooms` and `space.floor` on the unit's space share
`unit_id` (`unit_id` = `space_id`).

**Only a promotion appends.** A11, A13, `applyProtocolSeed`, and the register importer do not write
here. The typed original is `old_value` on the first promotion row. The unit sheet lists these
rows the same way it lists tenancy events, so an operator can ask what the room count used to be.

**`applyPromotedField` is the write.** It lives on this module's contract, beside `applyProtocolSeed`,
so evidence never issues SQL against `unit`, `space`, or `building`. It parses `rooms` as a number
and `floor` as non-empty text, updates the column, and appends. Occupancy of those columns is
`occupantOfEstateColumn`: a non-null value is occupied whoever wrote it.

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
`unit.parking_space_id` is the **built bay**. The household's assigned bay lives on the letting
(`tenancy.parking_space_id`, #146) and a reassignment does not rewrite this column. Removing a
space refuses when a letting still parks in it.

## Asset — E11, slice 3.5, `src/kernel/migrations/0012_assets.sql`

Fourteen columns, the widest entity in the workbook, and every one of them is on the FIELDS sheet.
`space_id` is `NOT NULL` with an FK — R3, and it is what makes responsibility fall out of location.
`asset_type` is a CHECK against a governed list, not a catalogue row, because the responsibility
matrix keys on it (foundation rule 8). The class/type pair is a composite CHECK: a type belongs to
exactly one class, so a `SAFETY` sprinkler cannot be filed as a `FIXTURE`.

`serial_no` is identifier-shaped and about a thing, not a person, and carries `-- not-pii:` so the
guard has a sentence to read. `warranty_provider_id` points at the E14 stub (R11).
`source_document_id` points at the handover protocol that created the row (R12).
`last_certificate_document_id` points at the most recent inspection certificate. Both document
columns are nullable: an asset can exist before its paper does, which is the lazy-fill path the
published Data Model already named.

The index is `asset (space_id)`, for the join Q3 and Q7 both take. An index on `next_inspection_due`
is deferred to a measurement: 2.6's precedent is that an index is decided at a row count with a
timing in front of it.

**R14 lives on Unit and Building, and Asset may override it further.** `building.warranty_end_date`
is the default; `unit.warranty_end_date` is the override when a flat was handed over separately; an
asset replaced under claim can carry its own. Flow A6 writes the first two from the two handover
protocols; an asset-level override is a later write.

**Q3 and Q7 are each one query** in `src/estate/internal/read-model.ts`, with `today` a parameter
and never `CURRENT_DATE`. There is no screen for them this week: the compliance tab's visual
treatment is on the week's cut line, and the acceptance bar is the query. Both strings sit in
`MEASURED_QUERIES` so `measure:scale` times what would run.

**The E14 Provider stub** is three columns — `provider_id`, `name`, `provider_kind` — and a unique
on `name` so a seed can be run twice. It lives in estate because R11 is an Asset fact and a second
module for three columns would be a cycle looking for a home. Everything else about providers waits.

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

## The surface — six reads and, from 6.1, two writes, `src/estate/internal/views.ts`

`GET /estate` lists the buildings; `GET /estate/buildings/:buildingId` shows one building, its spaces
by kind and its units. Slice 2.6 added three more: `GET /` is an index of the screens,
`GET /estate/search?q=` searches the portfolio, and `GET /estate/expiring` is Q5. Slice 3.6 added
`GET /estate/units/:unitId` — a thin unit page, not the workbook's full unit sheet.
`GET /estate/tenancies/:tenancyId` and `POST …/activate` — one letting (#107, flow A5).

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
the redirect was. **It moved to the composition root at slice 5.2**, as this paragraph had said it
would since 2.6 — the week a second *module* had a screen — because an index of screens is not
estate's fact. It lives at `src/index-page.ts`, beside `src/app.ts` which registers it, and it is the
one screen in this system whose nav spans two modules and carries the sign-out form. **Slice 5.2b
moved that bar off this module entirely**; **5.2c is the same rail as an ops sidebar**; **5.2d
is that rail as a phone drawer**, still not this module's. Estate writes none of it. The
composition root injects the chrome every signed-in screen carries.

**`GET /estate/search?q=` searches buildings and units, and deliberately not people.** A search that
reached `party` would put a real person behind a route with no session, the week the register
arrives; an address and a unit number are not personal data, and a name is. The name search is week
still owed: 5.2 built the login and **declined to lift the rule on the strength of it alone**
(SPEC.md, and 5.4 reconsiders). A **city matches buildings and not units**: a city
holds hundreds of apartments and sixty arbitrary ones is a worse answer than the buildings that
contain them, while a building name or an address narrows to one building and matches both.

**Slice 3.6 grew it by a documents half rather than forking a second search.** The documents query
lives in evidence (`searchDocuments`) and is injected here, because evidence already imports estate
and the other direction would be a cycle. It matches a type label, a unit number, a building name or
address — never a city, never a party, never the file's text. A unit hit links to the unit page, not
the building, so a 72-flat building is not the find path.

The term is trimmed, capped at 80 characters, and its **LIKE metacharacters are escaped**. A bound
parameter is not the same thing as a safe pattern: unescaped, a lone `%` matches the whole portfolio
and `_` matches every one-character name. Both halves fetch one row past the limit, which is how a
list learns it was cut off without a second `count(*)` over the predicate it just decided not to
read. The documents half keeps the same escape and the same limit; a second search that forgets
either is the defect 2.6 wrote a test for.

**`GET /estate/expiring` is Q5** — every ACTIVE lease in the portfolio ending inside sixty days, one
indexed query, ordered by date. It shows a unit, a building and a date and **no party at all**.

**Q3 (what is overdue for inspection in this building) and Q7 (which bay is assigned to unit 12,
and who serviced its gate motor)** landed as queries at 3.5, not as screens. Q3 is `Space → Asset
where next_inspection_due < today`. Q7 is `Unit.parking_space_id → Space → Asset`. Both are one
statement because every asset hangs on exactly one space.

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

The chip is a state and a count and never a tenant's name, which is the rule every screen here keeps
— including after 5.2, which was entitled to lift it behind the session and did not, and after 5.4,
which reconsidered it while unlocking evidence provenance and kept it again.

**These screens went behind the session at slice 5.2**, which closed the dated state this paragraph
described from 1.11 to week 5. Staff auth is Google sign-in behind an allowlist (5.1, amended by
5.1b); every estate route now declares the permission it requires — `estate.read` for the six reads,
`tenancy.write` for the exception POST — and a request with no session is sent to `/staff/login`
rather than served. The screens still carry `noindex` and still serve fixture data, because the real
corpus is gated behind F6 and not behind the login.

**Document metadata may appear; the bytes on the panel are a short-lived signed read.** Slice 3.6
puts type, dates, ingest date and the verification verdict on the building page (BUILDING-linked
paper) and on the unit page (UNIT-linked paper). **Slice 5.4 is where the panel mints a GCS V4 URL
(fifteen minutes)** in place of the `gs://` path as text. A signed URL is a bearer token for one
object; minting stays behind the session that 5.2 put on these screens, and search still does not
mint one. Who signed the paper is still `src/scope/`'s answer and is not on these screens. Real
tenant documents remain gated behind F6.

**Each listed document opens the read overlay** (`/documents/:id/read`). A lease also offers
`/documents/:id/tenancy` (flow A2). Search hits the overlay, not only the unit, and never a signed
URL. Building-level paper still lists only on the building page; unit paper still lists only
on the unit page — the building screen is not a tenancy draft.

### The first estate write — `GET /estate/buildings/new` and `POST /estate/buildings` (6.1)

Flow **A11** ([SPEC-flows.md](SPEC-flows.md)), and this module's first write route. Both declare
`estate.write`, which is ADMIN only ([SPEC-staff.md](SPEC-staff.md)): an operator files paper, an
admin shapes the estate. Until this slice every building in the system arrived through
`npm run import:register` or a committed fixture, and there was no way for anybody to create one.

**The write is `importEstate`, and there is no new estate command.** The POST builds a one-building
plan — zero spaces, zero units, and the `ProjectPlan` of the project it names if it names one — and
hands it to the importer. `validateBuildingSpaces` iterates `spaces` and `units`, so the empty plan
needs no special case, and the importer is already the only place in this system that writes a
building. A second write path would be a second copy of the natural keys this file spends a section
on, and the first thing it would drift on is `address_key`.

**Idempotence is the schema's, not the screen's.** `building.address_key` is `UNIQUE`, and the
importer's `ON CONFLICT (address_key) DO UPDATE … RETURNING` hands back the id already there. So a
double submit, a back-button re-post and a corrected typo all converge on one row — and the form
performs no check of its own, because a check in a form is a check a second writer does not make.

**The project is chosen from the ones that exist, never typed.** `listProjects` fills the select and
the plan is rebuilt from the chosen row's own `name`, `tender_ref` and `status`, so the upsert
rewrites the project as itself. `project_code` is a natural key under `DO UPDATE`: a free-text code
would rename an existing project on a typo, silently. "ללא פרויקט" is the default and R15's ordinary
case. Creating a project is its own slice on the day somebody needs one.

**A blank תקופת הבדק is derived rather than required**: handover plus `WARRANTY_YEARS`, through
`addCalendarYears`, which is 3.5's constant and 3.5's function rather than arithmetic re-typed into a
form. That function already refuses a non-ISO date with `invalid`, which is the handover field's
edge validation.

**גוש, חלקה and מספר בניין are optional and blank-to-null (#143).** They are the typed identifiers
on the building row, not values a lease establishes. A11 always writes what the form posted,
including null. An importer that omits the fields leaves whatever is already on the row, so a
register re-run does not wipe a number an operator typed.

The POST replies `303` to `/estate`. `importEstate` returns a report and no ids — a plan-shaped
caller already knows its own shape — and the buildings list is where a new building is looked for
anyway.

### The second — `GET /estate/buildings/:buildingId/units/new` and `POST …/units` (6.2)

Flow **A13** ([SPEC-flows.md](SPEC-flows.md)), the same `estate.write` stance on both halves, and
the screen that makes a building A11 created empty into a building with apartments in it. The
building page carries the door, and only for a viewer who holds the permission — the same rule the
buildings list keeps for `בניין חדש`.

**The write is `upsertUnitRow`, and there is no new estate command.** One `UNIT` space, one `unit`,
and a `PARKING` or `STORAGE` space **only where the caller named one**, in that order, in the
function the register importer has called since 2.4. It decides no name at all: the `UNIT` space is
named by the **bare `unit_number`**, which is what `src/register/internal/importer.ts` passes, and
a bay is named by the number A13’s operator read off the plan. Two writers spelling a name two ways
would be two apartments behind one door, and `space` is keyed `(building_id, space_kind, name)`, so
the key is the only thing stopping it.

**#140 took the invented bays out of it.** From 4.6 to #140 this function wrote `חניה {unit_number}`
and `מחסן {unit_number}` for every row and assigned both. That is a door number standing in for a
plan number and the two are unrelated: flat 206-4's bay is 594 and its storage room is unnumbered,
flat 206-7's are 574 and 601 (`evals/fixtures/lease-extraction.ts`, one building, one month). The
defect was silent, it made this function the second writer spelling bay names in a scheme no
document uses, and it made `unit.storage_space_id IS NOT NULL` a constant instead of a fact. Both
names are the caller’s now and null writes nothing — `MATCH SIMPLE` leaves both foreign keys
unenforced while null, and *unassigned* is what `0004_estate.sql` calls the ordinary state.

**A bay can be taken off again** — `POST /estate/spaces/:spaceId/remove` (`internal/spaces.ts`),
behind the same `estate.write` line. It detaches the one unit that points at the Space, then deletes
it, in one transaction, and **refuses rather than cascades**: an asset in it (R3), or two units
assigned to it, is a `conflict` naming which, and only `PARKING` and `STORAGE` may go (an apartment
is a Space and is the unit's own row, R2). This is the only delete of a `space` outside the operator
purge, and it exists because the rows 4.6 already wrote otherwise have no forward path: a real bay
number arriving later would leave a second `PARKING` space in the building with nothing to say which
is real.

**It is keyed on the Space and not on a Unit, and the building page lists what nothing points at.**
Those are one decision. An operator writing the real number *before* deleting the placeholder
repoints the flat and orphans `חניה 7`; writing it after leaves the flat still pointing at it. A
remove that needed a unit could only ever reach the second, so the case this whole ticket is about —
the second `PARKING` row — would have been unreachable, and which case you got would have depended
on the order you happened to work in. So the route takes a Space, and `חניות ומחסנים ללא שיוך` on
the building page is where an unassigned bay is visible at all. A bay the building genuinely has
spare is an ordinary row there; the section is hidden when it is empty.

**Nothing is backfilled** — which of two bays is real is an operator's judgement about a piece of
paper, not a migration's.

**The building is rebuilt from its own row.** `upsertUnitRow` takes a building, not a building id —
it is written for a flat file whose rows repeat their building — and its upsert sets
`project_id = EXCLUDED.project_id`. A route that passed the form's idea of a building would
therefore **unlink the building from its project** while adding an apartment to it. So the route
reads the building it was handed an id for and hands back that row's own values, and the upsert
rewrites the building as itself. It is A11's rule about the project, one level up: *rebuilt from the
row, never from the post*.

**Idempotence is the natural key's, and the form checks nothing.** The same `unit_number` posted
twice updates the flat — R2 makes the unit's identity its space's, so there is no second key to
disagree — and the screen performs no "does this flat exist" lookup, because a check in a form is a
check the register importer does not make.

`rooms` and `area_sqm` are validated at the edge as non-negative numbers and `rooms` is required:
the workbook's Israeli convention is 3, 3.5, 4, and `numeric` would otherwise accept whatever a
`text` input carried until Postgres refused it as `unavailable`. The unit-level `warranty_end_date`
is optional and blank means *the building's date applies* (R14) rather than *no warranty*.

The POST replies `303` to the building page, which is where the space count, the unit card and the
פנויה chip are — the acceptance bar's own wording, and the three things the write should have
changed.

**Slice 3.3 added the first write route in the system and it is `src/evidence/`'s, not estate's** —
`GET`/`POST /documents/new`, reached from a unit row on the building page. It went behind the session
at 5.2 with everything else, and its bounds are stated in full by
[SPEC-evidence.md](SPEC-evidence.md): one file, 100 MB, four kinds sniffed from the
bytes, no filename kept, nothing personal on the screen, a CSRF token from 5.2, and **fifty filed
documents per operator per rolling day**, which is the bound on a caller that none of the others
were. Only tier-1 specimens are filed until the corpus arrives, because it is gated behind F6 and
not behind the login.

**`getUnit` joined this module's read model at 3.3**, returning the `UnitHit` shape the search screen
already uses — a unit number and the building it is in, and no party. Evidence asks for it to render
the unit an upload is being filed against; a document screen inventing its own unit query would be
the second copy estate exists to prevent. **`GET /estate/units/:unitId` is the thin unit page 3.6
added**: that same header, the occupancy chip, the upload link, and the documents panel. Slice 4.4
adds the **promoted values** on that page: each stamped date is a link through to the page of the
read screen it was read from. **Slice 5.5 adds the change log** — old → new, the operator email, the source
document — from `listTenancyEvents`, injected the same way. Empty is legal. Never a tenant's name.
**Slice 5.6:** a clock-driven end is `ACTIVE → ENDED`, actor `system`, and no document link. The
unit page calls `expireDueTenancies` (injected from tenancy) against the clock before it reads the
log, so opening the sheet is what closes a lease whose date has passed — not a hidden job.
The workbook's other unit-sheet panels (tenancy, obligations, assets) wait.

**#114 is the office retrieval panel on that page.** A signed-in holder of `documents.read`
(ADMIN, OPERATOR, VIEWER — no new permission) sees a split pane on the visual left of the sheet:
the Unit keeps the remaining width; the thread fills the pane's height with the composer at the
bottom; a control collapses the pane to a rail and opens it again. Same checkbox-and-label
pattern as the ops nav — no client script. On a narrow viewport the pane sits under the sheet
and collapses to a bar. They ask in Hebrew; the post runs evidence's office-turn command bound to
this Unit and redirects back to the same GET, which paints that account's thread oldest-first.
Cited answers name the Document and the page, with a link through to the read overlay. A refusal
is the frozen Hebrew sentence, with no citations. If the office-turn command is `unavailable`,
the post still 303s to that GET with `ask=unavailable`; the pane shows the frozen Hebrew
*cannot answer now* sentence, the thread is unchanged, and the JSON error body does not replace
the estate screen. Clear deletes only this account's thread for this Unit. CSRF and a session are required on both posts. The GET itself stays `estate.read`;
asking and clearing are `documents.read`. All-buildings, search, expiring, incomplete, letting
sheet, documents, settings and queues do not render the Unit panel and do not keep a leftover
bound.

**#121 is the same panel on the Building page.** `GET /estate/buildings/:buildingId` grows the
same split for a signed-in holder of `documents.read`. The post runs the office-turn command
bound to this Building (the office bag: that Building's paper, every Unit in it, those Units'
lettings) and redirects to the same GET. The same `unavailable` 303 as the Unit panel: stay on
this Building, paint the frozen Hebrew notice, do not dump `{ code, message }` on the POST URL.
Clear wipes only this account's thread for this Building. A Unit thread and a Building thread for the same staff account stay distinct. CSRF and
a session on both posts; VIEWER may ask; no new permission. **#123:** a Building-bound turn may
list who is let today as well as search Passages; the panel is unchanged. The buildings list, Unit
page (which keeps its own panel), letting sheet, documents, settings and queues do not render a
Building panel and do not keep a leftover Building bound.

**`GET /estate/tenancies/:tenancyId` is A5's sheet (#107) and the tenancy card (#134).** The first
screen that shows one letting: the title an administrator recognises it by (tenant name, address,
apartment number), status, the lease's dates, the documents bound to the letting, what the gate
still misses, every check the gate returned, and the activate button. Estate renders; it does not
own the gate. The composition root injects `getTenancy`, `listTenancyParties`, the party-name lookup,
`activationGate`, `activateTenancy` and `listLinkedDocuments` for `TENANCY`. The page prints the
gate's facts and does not re-evaluate the four rules. `POST /estate/tenancies/:tenancyId/activate`
asks for `tenancy.write`, as the completeness exception already does. Party names appear on this
screen with no new permission; a later gate does not redraw it. Search, the occupancy chip, the
buildings list and the incomplete queue still carry no name.

**The card reads two kinds of fact (#134).** Rent, rent currency and option end come off
`tenancy`'s own columns via `getTenancy`. The rest of what the lease said is listed from
`listApprovedCapturesForTenancy` in this module's read model: approved `ExtractedField` rows on
paper linked to this letting, excluding declarations that already have a promotion target, each
cited to the page it was read from. Unapproved rows are not in the list. The view prints every row
it is handed and does not inspect a capture's value. This is the administrator stance; identifiers
render as printed.

**The documents listed on these screens are injected, not imported.** `EstateDeps` carries
`listLinkedDocuments`, `searchDocuments` and (from 4.4) `listPromotedFieldsForUnit` from evidence's
contract, and from 5.5 `listTenancyEvents` from tenancy's, and from 5.6 `expireDueTenancies`, wired in
`app.ts`. Estate renders the cards; evidence and tenancy own the SQL. Building-level paper stays on the building page; unit
paper stays on the unit page. Promoted values on the unit page never come from an estate query of
`extracted_field`. The tenancy card's render-only captures do: they are a read-model list, not a
command, and they are the exception CONTEXT.md names. The change log never comes from an estate
query of `tenancy_event`.

**`GET /estate/incomplete` is A4's queue (slice 4.8).** Same standing as `/estate/expiring`: a
portfolio operations list, a unit and a date and a missing-rule label, and no party. Completeness
is tenancy's query; the POST that records an exception is tenancy's write (guarantor only); both
are injected. **#108:** each gate miss is a row on this same screen, labelled with the gate's
rule, never a second list. The root index and the rail gain a fourth link. The index lived here until **5.2 moved it to
`src/index-page.ts`**, on the schedule 2.6 set for it. **5.2b took the remaining private nav with
it**; **5.2c did not give it back**. This module's screens receive the composition root's chrome.

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

**Slice 6.2 gave it a second caller** — A13's apartment screen — which is the test of whether it was
extracted rather than copied: the screen adds one flat with a floor and an optional warranty date and
needs no statement of its own. The register still passes a project to upsert; the screen passes
`null` and names the building's existing `project_code`, because the project is already there and
the code is all `upsertBuilding` resolves it by.

**Slice 4.6 also upserted a `PARKING` space `חניה {unit_number}` and a `STORAGE` space `מחסן
{unit_number}` and assigned them on the unit. #140 removed that.** The placeholders were meant to
give a handover protocol a bay to land a gate motor on, and they cost more than they gave: the names
are in no document, the register file has no bay columns to correct them from, and every A13 flat
carried two. The function writes what its caller names and nothing else now; the register names
neither, so a line is one Space. A building whose real bay count is known (Shoham) arrives as a
plan. A real register whose counts disagree is 2.5's to measure.

## Operator purge (not a screen)

The screens never destroy a **Document**, a **Building**, or a **Unit**. That rule stays. Developers
need a way to empty a place on **local** or **staging** so the same specimen can be filed again
(`file_hash` is unique until the Document row is gone).

`listEstatePurge` / `applyEstatePurge` (CLI `npm run estate:purge`, staging wrapper
`infra/estate-purge.sh`) are that act. Prod is refused. There is no portfolio wipe. List by address
or id; apply by **Building** id or **Unit** id only. Confirm is y/n on the laptop, never inside a
Cloud Run job.

Staging's runtime is not superuser, so apply cannot set replica role. It rolls a savepoint
and disables the two delete-guard triggers instead; a failed SET must not abort the write.

Apply removes what hangs off that place: Spaces and Units, Assets, Tenancies and TenancyParty,
Documents (readings, Passages, links) whose place is in the bag, office retrieval threads for those
bounds. A **Party** with no remaining Tenancy goes; a person still on another street stays. Project,
DocumentType, staff, terms_profile, and sibling Units stay. A Building-bound Document stays when
only one Unit is applied.

Rows first. The wrapper then prints object prefixes for `infra/docs-delete.sh`. If the bucket step
fails, the hash is already free; leftover bytes are restorable for seven days.

## What is deliberately not a column

- **`Building.unit_count`** — counted, never stored. A stored count drifts the first time someone
  adds a unit.
- **`Unit.occupancy`** — derived from tenancy dates (R6). `condition_status` is *not* occupancy: a
  unit can be `READY` and occupied, or `READY` and empty.
- **A typed estate column, for promotion** — a different question from the chip. A non-null
  `unit.rooms` or `space.floor` is occupied whoever wrote it (A13, the register, or a later
  promotion). There is no provenance column. Evidence does not query these tables; the lookup lives
  on this module's contract. The refusal itself is [SPEC-evidence.md](SPEC-evidence.md), *A promotion
  onto an occupied column*. Tenancy occupancy is unchanged.
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
