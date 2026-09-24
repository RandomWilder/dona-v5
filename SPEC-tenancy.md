# SPEC: tenancy

**Owns who holds which unit, when, and under what obligations.** Shared conventions live in
[SPEC.md](SPEC.md) and are not repeated here. The column lists below are the workbook's FIELDS sheet
([docs/model/](docs/model/)), which is a specification and not a description; where this file and the
workbook disagree, the workbook is right and this file is a bug.

- **Owns:** E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType, plus an append-only
  `TenancyEvent` beside the mutable row.
- **Depends on:** estate, parties.
- **Built:** week 2, slice 2.2 — Tenancy and TenancyParty; `terms_profile`'s natural key and the
  module's three write commands at slice 2.4. `TenancyEvent` lands at slice 4.3 with promotion.
  Slice 4.8 adds the completeness query and `tenancy_completeness_exception` (A4). Slice 5.6 adds the
  clock-driven `terminated` kind. Slice 5.7 lands Obligation and ObligationType (E9, E10).

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
| `tenancy` | `tenancy_id` PK · `unit_id` FK → unit · `start_date` · `end_date` · `status` · `terms_profile_id` FK → terms_profile · `notice_date?` · `actual_move_out?` · `rent_amount?` · `rent_currency?` · `option_end_date?` · `parking_space_id?` · `storage_space_id?` |
| `tenancy_party` | `tenancy_id` + `party_id` composite PK, both FK · `role` · `is_service_contact` |

Vocabularies: `tenancy.status` = `DRAFT · ACTIVE · ENDED · TERMINATED_EARLY`; `tenancy_party.role` =
`PRIMARY_TENANT · CO_TENANT · GUARANTOR · OCCUPANT`, where GUARANTOR is ערב — on the lease, but not a
resident.

**No amount column here, and no test asserts that any more.** Foundation rule 2 is retired
([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)) and the two
`information_schema.columns` cases in `src/tenancy/schema.test.ts` that forbade a money-named column
on `tenancy`, `tenancy_party`, `terms_profile`, `obligation` and `obligation_type` are deleted with
it. **A balance is still Priority's** and this module writes none. What *does* land on `tenancy` is
the next paragraph: rent, because code will branch on it.

**Track B amends the first half of that paragraph and leaves the last sentence exactly as it is.**
`tenancy` gains three nullable columns — `rent_amount`, `rent_currency` and `option_end_date` — and
`src/tenancy/schema.test.ts`'s exact column list moves with them in the same change. The reason is
not that an amount has become welcome here; it is the test the evidence module applies to every
promotion target, **will code branch on it**, and rent is the clearest yes this schema has. Arrears,
reminders and the office bag all compare a rent to something. A value nothing compares stays where
it was read: deposit, maintenance and the promissory note remain captured rows, quoted at move-out
and cited from the page, and they acquire no column here. The ruling and its cost are written in
[SPEC-evidence.md](SPEC-evidence.md), *Three more copies — track B*, which is also where the
promotion refusals that guard these columns live. **A balance is still Priority's**, none of the
three is one, and this module still writes none.

**Track A adds the assigned bay.** `parking_space_id` is nullable and points at a `PARKING` space
by the same composite-key technique estate uses for the built bay. It is where **this household**
parks. The built bay (`unit.parking_space_id`) is untouched by a move: that column is the plan's
הצמדה and it survives vacancy. The landlord may reassign the household with no amendment and no
new document. `reassignParkingSpace` is the eighth write command: it writes the assigned bay and
appends `tenancy_event` of kind `reassigned`. That kind **must not** name a source document
(`reassigned_has_no_document`), because `amended` is constrained to name one and this act has none.
Promotion of a lease's `parking_space_number` lands here, never on the built bay. A non-null
assigned bay is occupied whoever wrote it — a typed reassignment must not be overwritten by a
later copy off the paper unless the operator said supersede.

**#148 adds assigned storage the same way.** `storage_space_id` is nullable and points at a
`STORAGE` space. Promotion of `storage_space_number` lands here, never on built storage
(`unit.storage_space_id`). A printed number that matches no `STORAGE` space in the Building
refuses that write only; the rest of approve may succeed and the lease does not mint a Space.
`reassignStorageSpace` is the ninth write command: same `reassigned` kind, no source document.
A non-null assigned-storage column is occupied whoever wrote it.

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

## The option, exercised — track B

Both lease specimens run an initial term with an option to extend, and both print all four dates. So
the record has to answer a question it has never been asked: what happens when a tenant takes the
option. The answer is that **nothing ends and nothing begins**. The same household stays in the same
flat under the same agreement, for longer.

**`exerciseOption` is the seventh write command.** It appends a `tenancy_event` of kind `extended`
and moves `end_date` to `option_end_date`. The event is the history, in the same shape `activated`
and `terminated` already use, and the column move is what every reader of this schema already
understands. `option_end_date` is **not cleared**, because a letting that was extended is a different
fact from a letting that was always five years long, and that column is the only place the
distinction survives. The letting's identity does not change; a second `tenancy` row is refused by
construction, because that is a turnover.

**The kind is `extended`, and its `source_document_id` is nullable** — which is neither of its
neighbours' shapes, deliberately. `amended` requires a document, because a promotion is a copy off a
page and naming the page is the whole point. `terminated` and `activated` forbid one, because a clock
and a person are not paper. An option exercise is honestly either: sometimes a signed notice arrives
and should be cited, and sometimes it is a phone call the office records. Forcing it into one of the
two existing shapes would make the spec certain where the world is not, and the cost of being wrong
is an operator with a letter they cannot attach or a field they have to invent a document for.

Two alternatives were considered and refused. **Updating `end_date` alone** loses the fact that an
option ever existed, which is the one thing the renewal conversation needs. **Creating a second
tenancy row** makes one continuous letting look like a turnover — and that is precisely the
distinction the isolation rule exists to preserve. #124 drew the tenant's bag around the Tenancy on
the reasoning that a previous household's paper must not be reachable from a current letting; a
renewal is not a previous household, and a schema that modelled it as one would hide this household's
own first five years from it.

## What is deliberately not here

- **`terms_profile` has one column beyond its key, and that is not an oversight.** The workbook makes
  `Tenancy.terms_profile_id` a NOT NULL foreign key, and a NOT NULL foreign key needs a target that
  exists. Which maintenance annex governs a lease is what Q4 — the responsibility decision — keys on,
  so it may not be nullable and quietly absent. E1 `project` landed the same way at 1.9: identity
  now, fields when we know what they must carry. **Open question 2 — how many profiles are in force —
  is week 5's, and the responsibility matrix that reads them is the policy week's.** Until then the table
  holds a name, and the importer has to say which profile each lease is on, which is a question for
  the client that a nullable column would have hidden until the policy week.

  **Its natural key is `UNIQUE (name)`, chosen at 2.4** in `0009_import_natural_keys.sql`. The
  importer needs to look a profile up idempotently and a register names one by its name; *how many*
  are in force is a different question from *what identifies one*, and only the second was owed here.
  **A lease naming no profile is a reject with its line number, not a defaulted row**
  ([SPEC-register.md](SPEC-register.md)) — defaulting to `standard` would have answered a question
  the client has not been asked, which is exactly what the NOT NULL exists to prevent. **The
  administrator flow is different (#110):** the published leases do not print an annex name, so a
  draft created from an approved reading takes `נספח תחזוקה — תקן` when that row exists, otherwise
  the sole profile, otherwise it refuses. The register importer still has no default.
- **Obligation and ObligationType (slice 5.7, `src/kernel/migrations/0026_obligation.sql`).**
  E9 and E10 from the workbook. An obligation attaches to a **tenancy**, never a unit (R10). Status
  is derived on read and is never a column. There is no amount column, because no ticket has asked
  for one — not because a rule forbids it (ADR-0008). `responsible_party` is copied from the type at creation and then lives on the obligation
  row, so a later edit or deactivation of the catalogue cannot rewrite a dispute's record
  (foundation rule 8). The create command does not take an override. `ObligationType` is
  deactivated, never deleted: a `BEFORE DELETE` trigger raises `restrict_violation` even when no
  obligation points at the row. There is no delete on the contract. The five seed codes
  (`ARNONA · CONTENTS_INSURANCE · BANK_GUARANTEE · UTILITY_ACCOUNT · HOUSE_COMMITTEE`) are data
  (`npm run seed:obligation-types`), not this migration — the same open-catalogue move as
  `document_type`. **Slice 5.8** is that screen: `listObligationTypes` returns every row, inactive
  included, ordered by code, and the composition-root form posts through `upsertObligationType`.
  A sixth code costs no migration. The obligations strip on a unit is month two.

  Derived `status` (`SATISFIED · EXPIRING · EXPIRED · MISSING`), from the injected clock's day — the
  office's zone, `today(clock)`, never the UTC day (slice 7.2b) — and a 60-day window matching the
  expiring-leases list: `MISSING` when the type
  `requires_evidence` and `evidence_document_id` is null; else `EXPIRED` when `valid_to` is
  strictly before today; else `EXPIRING` when `valid_to` is within 60 days inclusive; else
  `SATISFIED`. `evidence_document_id` is a nullable FK to `document` in kernel DDL; this module
  still does not import `src/evidence/internal/`.
- **`TenancyEvent` (slice 4.3, `src/kernel/migrations/0019_tenancy_event.sql`; clock kind at 5.6,
  `0025_tenancy_event_terminated.sql`).** The row is mutable; the log is not. Every promotion that
  copies an extracted value onto a typed column appends
  `(field, old → new, actor, source_document_id, extracted_field_id)` with `kind = 'amended'`.
`source_document_id` is NOT NULL for that kind (`amended_names_its_document`) and that constraint
is never dropped. `kind` is `amended | terminated | activated | extended | reassigned | ended_early`. A clock-driven end is
`terminated`; a person making a draft live is `activated`; a person taking the option is
`extended`; a person moving the household's bay is `reassigned`; a person ending a letting before
its contractual end is `ended_early`. `terminated`, `activated` and
`reassigned` carry a null `source_document_id` and
`extracted_field_id` (`terminated_has_no_document` for the clock kind, `activated_has_no_document`
for the person kind, `reassigned_has_no_document` for the bay). `extended` and `ended_early` name a document when there is one and do not when there is
not — no extra CHECK, because both are honestly either a signed notice or a phone
call. `terminated_has_no_document` is not relaxed: the clock's kind keeps its shape, and the person's early end is a different kind. UPDATE and DELETE are rejected
  (`restrict_violation`). `at` comes from the injected clock; there is no `DEFAULT now()`. `actor`
  is `-- pii`; a clock end snapshots `system`, not an operator. Register `upsertTenancy` does
  **not** write events — isolation dates from the import stay legal without a document.
  `applyPromotedField` is the fourth write command: parse the value the column holds, update the
  named column, append the event. A collision on `(unit_id, start_date)` is `conflict`. `expireDueTenancies(db, clock)`
  is the fifth: every `ACTIVE` tenancy whose `end_date` is strictly before the clock's day in the
  office's zone becomes `ENDED` and appends `terminated` with `field = status`, `ACTIVE → ENDED`.
  The last day of the lease still counts (isolation's `end_date >= today`); the day after is when
  the clock closes it. A second call is a no-op. Natural end is `ENDED`, never
  `TERMINATED_EARLY`. **The clock never writes `ACTIVE`.** A draft whose start date has arrived
  stays a draft until a person activates it (A5, #106). `activateTenancy` is the sixth write
  command. `exerciseOption` is the seventh: an `ACTIVE` letting whose `option_end_date` is later
  than `end_date` moves `end_date` to that option end, leaves `option_end_date` in place, and
  appends `extended` with `field = end_date`. A missing letting is `not_found`. Ended, with no
  option, or already at the option end is `invalid`. The actor is the person who invoked it.
  `reassignParkingSpace` is the eighth: an existing letting, a `PARKING` space in the same
  building, and no paper. It writes `tenancy.parking_space_id` and appends `reassigned` with
  `field = parking_space_id`. `unit.parking_space_id` does not move. A space of another kind, or
  in another building, is `invalid`. The same bay twice is a no-op. `reassignStorageSpace` is the
  ninth, the same shape for `tenancy.storage_space_id` / `STORAGE` / built storage.
  `endTenancyEarly` is the tenth. It takes an `ACTIVE` letting, an `actual_move_out` on or before
  the clock's day and inside the contractual term (`start_date` through `end_date`, inclusive), an
  optional `notice_date` on or before that move-out, the person, and an optional source document.
  Status becomes `TERMINATED_EARLY`. The contractual `end_date` does not move; `actual_move_out`
  records the day they left and `notice_date` records the notice when there was one. The event is
  `ended_early` with `field = status`, `ACTIVE → TERMINATED_EARLY`, and the person as actor. A
  missing letting is `not_found`. Not `ACTIVE` is `invalid` (`this letting is not active`). A
  move-out before `start_date` is `invalid` (`the move-out is before the lease starts`). A move-out
  after `end_date` is `invalid` (`the move-out is after the contractual end`) — past the end, the
  clock ends it. A move-out after the clock's day is `invalid` (`a future move-out is notice, not
  an end`). A notice after the move-out is `invalid` (`the notice is after the move-out`). Because
  `one_active_tenancy_per_unit` is partial on `ACTIVE`, the ended row no longer occupies the unit.
- **No read model, and from 3.3 exactly one list plus one lookup.** *(Slice 6.5 adds a second list,
  `countIdentifierOverlap`, described at the end of this bullet.)* `contract.ts` exists from 2.4
  and exports the register importer's three write commands — `upsertTermsProfile`, `upsertTenancy` and
  `upsertTenancyParty` — plus `applyPromotedField` from 4.3, `exerciseOption` from #135, and
  `reassignParkingSpace` from #146, `reassignStorageSpace` from #148, and `endTenancyEarly` from #154. `listUnitTenancies` joins them at 3.3.
  Slice 4.6 added `findTermsProfileByName`: A2 must hang a draft on a profile that already exists and
  must not invent `standard`. A missing name is `null`, not an upsert. Slice 4.6b added
  `listTermsProfiles`: names only, ordered, so the confirm screen is a select of what already exists
  rather than a free-text guess. An empty list is legal and writes nothing — it does not insert a
  default. Flow A2 writes a `DRAFT`
  through these same commands; evidence is the only caller that creates `tenancy_party` from a
  lease, and only after a human confirms each role. Slice 4.7's addendum confirm uses the same
  `upsertTenancyParty` path to add a `GUARANTOR` under the existing tenancy, and
  `applyPromotedField` to let a later `end_date` overwrite the earlier column while the event log
  keeps both. Slice 4.8 adds `listIncompleteTenancies` and `recordCompletenessException`: a
  portfolio question (S1 / A4), not "who is in this unit today". It takes no phone number, returns
  no party and no name, and carries neither isolation predicate. Completeness is a query over saved
  rows plus an exception table — never a NOT NULL on `tenancy_party` and never a status column on
  `tenancy`. **#108:** the same query also surfaces every activation-gate miss as a named rule,
  using the gate's own identifiers (`lease`, `handover_protocol`, `start_reached`, `within_term`,
  `unit_free`)
  and never a second copy of those predicates. The clock and the document reader are injected the
  way the gate already takes them. A tenancy whose every gate check passed is not listed for the
  gate; the guarantor rule remains its own row. Only misses appear. **#156** amends the rule that
  gate misses are not excepted: `handover_protocol` may be waived for one letting. A recorded
  waiver makes that check pass, and any row the letting still occupies on this queue carries who
  recorded it, the office day, and the reason. The query stops listing the protocol miss. `lease`,
  `start_reached`, `within_term` and `unit_free` stay unexcepted. Slice 5.6 exports `expireDueTenancies` beside them. Slice 5.7 exports
  `upsertObligationType`, `createObligation`, `getObligation` and `listObligationsForTenancy`.
  Slice 5.8 adds `listObligationTypes`. #106 exports `activationGate` and `activateTenancy`.
  `REQUIRED_FOR_ACTIVATION` is `['lease', 'handover_protocol']` — one constant, the only list. The
  gate returns every check with its outcome, passes included: one row per required type (held and
  approved on the letting, or not), `start_reached`, `within_term`, `unit_free`. **#157:** for
  `handover_protocol`, approved means A6's confirm was signed for that document. The reader reports
  it from `evidence.confirm_protocol`. A link alone is not approval, including a protocol linked
  before the signature existed. Those lettings are listed on A4. A lease stays approved by its
  TENANCY link. `unit_free` passes
  when no other `ACTIVE` letting on this unit overlaps this letting's inclusive date range — the
  same range `one_active_tenancy_per_unit` excludes. A miss names that letting by id and dates only,
  never a party. `unit_free` is not waivable. **#156:** `handover_protocol` is. A row in
  `tenancy_completeness_exception` for that rule, and no approved protocol on the letting, makes
  the check pass and carries `waived: { actor, at, reason }` — the person, the clock's instant, and
  the written reason. An approved protocol still passes on its own and does not report a waiver.
  A fully-approved future letting reports `activatableOn`
  as the lease start date only when `unit_free` also passed. `activateTenancy` refuses unless every
  check passed, the row is `DRAFT`, and the actor is a name. Evidence-side facts arrive through an
  injected reader: **this module imports no evidence module**.
  **#107 adds `getTenancy` and `listTenancyParties`.** The sheet is estate's screen; these two
  reads are what it is allowed to ask. `getTenancy` takes a `tenancy_id` and returns dates, status
  and `unit_id` — no party and no name. `listTenancyParties` returns `party_id`, `role` and
  `is_service_contact` for that letting, still no name. The composition root asks parties for the
  names the title needs. Neither query carries a temporal predicate. An `ENDED` letting is not reopened
  by the clock or by `activateTenancy`; the register may still write historical `tenancy_party`
  rows onto an `ENDED` row because that is how a past household is loaded. A required document
  whose `valid_to` is strictly before today, on an `ACTIVE` letting, is a flag on the gate and
  never a status change.
  **#122 adds `listActiveLettingsInBuilding`.** An office inventory of who is let in a Building
  today, not the front door and not a second isolation join. It takes a Building id and the clock,
  and returns one row per Unit in that Building whose letting is `ACTIVE` and whose dates cover
  the clock's day in the office zone (`today(clock)`), the same clock comparison `activationGate`
  already makes in this module. Each row is the Unit's name, the letting's start and end, and the
  `full_name` of every party on that letting except `GUARANTOR` (ערב). It returns no phone, no
  ת.ז., no rent, no captured field, no party id and no tenancy id. Vacant Units, `DRAFT`, `ENDED`,
  `TERMINATED_EARLY`, and an `ACTIVE` letting that has not started or has already ended relative to
  today are absent. Another Building's lettings are absent. An empty list is the answer when nobody
  is let there today — including a Building id that names nothing — and is not an error. The
  command takes no phone number. Estate does not own this read; evidence does not query tenancy
  tables for it. Offering it on a Unit bound, a portfolio bound, or a tenant-facing path is #123's
  refusal, not this command's. The covering-today filter is not written as the isolation join's
  tenancy-active predicate (guard two); it is applied here from the clock, after a query that
  selects `ACTIVE` lettings in the Building and no day predicate.
  Slice 5.5 adds
  `listTenancyEvents`: every event row on every letting of one unit,
  oldest first, `unit_id` in, field / old → new / actor / source document out, **no party and no
  name**. An empty list is a register-only letting. A `terminated` row carries a null document. The line this module does not cross is the one
  that matters: **who a phone reaches today is `src/scope/`'s answer and never this module's**, which
  is foundation rule 1 expressed as a module boundary. The office roll of who is let in a Building
  today is `#122`'s, and it takes no phone. `listUnitTenancies` answers *which lettings
  does this flat have* — every status, ordered by date — for an administrator choosing which one a
  lease belongs to. It takes a `unit_id` and never a phone number, it returns dates and a status and
  **no party and no name**, it carries neither of the isolation join's temporal predicates, and
  nothing decides what anybody may see from its result. A query here that answered "who is in this
  unit today" would be the second copy of the join, and guard two exists because that is how the
  constraint dies.

  **Slice 6.5 adds `countIdentifierOverlap`, and it is the narrowest read in this module.** A2 has to
  rank a flat's lettings so an operator with a lease in their hand can be shown which one it probably
  belongs to, and the useful signal is *does this letting already hold one of the people this lease
  names* — asked of a **declared identifier** and never of a name (SPEC-flows.md A2 step 5). It takes
  a `unit_id` and a list of identifiers read off the paper, and it returns **`tenancy_id` → a count**.
  What leaves it is the count: **no party, no name, no identifier, no key and no row**. The
  identifiers are normalised by `party_national_id_key()` — the same fold `party.national_id_key` is
  generated with, written once in SQL rather than a second time in TypeScript — and are compared
  inside the statement, so the probe never round-trips either. It carries **no temporal predicate of
  any kind**: date overlap is the caller's arithmetic over the dates `listUnitTenancies` already
  returns, because the predicate that would express it in SQL is guard two's and belongs to
  `src/scope/`. It is not the isolation join and cannot become one: it takes no phone number, it
  answers about a flat and not about a person, and its answer is a number. **Reading it is a read of
  an identifier and the caller writes `evidence.match_identifier` for it** (SPEC.md, Security
  defaults); this module writes no audit line, because it does not know who asked.
- **`tenancy_completeness_exception` (slice 4.8, `src/kernel/migrations/0020_tenancy_completeness.sql`).**
  `(tenancy_id, rule)` unique. `rule` is `guarantor` or `handover_protocol` (#156). Other gate
  misses are not excepted; they clear when the gate passes. The CHECK refuses `lease`,
  `start_reached`, `within_term` and `unit_free`, and that refusal is the enforcement. `at` comes
  from the injected clock; no
  `DEFAULT now()`. `actor` is `-- pii`, same standing as `tenancy_event.actor` until week 5 has
  staff. `reason` is required text, validated at the POST. A second insert of the same pair is a
  no-op. There is no completeness column and no CHECK that a tenancy has a guarantor.
- **An index on `end_date`, partial on `ACTIVE`, added at 2.6** — `tenancy_end_date_active` in
  `0010_scale_indexes.sql`. 2.2 left it out deliberately, to be decided at full row count with a
  timing in front of it, and 2.6 is the slice with the row count. Measured over 1,674 tenancies, on the tenancy
  access alone, with the index dropped inside a rolled-back transaction: without it a sequential scan
  of every tenancy the company has ever signed — 53 buffers, 1,530 rows discarded, 0.080–0.086 ms;
  with it a bitmap index scan reading two index pages, 0.032–0.043 ms. Twice the speed is not the
  argument — nothing here is slow yet — the shape is: the scan grows with the archive and the index
  grows with the answer. **Partial on `ACTIVE`**, which is `one_active_tenancy_per_unit`'s
  move and for the same reason: `ACTIVE` is exactly the set the question asks about, so the index
  holds 144 rows of 1,674 and only an `ACTIVE` row pays for it on write.
  `tenancy_party (party_id)` also exists, because the composite primary key `(tenancy_id, party_id)`
  does not serve the isolation join's third hop.

## Tables — `src/kernel/migrations/0026_obligation.sql`

Workbook E9 and E10. No `DEFAULT now()`. No status column. No amount.

| Table | Columns |
|---|---|
| `obligation_type` | `obligation_type_id` PK · `code` unique · `label_he` · `label_en?` · `default_responsible_party` · `requires_evidence` · `is_active` |
| `obligation` | `obligation_id` PK · `tenancy_id` FK · `obligation_type_id` FK · `responsible_party` · `valid_from?` · `valid_to?` · `evidence_document_id?` FK → document |

Vocabularies: `responsible_party` and `default_responsible_party` = `TENANT · OPERATOR`.

## Open

- **Which `terms_profile` a real lease is on.** 2.4 settled how one is *identified* — by name — and
  left this open, because it is a fact about the client's leases and not about the schema. The
  register format requires the column, so an export that does not carry it is a question raised at
  import time rather than a gap discovered by a matrix with no input. **2.5's.**
- **What the overlap constraint does to the real register.** A register with sloppy dates will have
  rows rejected at 2.5. That is the intended direction — a reject with a line number rather than two
  households in one apartment — but the count is a fact about the client's data and is recorded when
  it is measured.
