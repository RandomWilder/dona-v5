# SPEC: flows

**The layer this repository did not have.** Every other specification names *things* — entities,
constraints, modules, weeks. None of them names the **sequence a person moves through**, and that
absence is why the plan drifted toward a bulk-ingestion shape nobody asked for: intake was the only
flow ever written down, and it was written as infrastructure rather than as something an administrator
does on a Tuesday morning with a signed lease in front of them.

This file is the corrective. Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here.
Where this file and the workbook ([docs/model/](docs/model/)) disagree, the workbook is right and this
file is a bug.

- **Owns:** nothing at runtime. This module ships no code, no tables and no `contract.ts`. It is a
  specification that other modules are measured against.
- **Depends on:** estate, parties, tenancy, scope — it describes how those are composed.
- **Governs:** every slice from 3.x onward. **A slice that serves no flow in this file gets cut on
  sight**, and a flow that no slice implements is either scheduled or deleted. That reciprocity is
  the point of writing it down.

## The method these flows are built by

Adopted 2026-09-06 as the standing approach for the project, generalising
[docs/pipeline.md](docs/pipeline.md) principle 5 from data to documents:

> **concept → work with example documents → verify the concept via schema review → work with real
> documents, preparing for pilot.**

Four steps, in that order, for every document type and every flow that touches one. The consequences
are structural rather than stylistic:

- **Step 2 runs on the tier-1 corpus first.** Real Dona Dom leases are tier-2 personal data and are
  gated behind fuse **F6** — the OpenAI DPA, Google Cloud's CDPA confirmation, and the published
  notice to data subjects. The tier-1 corpus is authored Hebrew text structured to the same published
  forms with no real person in it, so concept and schema can be proved today and real specimens swap
  in against a schema that was already correct.
- **Step 3 is a review, not a test run.** The question asked of a schema at step 3 is *did the
  declared fields turn out to be the right fields*, which is answered by reading filled rows beside
  the document they came from. It is cheap, and it is the step that would otherwise be skipped.
- **Step 4 is where volume and the real register arrive**, and not before. Three to five document
  types with a handful of specimens each is the working unit. The whole corpus, the pilot building's
  144 units and the 1,500-unit claim all belong to step 4.
- **Fuses F3 and F4 are therefore step-4 dependencies, not week-2 blockers.** Neither gates the
  concept work, because the concept work does not need them.

## The invariants every flow obeys

These are stated once here and enforced in the modules named. A flow that appears to need an exception
is a flow specified wrongly.

1. **Documents bind to a tenancy, and the tenancy binds to the unit.** The primary binding of an
   uploaded document is the tenancy, because the tenancy is the thing that has dates, parties and
   obligations; the unit is one hop away and is reached, never duplicated. `DocumentLink` already
   carries the several bindings a signed lease legitimately has — tenancy, unit, both signatories —
   so this is a statement about which binding the *upload flow* asks for, not a new structure.
2. **Fields live on the entity; documents are provenance.** A document does not own a schema that
   gets filled in. The tenancy owns its fields, and **every field records which document and which
   page it came from**. An addendum arriving with the lease and an addendum arriving six months later
   travel the identical path, because neither is patching a document — both are contributing a value
   to a tenancy. Without this rule, addendums need a second mechanism for amending a prior
   extraction, and that mechanism grows worse with every document type added.
3. **`DocumentType` and `DocumentTypeField` describe what to look for in a file. They are not where
   answers land.** They are the extraction target list, versioned by `effective_from`
   ([archive/tasks-w1-7/roadmap.md](archive/tasks-w1-7/roadmap.md), slice 3.1).
4. **Completeness is a state, never a NOT NULL.** A requirement that a database rejects is a
   requirement an addendum can never satisfy, because the row it would complete was refused. Business
   requirements about *what a tenancy ought to have* are policy cases over saved rows; database
   constraints are reserved for what must never be true at any instant.
5. **The model reports; it never decides and it never invents.** Finding zero guarantors is a valid
   extraction result and must not be an error, a retry, or a guess. Where a value carries an isolation
   or responsibility consequence, a human confirms it before it is written.
6. **Type is declared, not classified.** The flow already knows what it asked for. Classification —
   the riskiest ingestion step — does not exist in this system.
7. **Who is in a unit is computed from dates, on every load.** Foundation rule 1, enforced by
   `src/scope/` and a CI guard. No flow may cache it.

## Tenancy states, and why a draft is not an empty shell

`tenancy.status` is `DRAFT · ACTIVE · ENDED · TERMINATED_EARLY`
([SPEC-tenancy.md](SPEC-tenancy.md)). The flows below turn `DRAFT` from a placeholder into the state
where most administrative work actually happens.

**A tenancy is normally established before its start date and while the unit still has an active
tenancy.** Leases are commonly signed sixty days ahead, though nothing obliges it. So the overlapping
pair — one `ACTIVE`, one `DRAFT`, on the same unit — is the ordinary case and not an anomaly.

The schema already supports this exactly, which was verified rather than assumed:

- `one_active_tenancy_per_unit` is an exclusion constraint **partial on `status = 'ACTIVE'`**, so a
  `DRAFT` overlapping a live tenancy is permitted, and the constraint bites at precisely the right
  moment — promoting `DRAFT → ACTIVE` while the outgoing tenancy is still `ACTIVE` is rejected by the
  database.
- `src/scope/internal/isolation-join.ts` resolves the tenancy **active on a supplied date**
  (`status = 'ACTIVE' AND start_date <= $2 AND end_date >= $2`, the date passed as a parameter and
  never `CURRENT_DATE`). A departing tenant and an incoming one therefore cannot both answer for one
  unit, and a `DRAFT` tenant reaches nothing at all until their tenancy starts.

**A draft tenancy is created with unit, dates and at least one tenant — all three extracted from the
lease.** It is never created empty and never created ahead of the document, because the document is
what supplies its identity. This is what makes the upload flow the *origin* of a tenancy rather than
an attachment to one somebody typed in first.

## The flows

Each flow is named, and every slice from 3.x forward cites one. `A` is administrative, `T` is
tenant-facing, `S` is staff- or owner-facing.

### A1 — Declare and upload a document

**Trigger:** an administrator holds a file and knows what it is.
**Screen:** choose the unit, choose the document type from the catalogue, attach the file.
**Writes:** one `document` row with `file_hash` computed at ingest and immutable thereafter; the
object in the docs bucket, whose path carries the place and never the people; one `document_link`.
**Module:** a new admin surface over documents; storage per slice 3.2, where the runtime account holds
`objectViewer` + `objectCreator` and deliberately not `objectAdmin`, so the application cannot destroy
a signed contract.
**Guard:** the declared type is checked against the file cheaply before filing — the real error is the
right slot with the wrong file, not an unknown file. Slice 3.3.
**Note:** admin upload is the first intake path and never the only one. Bulk ingestion (slice 3.4) and
the convention-proposes-human-confirms rule (A10) are **deferred, not deleted**; they become
meaningful when volume arrives at step 4 of the method.

**What 3.3 built, and the one thing it did not** ([SPEC-evidence.md](SPEC-evidence.md), "Filing a
document"). The screen asks for the unit, the type and the file, and offers the lettings that unit
already has so the document can be bound to one. Every declared marker term of the type must appear
in the file's text; a file with no text layer is filed as `unverified` rather than refused, because
OCR is slice 4.1's. A refused upload writes nothing — no row, no object — and is recorded as an
`audit_log` line instead of as a `state`.

**Amended at 6.3: the unit is no longer the way in, it is one of two.** `GET /documents/new` with a
`unit` is this flow unchanged — reached from a building page, where the place is already known and the
shortcut costs nothing. The same path with **no** `unit` is **A12**, which reads the place off the
paper. Both end in the same `fileDocument` call against the same `UNIT` place, so everything below
this line — the guard, the refusal that writes nothing, the audit line, the bounds and the per-caller
cap — is true of both entries and is stated once.

**Declaring a *new draft* tenancy from the upload screen is A2's, not A1's.** Invariant 5 puts a human
confirmation between a proposed party and a written `tenancy_party` row, and `upsertParty` needs a
ת.ז. it can key on, so the "declared by the administrator" path 3.3 was planned with would have been
an unauthenticated form collecting a name and an identity number before a session existed — which
it does from 5.1, and every route is behind it from 5.2. A2
creates the draft from the lease it extracted, under the document that was already filed against the
unit — which is the sequence step 5 of that flow describes anyway.

### A2 — A lease establishes a tenancy

**Trigger:** A1 completes for a document of type lease.
**Sequence:** extract → propose → confirm → write.

1. Extraction reads the lease against `DocumentTypeField` for that type and returns what it found,
   including what it did not find.
2. The system proposes a **draft tenancy**: unit, start and end dates, and the tenants named on the
   lease. **A lease always carries at least one tenant and commonly two** — two signatories per
   household is the normal case, not an edge — and extraction must return all of them rather than the
   first.
3. **Guarantors are frequently absent from the lease itself** and are added later by addendum.
   Extraction returning zero guarantors is a correct result and produces no error.

   **Extraction also returns a declared identifier for each named person, where the lease prints one**
   (slice 6.4): `tenant_id_number` and `guarantor_id_number` are declared on the `lease` type, so a
   ת.ז. on the page is read and stored the way every other captured value is. **Zero identifiers is a
   correct result**, on exactly the standing a missing guarantor has above — an invented lease, an older
   form and a badly scanned page all produce it, and none of them is an error or a retry. The value is
   **withheld from every read path by default** and shown only to a role holding
   `party.national_id.read`, with an `audit_log` line per disclosure; it is not on this flow's confirm
   screen at all, and it has no `field_promotion` target, because it becomes `party.national_id` only
   when a human confirms a household. The exception this rests on is
   [ADR-0006](docs/decisions/ADR-0006-the-extractor-may-read-a-declared-identifier.md).
4. **Role is confirmed by a human before any `tenancy_party` row is written.** This is invariant 5
   applied where it matters most: `is_service_contact` is forced false for `GUARANTOR` by a database
   constraint, and the isolation join carries `AND tp.is_service_contact` as its fourth hop, so a role
   the model guessed wrong is an isolation defect and not a data-entry defect. The model proposes the
   role; the administrator accepts it.

   **Where that acceptance happens is the approval ledger, and that is a ruling of 15 Sep 2026.**
   Until this ruling the role was a select on a confirm screen that ran after the ledger. The
   director's objection is that it was a second way to say one thing: the role is not read off the
   page as a value of its own, it is carried by **which declared field the name was read into** —
   `tenant_name` is a tenant, `guarantor_name` is a `GUARANTOR` — and the operator has already looked
   at that row, seen the field it belongs to, and pressed approve on it. A control that re-asks is a
   second place to change one fact, and two places to change one fact is how they come to disagree.
   So: **the approval stamp on a name row is the human confirmation of that party's role**, and a
   name row with no stamp writes no party. Nothing about invariant 5 is loosened — a person still
   affirms before the row is written, and the affirmation is now attached to the evidence it is about
   rather than to a summary of it. The screen prints the role under the field name as text, and marks
   the guarantor as never a service contact, because that is the one distinction here with an
   isolation consequence.

   **What this does not settle, and the paint says so on the screen.** `PRIMARY_TENANT` versus
   `CO_TENANT` is a convention — the first name read is primary — and not a reading; a lease does not
   say which of two signatories is the principal. `OCCUPANT` has no declared field on a `lease` at
   all, so no lease produces one. Neither distinction reaches the isolation join, so neither gets a
   control; both are open for a later ruling.
5. Parties named on the lease are **created under the tenancy the document was uploaded to**, and
   **a name is never matched across tenancies**. **Closed at 5.5:** the generated portfolio held
   **2,871** identified parties and **0** with no identifier. Nameless same-name groups: **0**.
   Identified people sharing a full name: **303** names covering every generated person — the
   fixture's name pool, already keyed by `national_id_key`, not a person appearing twice without an
   identifier. Matching a name is a privacy decision; that count does not provoke a join.

   **Amended at 6.5: matching a *declared identifier* is the governed path, and it is the reason the
   rule above was written about names in the first place.** Where the lease printed a ת.ז. and step 3
   captured it, the party is written through `upsertParty`, whose natural key is `national_id_key` —
   so one person signing two leases in two flats is **one** party and two tenancies. Where the lease
   printed none, the party is written through `createParty`, always an insert, which is the case
   that command was added for (SPEC-parties.md). The 303 above is exactly why the two cases are
   separated rather than merged: a name is a guess and an identifier is a declaration.

   **The pairing of a name to an identifier is ordinal, and it is all-or-nothing within a field
   family.** The *i*-th `tenant_name` pairs with the *i*-th `tenant_id_number` in the document order
   the proposal already sorts by, **only when those two counts are equal**; unequal counts pair
   nobody in that family and every one of its people is written with no identifier. A
   half-succeeding rule would attach a household's ת.ז. to the wrong person, and the operator cannot
   catch it by looking, because step 3 keeps the value off this screen. **The two families are
   independent**, because step 3 above is the reason: a guarantor is frequently absent from the lease
   and frequently printed without an identifier when present, so one unpaired ערב must not throw away
   two correctly paired tenants — there is no pairing inside the guarantor family to have got wrong.
   **Two people on one lease resolving to the same identifier is a refusal**, not a role quietly
   overwritten on one party.
6. **Which letting — proposed, then confirmed.** The unit's lettings come from `listUnitTenancies`
   (every status, no day predicate, no party and no name) and are **ranked by identifier overlap
   first, then by the number of days the lease's own term overlaps theirs**. Overlap is a **count**:
   how many people already on that letting carry one of this lease's identifiers. No value, no key
   and no name leaves the query, and the screen shows the count and never a digit of an identifier.
   **The comparison is a read of `national_id_key` and writes an `audit_log` line** —
   `evidence.match_identifier`, naming who asked and how many probes matched, never the value. It is
   not a disclosure and is not `evidence.read_identifier`; nobody saw anything.

   **The default is *a new letting*, and an existing one is pre-selected only when this lease starts
   on the same day as one of them.** The same household renewing on new dates is a new letting, so
   identifier overlap ranks the list and never decides it. **A human picks**, and may pick any
   letting on the list or a new draft — invariant 5 unchanged.

   **Date overlap is computed outside SQL.** `start_date <= x AND end_date >= y` is the isolation
   join's tenancy predicate, which `src/scope/` alone may write (guard two); rephrasing it elsewhere
   to get past the guard is the move the guard exists to forbid. The list already carries both dates
   as text, so the arithmetic is ordinary code with its own cases.

   **This step is under a ruling of 15 Sep 2026 and is #110's to close.** The director's objection is
   that asking which existing letting a lease belongs to is backwards: a tenancy is *the deciding
   record of who is an active tenant in a flat*, and **a lease is what decides it**. A lease is not
   attached to a letting; it defines one. The prompt is therefore gone from the flow — there is no
   screen that opens with a list of candidate lettings and asks a person to choose. What the ruling
   does **not** settle is the narrower case the branch was built for, which is not a prompt but a
   conflict: a second lease arriving on a unit and a start date that unit already holds, which before
   6.5 was a dead end with nothing an operator could do. Either that stays as conflict resolution
   reached from the refusal, or it goes and the conflict becomes a refusal with a stated reason.
   **#110 decides, states the decision here, and does not leave both alive.** Until it does, the
   behaviour described above is what the code does and this paragraph is the warning that it is
   provisional.
7. The written tenancy is `DRAFT` and carries per-field provenance back to the lease.

   **The confirm signs the dates it promotes — slice 7.4.** From 7.4 a promotion requires an approval
   stamp on the reading (A15's verb, SPEC-evidence.md). This screen shows `תחילת השכירות` and
   `סיום השכירות` as read, so pressing the button *is* a person affirming those two readings: the
   confirm writes the approval for each date row it is about to promote, as read, with `confirmed_by`
   as the approver, and leaves alone any row already signed on the ledger. The alternative was to
   exempt this path from the rule, and since nearly every promotion in this system comes through it,
   that would have been a rule about nothing.

   **And it proposes what a person signed.** Where a date was corrected and approved on A15's ledger,
   that corrected value — not the raw reading — is what this screen proposes, what the letting
   arithmetic in step 6 compares, and what `upsertTenancy` writes. The raw reading stays on the
   evidence row, as it always does.
8. **Attaching to an existing letting is A2's branch from 6.5, and it writes no dates.** Before 6.5
   this flow could only create, and a second lease on a unit and start date it already held died on
   a conflict with nothing a human could do about it. Confirming an attach writes the document's
   `TENANCY` link and the confirmed `tenancy_party` rows, and touches **neither `start_date` nor
   `end_date` nor `status` nor `terms_profile_id`** — a lease filed against the wrong letting must
   not be able to rewrite that letting's term. Moving a captured value onto a column is per-field
   promotion from the read overlay, deliberate and one field at a time, which is what "A1 plus
   per-field promotion" meant. Confirm recomputes from captured fields; a second confirm is a no-op,
   on both branches.

**Cross-check:** the address and apartment number extracted from the document are asserted against the
unit the tenancy hangs on. This catches the error the type guard cannot — the right kind of document
filed against the wrong apartment. A mismatch writes no tenancy and no party.

### A3 — An addendum completes a tenancy

**Trigger:** A1 completes for a document of type lease-addendum, whether it arrives with the lease or
months afterwards.
**Sequence:** identical to A2's, with no special case, because of invariant 2. The addendum
contributes values to the tenancy's fields and each carries its own provenance.
**Effects:** a guarantor named in an addendum becomes a `tenancy_party` under the existing tenancy and
the tenancy's completeness state is re-evaluated. Where an addendum supplies a value the lease already
set, **the later document wins and the earlier value is retained**, visibly, because both provenances
are recorded. **A3's confirm signs `new_end_date` before promoting it**, on A2's step 7 argument and
for the same reason: the screen shows `מועד סיום מעודכן` and the button is the person affirming it.

### A4 — Resolve an incomplete tenancy

**Trigger:** a tenancy fails a completeness rule.
**The rule this flow exists for:** *a tenancy must have at least one guarantor.* It is a **policy
case, written red first**, evaluated over saved rows — never a column constraint, or the addendum in
A3 could never land. Zero guarantors remains a legal insert.
**The query, not a status.** Completeness is derived on each load. The first rule id is `guarantor`.
A tenancy is incomplete when it is `DRAFT` or `ACTIVE`, it has a `document_link` of
`entity_type = 'TENANCY'` (the paper path A2/A3 writes; register lettings with no such link stay
off the queue), it has zero `tenancy_party` rows with `role = 'GUARANTOR'`, and it has no exception
row for that rule. What is missing is the rule id; the Hebrew on the screen is ערב. A second
rule later is another predicate on the same query — not a column on `tenancy`.
**Exception:** a row in `tenancy_completeness_exception`, keyed `(tenancy_id, rule)`. Recording it
clears the queue the way an addendum that writes a `GUARANTOR` does. A second record of the same
pair is a no-op. It is not `tenancy.complete`.
**Screen:** `GET /estate/incomplete` — each row shows what is missing and the TENANCY-linked
document it was expected in (a `lease` type wins when both a lease and an addendum are linked).
No party names — a rule 5.2 kept rather than lifted when it put the screen behind a session, and 5.4
kept again.
**Resolution:** the administrator uploads the addendum (A3), or records the exception. The exception
row's `actor` is the signed-in operator (slice 5.4), not a typed name and not the word `console`.
**Module:** tenancy owns the query and the exception write (`listIncompleteTenancies`,
`recordCompletenessException`); the case lives in `tests/policy/` until the policy week stands up
`src/policy/`; estate owns the queue screen, with those commands injected at the composition root
so estate does not import tenancy.

### A5 — A person activates a draft tenancy

**Trigger:** an administrator invokes a command that says this letting is live. **Nothing activates
on a clock.** A fully-approved tenancy whose lease starts in the future sits as a `DRAFT`; the gate
reports the date it becomes activatable. Expiry remains clock-driven (`expireDueTenancies`): an
`ACTIVE` row whose `end_date` is already before today becomes `ENDED`. Only the human act is
activation.

**The gate, not a status column.** One function returns **every requirement it checked, passes
included**, so a screen, a queue and a test all read the same answer. The required documents are one
stated constant, and adding a third is a one-line change:

```
REQUIRED_FOR_ACTIVATION = ['lease', 'handover_protocol']
```

A tenancy becomes `ACTIVE` only when a person invokes the command and all four facts hold: an
approved lease on the letting; an approved handover protocol on the letting; today is not before the
lease's start date; today is not after its end date. The lease is the only document that defines
those dates (`tenancy.start_date` / `tenancy.end_date`). Each refusal names its own reason. A
handover protocol is **per letting**: it records that the tenant accepted the flat after inspecting
it, and it is bound with `entity_type = 'TENANCY'`.

**Screen:** `GET /estate/tenancies/:tenancyId` — one letting, reached by its identifier. Title
(tenant name plus address and apartment number), status, the lease's dates, the documents it holds,
what is missing, every gate check with its outcome, and the activate button. The page prints the
gate's returned facts and re-derives none of the rules. The button is dark until `canActivate`; a
dark button names every requirement the gate checked. When the only miss is the start date, the
page states `activatableOn`. `POST /estate/tenancies/:tenancyId/activate` is the person command
(`tenancy.write`); the clock never posts it.

**Writes:** `DRAFT → ACTIVE`, and a `TenancyEvent` of kind `activated` naming who and when. No
document on that event — the paper is already on the letting; the event records the human act.
**Enforcement:** the gate first, then `one_active_tenancy_per_unit`. Promoting a draft that still
overlaps a live tenancy is rejected by the database.
**Effect on the agent:** the incoming household resolves through the isolation join from that day
and not before.

**After activation.** An expired tenancy is `ENDED` and is not reopened — the clock does not
activate anything, and `activateTenancy` will not move an `ENDED` row. A required document whose
`valid_to` has passed raises a **flag** and never moves `tenancy.status` — the status keeps
meaning what it says while the lapse stays visible. Gate misses joining the incomplete-tenancy
queue are #108's, not this flow's.

### T1 — A tenant asks a question

**Trigger:** an inbound message on the agent channel. **Week 9**, sketched here because A1–A5 exist to
make it answerable.
**First act, before any model call:** the five-hop isolation join resolves the number to exactly one
unit, or to nothing. A guarantor resolves to nothing. A person whose tenancy has not started resolves
to nothing.
**Open, and owed before week 9:** whether the notice to data subjects is delivered on first contact
through this channel. If it is, this flow gains a step, and that must be known in advance rather than
discovered during the build ([docs/fuses.md](docs/fuses.md), F6).

### S1 — A portfolio question

**Trigger:** staff or owner asks something spanning units — which leases end in the next sixty days,
which tenancies are incomplete, where is the lease for unit 14.
**Reads only.** No writes, no model decisions.
**Note:** these are the questions that justify indexes. Q5's index is decided at real row count with a
timing in front of it (slice 2.6), not assumed.

### A6 — A handover protocol seeds the asset register

**Trigger:** A1 completes for a document of type `handover_protocol` or
`building_handover_protocol`.
**Sequence:** read → propose → confirm → write.

There are two protocols, because there are two handovers, and they are not the same act:

- **`handover_protocol`** is operator to tenant — `פרוטוקול מסירת דירה`. It dates the flat
  (`unit.warranty_end_date`, R14's override) and seeds the appliances of that `UNIT` space.
- **`building_handover_protocol`** is developer to operator — `פרוטוקול מסירת בניין`. It dates the
  building (`building.handover_date` and `building.warranty_end_date`) and is what discharges week
  2's placeholder מסירה dates. Building-level assets land on a `COMMON` space of that building when
  one exists; a register-imported building has only `UNIT` spaces, so the date correction still
  runs and the assets wait.

Both types are catalogue rows. The second was added at 3.5 as the tenth seed, through the same
function `npm run seed:doctypes` calls, which is A8's open half used for real.

1. A deterministic reader runs over the text `documentText` already produces. No model, no OCR, no
   `ExtractedField`. It proposes a handover date, an apartment number (unit-level only), and the
   appliances whose Hebrew names appear in the file, mapped onto the governed `asset_type` list.
2. **The administrator confirms before anything is written to estate.** `handover_date` drives
   `warranty_end_date` drives the ternary responsibility answer, which is invariant 5 applied to a
   date rather than a role.
3. **Nothing is held between propose and confirm.** The document is immutable and the reader is a
   pure function, so the confirm page recomputes the proposal from the stored bytes. A staging
   table would be a second copy of a fact the document already is. A2's model-based proposals still
   owe their own answer; this is the deterministic case only.
4. Each written asset carries `source_document_id` (R12). Confirming the same document twice is a
   no-op on the assets and a re-statement of the dates.
5. תקופת הבדק is two calendar years from the confirmed handover date, matching the fixture the
   screens have shown since 1.11.

**Module:** evidence owns the reader and the confirm screen; estate owns the writes, because Asset
is estate's table and a document module that updated `building.handover_date` would be writing
through the wall.

### A11 — An administrator creates a building

**Trigger:** a building enters the portfolio before any of its paper does — a tender is won, a
handover is scheduled, an address exists and nothing else about it is known yet.

**Why it is a flow at all, and why it is written down at 6.1 and not at 1.11.** Every building in
this system arrived through `npm run import:register` or through a committed fixture. That was
correct while the substrate was mock data by design ([docs/pipeline.md](docs/pipeline.md) principle
5), and it stopped being correct the moment the console had to serve an operations team: an import
is a file somebody prepares, and **there was no way for anybody to create a building**. The director
paused the rollout on 13 Sep 2026 to check the foundation was on its way to the flows that matter,
and this absence is half of what they found. A11 is the correction; A12 is the other half.

**Screen:** name, street and number, city, an optional project, the handover date, the end of
תקופת הבדק, and a status. Nothing else — a building is created **empty**, with no spaces and no
units, and **A13**'s apartment screen is what fills it.

> This sentence said *A12's apartment screen* when 6.1 wrote it, and A12 is the document-first
> intake in both [archive/tasks-w1-7/roadmap.md](archive/tasks-w1-7/roadmap.md) and [archive/tasks-w1-7/todo.md](archive/tasks-w1-7/todo.md), where the
> number was assigned before either flow was written. Corrected at 6.2 in favour of the two planning
> files rather than against them: the apartment screen is **A13**. A flow number is an identifier
> and not a sequence — A7–A10 are deferred and A11 was already out of order.

**Writes:** one `building` row, and the `project` row it names if it names one. **Through
`importEstate` with a one-building plan, zero spaces and zero units.** No new estate command: the
importer is already the one place a building is written, it already validates a plan at the edge,
and a second write path would be the second copy of the natural keys that
[SPEC-estate.md](SPEC-estate.md) exists to prevent. `validateBuildingSpaces` accepts empty `spaces`
and `units` without a special case, because it iterates them.

**The permission is `estate.write`, and it is ADMIN only.** This is the division the console has
had since 5.1 without a name for it: **an operator files paper, an admin shapes the estate.** Filing
a lease against a flat that exists is `documents.write` and is an operator's ordinary day; deciding
that a flat exists is a different act, it is upstream of every isolation question the building will
ever answer, and it belongs to the same role that edits the catalogues (`settings.write`).

**Re-posting an address is an update, never a second building.** `building.address_key` is
`UNIQUE` and generated from `city` and `address_line` with casing and whitespace normalised
([SPEC-estate.md](SPEC-estate.md)), and the importer's `ON CONFLICT … DO UPDATE` returns the id
already there. So a double submit, a back-button re-post and a typo corrected on a second attempt
all converge on one row, and **the screen enforces nothing** — the guarantee is the schema's, which
is where it survives a second writer.

**A project is chosen, not invented.** The form offers the projects that exist plus *no project*
(R15's ordinary case). `validatePlan` requires a building's `projectCode` to name a project the plan
carries, so the plan is rebuilt from the selected row's own values and the upsert rewrites the
project as itself. A free-text tender code would rename an existing project on a typo, silently,
because `project.project_code` is the natural key and `DO UPDATE` is what makes an import idempotent.
Creating a project earns its own slice on the day somebody needs one.

**What A11 does not do.** It writes no space, no unit, no asset and no date onto anything but the
building it creates. `building.handover_date` and `warranty_end_date` are entered here and are
**superseded by A6** when the building handover protocol arrives: A6 reads them off the paper and
this screen is the placeholder standing until it does — the same standing week 2's imported מסירה
dates have.

**A11 is also reached from A12's refusal, prefilled. Slice 6.9.** An operator holding a lease for an
address in nobody's portfolio used to be told only that it could not be placed. From 6.9 the refusal
offers this screen to a role holding `estate.write`, with the street, the number and the town the
place reader read already in the fields. **Prefill is a default in an input and never a write:** the
admin reads it against the paper in their hand, edits whatever is wrong, and posts the same form with
the same validation — this flow's writes and its idempotence are untouched, and a reading that was
wrong costs a correction rather than a building. The form carries the flat number and the document
type it was opened with, so A13 and then A12 can be reached without the operator retyping an address;
what A11 returns to is [A13](#a13--an-administrator-adds-an-apartment), because a building with no
flats is not yet somewhere a lease can be filed.

### A13 — An administrator adds an apartment

**Trigger:** a building exists and a flat in it does not. A11 creates a building empty, so this is
the flow that makes it a building with apartments in it; it is also the path for the flat a register
import never carried, because the export was taken before the unit was split or sold.

**Screen:** reached from the building page, so **the building is the URL and is never typed**. It
asks for the unit number, the floor, the rooms, the area, whether there is a ממ״ד, the condition,
and an optional end of תקופת הבדק for the flat itself (R14, when a unit was handed over separately).
Nothing about the building appears on it, because nothing about the building is this screen's to
change.

**Writes:** one `UNIT` space, one `unit` row, and **the two bays the apartment implies** — a
`PARKING` space `חניה {unit_number}` and a `STORAGE` space `מחסן {unit_number}`, assigned on the
unit. That is slice 4.6's convention and this flow does not invent a second one: the bays are
placeholders with a name and no facts, so a handover protocol has a space to land a gate motor on
([SPEC-estate.md](SPEC-estate.md)). Three spaces and one unit, for one apartment.

**Through `upsertUnitRow`, and there is no new estate command.** That function is the register's own
per-row primitive (slice 2.4), and it already does exactly these four upserts in exactly this order.
A screen that wrote its own SQL would be the second copy of the natural keys
[SPEC-estate.md](SPEC-estate.md) exists to prevent — and the first thing it would drift on is the
name of the `UNIT` space.

**The `UNIT` space is named by the bare `unit_number`, because that is what the register names it.**
`space` is keyed `(building_id, space_kind, name)`, so the screen and the bulk importer converge on
one row for one flat only while they spell that name identically. `דירה 12A` from a form and `12A`
from a CSV are two apartments behind one door, and the first thing that would notice is a lease
filed against whichever of them the operator did not click.

**The building is rebuilt from its own row, exactly as A11 rebuilds the project from the project's.**
`upsertUnitRow` upserts the building it is handed, and `ON CONFLICT (address_key) DO UPDATE` sets
`project_id = EXCLUDED.project_id` — so a screen that posted a building with no project code would
**silently unlink the building from its project** as a side effect of adding an apartment. The route
reads the building it was given an id for and hands back that row's own name, address, city, project
code, dates and status. The upsert rewrites the building as itself.

**Re-posting a unit number updates the flat, never a second one.** R2 makes a unit's identity its
space's, so the space's natural key is the whole of it. A corrected floor or a corrected area is
`DO UPDATE` doing what it is there for.

**The permission is `estate.write` and it carries on the `GET` too**, for the reason A11 states: a
form an operator may render and may not post teaches them nothing, because the refusal says
`not_allowed` and nothing more.

**Bulk stays `npm run import:register`.** A register is a file somebody prepares and a screen is one
flat at a time; the two paths share the primitive and do not share an entry point. No second bulk
path is built here.

**What A13 does not do.** No asset, no tenancy, no document, and nothing to the building but the
rewrite of its own values. The occupancy chip on the new flat reads פנויה because occupancy is
derived from tenancy dates and there are none (R6).

**A13 is also reached from A12's refusal, prefilled, and it is the more common of the two. Slice
6.9.** The reader finds the building far more often than it finds the flat — a lease naming an
address this system holds and an apartment number it does not is a building match with no unit in it
— so the refusal offers **the flat alone** in that case and the building form only when the address
matched no building at all. The unit number the reader read is a default in the input, on A11's
terms: editable, validated by the same `unitFromForm`, and idempotent on `space_natural_key` whatever
it is corrected to. When this screen was opened from A12 it returns there with the new flat as the
document's anchor, which is the only thing A12 was missing.

### A12 — A document finds its own place

**Trigger:** an operator holds a file and knows what it is, and does not know — or does not want to
have to go and find — which of 1,500 flats it belongs to.

**Why it is a flow at all, and why it is written down at 6.3.** A1 has asked for the unit first since
3.3, and the unit was in the URL because the screen was reached from a building page. That was
correct while every document arrived beside a flat somebody was already looking at, and it stopped
being correct the moment the console had to serve an operations team: paper arrives in a pile, and
**the address is printed on it**. This is the other half of what the director found on 13 Sep 2026;
A11 is the first half. A1 is amended rather than replaced — the unit-first entry stays.

**Screen:** choose the type, attach the file. **No unit.** The type is still declared and never
detected (invariant 6): what this flow reads off the paper is *where*, not *what*.

**And it has a door in the rail. Slice 6.9.** From 6.3 to 6.9 this flow's only entrance was one card
on the index, so the only way to reach it from anywhere else was to go back to the root — and the
week-6 demo, walking from a building page, never saw it: six posts through A1's unit-first door and
none through this one, for a flow that had been working for two hours. A destination in
`src/chrome.ts` is therefore part of the flow and not decoration. **It is shown to a role holding
`documents.write`** and to nobody else, for A11's reason: the screen behind it refuses a VIEWER.

**Sequence:** read → resolve → file.

1. The bytes are read once, in memory, under the bounds A1 already set — one file, 20 MB, four kinds
   sniffed from the bytes. The text is `documentText` over the pdf reader, and **OCR whenever that
   text does not satisfy the declared type's terms** and an OCR processor is configured (slice 6.8;
   until then it was *no text layer at all*, and a phone scanner's own layer therefore outranked
   Document AI). A file too long for the online call is refused with a sentence that says so.
2. **A deterministic place reader** runs over that text — the analogue of A6's protocol reader, and
   deliberately the same kind of thing: no model, no `ExtractedField`, a pure function over a string.
   It returns an address, a city and an apartment number, or nulls.
3. **Resolution is exact or it is a question.** `building.address_key` — the generated, normalised key
   A11 leans on — is looked up for the city and street the reader read; the apartment number then
   narrows that building's units through the same `apartmentMatches` fold A2 uses for its cross-check.
   **Exactly one unit** and the document is filed against it, through the unchanged `fileDocument`, and
   the chain continues into A1 and A2 exactly as it does when a human picked the flat.
4. **Zero or several is a refusal, and the refusal writes nothing** — no `document` row, no
   `document_link`, no object. The form comes back with what was read, the candidates a
   `searchEstate`-shaped lookup found, a search box, and the file input re-armed. Picking a candidate
   and re-attaching the file is the second post, and it files against the unit that was chosen.
5. **The filing says what it read and where it landed.** A12 places a document without anybody
   choosing a flat, so the receipt is the only place an operator can check that it chose the right
   one: it names the address, the town and the apartment number the reader read, and the flat the
   document was anchored to. A verified lease redirects past that receipt into A2, which is why A2's
   confirm screen carries the same account of what was read — see *A refusal has four causes* below.

**A12 may create, and that is a ruling of 14 Sep 2026.** This section said, from 6.3 until 6.9, that
A12 *does not create a building or a unit: an address that is in nobody's portfolio is a refusal with
a search box, and creating the building is A11's act and an admin's.* The week-6 demo is what struck
it: the second half of that sentence is still true and the first half was a dead end, because the
operator standing at the refusal with the right paper in their hand had nowhere to go. **Creating is
still A11's act and an admin's — it is now offered from here.**

**The role split is the whole of it.** `estate.write` is ADMIN-only (A11) and `documents.write` is an
operator's ordinary day, so the same refusal is two screens: an **ADMIN** is offered the building and
the flat, prefilled from the reading; an **OPERATOR** is offered the candidate list and the search
box and no create control at all. A door an operator may see and may not walk through is the
refusal-after-typing A11 refused to build, and this flow does not build one either. What is offered
depends on what was matched: the **flat alone** when the address found a building, the **building and
then the flat** when it found none.

**A refusal has four causes and gets four sentences. Slice 6.9, raised by 6.11.** One sentence per
cause, because the four ask the operator for four different things:

- **nothing was read** — no address on the page the reader could reach. Attach a different scan, or
  choose the flat by hand.
- **the document defers to an annex** — the body says `כמפורט בנספח` and identifies the property by
  `גוש`/`חלקה`. **This is a correct answer and not a failure** ([SPEC-evidence.md](SPEC-evidence.md)
  says why the annex is not chased); until 6.9 it read as *no address was read*, which sent people
  looking for a broken reader.
- **the address is in nobody's portfolio** — read, resolved against nothing. This is the create
  offer's case.
- **several flats answer** — the address matched and the apartment number did not narrow it to one.

**And it says which field it read, not only which it did not.** A reading can be half right: 6.11
left an apartment number that is still read from anywhere in the text, so a lease naming only a
party's own flat returns a number with no address. Printing *דירה 12A* beside *no address was read*
without saying where that number may have come from is how a refusal talks an operator into the
wrong flat.

**Only an exact key match files without a human.** A near match is not a weaker version of a match
here: this application cannot delete what it writes (slice 3.2), so a document filed against the
wrong flat is permanent, and the cost of asking is one click. The reader is therefore allowed to
fail — it fails into the candidate list, which is a screen an operator can act on, and never into a
guess.

**Nothing is held between the read and the file.** There is no staging store, no `UNFILED` place kind
and no fifth `PlaceKind`: the object path names a real place (slice 3.2) and A6 already settled the
principle for the deterministic case. The price is that a refused intake asks for the file again,
which is the same price A1's wrong-file refusal has always charged.

**What A12 does not do.** It does not classify — the type is declared. It does not propose a tenancy;
a filed lease with no tenancy link still redirects into A2, which is where a human confirms. **And it
holds nothing while an admin creates a place for it:** the create offer is a link out of the refusal
and back, and the file is attached again on the return, because a browser's file input cannot be
refilled and a staging store is what 3.2, A6 and the director's ruling of 14 Sep all refuse. The
price is the one A12 has always charged — attach the file a second time — and it is the same price a
candidate chosen off the list charges.

### A14 — An administrator declares a field

**Trigger:** the system is asked to read something off a page that it does not currently look for —
a city on its own, a clause the office has started to care about, a field somebody mis-declared and
has to correct.

**Why it is a flow at all.** Foundation rule 8 says a document type is a row and a field is a row,
and that new ones cost no migration and no deploy. Half of it has been true since 3.1: a **type** is
a row, edited at `/settings` under `settings.write`. The other half has never been true. A **field**
has cost `src/evidence/fixtures/document-types.ts`, a commit, a review and a
`npm run seed:doctypes` — a deploy wearing a seed's clothes, run three times (3.1, 3.5, 6.4) by
somebody editing source code to say what a reader should look for. A8's open half was open on one
side only, and this flow closes it.

1. **The administrator opens `/documents`** and picks a type. The screen already shows the
   declaration governing today (slice 7.1): key, label, value type, required, hint, version.
2. **They declare a field, or correct one, or retire one.** `POST /documents/types/:typeKey/fields`,
   under `settings.write` — **ADMIN only**, the same hand that has held the `DocumentType` catalogue
   since 5.8. No new permission: a permission with one reader adds vocabulary without adding a
   boundary, and the role matrix stays code (SPEC-staff.md).
3. **A correction is a new row and never an edit.** R18. In one transaction the live row is closed
   at the day *before* today and the new declaration opens today, so a value extracted last month
   still points at the row that governed it and that row still says what it said. **Declaring the
   same field twice in one day is a conflict**, not a second correction: the declaration being
   superseded has governed no extraction on any other day, so there is nothing to supersede.
4. **Retiring a field closes the row and inserts nothing.** The catalogue's rule is deactivate,
   never delete (A9), and a field is no different — `extracted_field` rows point at the closed
   declaration and stay explicable by it.
5. **A money field is an ordinary field**, from 15 Sep 2026. The editor refused a declaration whose
   key or label carried a money vocabulary until foundation rule 2 was retired
   ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)); that guard is deleted and
   nothing replaces it, so `rent_amount` as `NUMBER` is declared, versioned, audited and refused by
   nothing. There is still no `MONEY` value type, because an amount is a `NUMBER` beside a `TEXT`
   currency and does not need one.

**What A14 does not do.** It does not touch `verification_terms` — what proves *that this is a
lease* stays in the type row under A9's editor and under the policy suite, while what is read *after*
the document has been proved is what opens here. **Refusal stays deterministic; extraction becomes
configurable**, which is the boundary the paint's second ruling drew. It does not promote anything:
a declared field is a capture target and never a typed column (foundation rule 8, invariant 3).

**Module:** evidence owns the command, the route and the screen. Staff owns the permission and
decides nothing else.

### A15 — An operator approves what was read

**Trigger:** a document has been filed, proved to be the type it was declared as, and read. Rows
exist in `extracted_field`. Nobody has yet said whether any of them is right.

**Why it is a flow at all.** Since 4.2 a value has arrived and stayed exactly as the reader left it.
The only stamp in the system is 4.3's **promotion**, which means something else — *this is now
business truth on a typed column* — and reaches two targets. Four of the lease's eight declared
fields have nowhere to be promoted to and were therefore unattestable: capturable, listed,
searchable, and with no way for a person to say *yes, that is what the page says*. A15 splits the
verb. **Approving is a stamp on the evidence row; promoting is still the copy onto a typed column.**

1. **The operator opens `/documents/:id/fields`** — the ledger. One row per captured value: the
   declared field, the value as read, the read quality, and the action. Declarations the reader
   found nothing for appear too, as rows saying so, because *the lease names no guarantor* and *the
   reader missed the guarantor* look identical on a screen that shows only what was found. The
   declarations shown are the ones governing the **day the extraction ran**, never today's: a field
   declared this morning is not something last month's lease failed to carry.
2. **They approve a row, or they correct it and approve it.** `POST /documents/:id/fields/approve`,
   under `documents.write`. `approved_value` is written either way — equal to `value` when the reader
   was right — and **`value` is never overwritten**. The difference between the two columns is the
   per-field accuracy dataset, and a single column would destroy it on the first correction.
3. **A second approval of the same row is refused.** `conflict`. An approval is a person's signature
   at a moment, not a field that can be edited; changing one is not in this flow and has no screen.
4. **One control approves the rest — `אישור כל מה שלא סומן`, never approve-all.** Rows below the
   read-quality threshold, rows with no read quality at all, and **every identifier row at every
   stance** are flagged, sorted to the top, and must be touched individually. On a fourteen-page
   lease with most rows above 90%, approve-all would be a reflex within a week and the measurement
   would be worthless.
5. **A ת.ז. is masked, and revealing one is its own request.** `POST /documents/:id/fields/reveal`
   under `party.national_id.read` — ADMIN — writes `evidence.read_identifier` for that row and
   renders the page with the value shown. A viewer without the permission never receives the value at
   all (6.4: withheld, not hidden), and **may not approve the row either**: approving is an
   attestation, and a stamp from somebody who was never shown the value is a false record in the one
   dataset this flow exists to produce. A viewer who *may* read one still has to ask: the row is
   flagged for everybody, so a ת.ז. is revealed and signed on its own or not at all.

**What A15 does not do.** It does not promote — a promotion is still 4.3's command, and 7.4 ruled
that its targets stay the two dates. **What 7.4 did change is the direction of the dependency: a
promotion now requires the stamp this flow writes**, and copies `approved_value`. A2's and A3's
confirm screens write that stamp themselves for the dates they promote, so the operator who never
opens the ledger is still signing what the reader produced — on a screen that shows it. It does not create a row for a
declaration the reader found nothing for: an `extracted_field` with no page and no bbox is refused by
`0017`, and whether a hand-typed value is evidence at all is a ruling and not a button. It does not
change what the reader looks for — that is A14, one screen earlier.

**Module:** evidence owns the columns, the command, the routes and the screen. Staff owns the two
permissions and decides nothing else.

## Open

- **Which three to five document types open the concept work.** The catalogue seeds eight; the working
  set is smaller and is chosen by which ones a tenancy's fields actually depend on. Lease and
  lease-addendum are certain, given A2 and A3. The two handover protocols are A6's, landed at 3.5.
- **Where extraction proposals are held between propose and confirm.** A6 answered it for the
  deterministic case: recompute from stored bytes, no staging table. A2's model-based proposals
  still owe a staging shape that is not the live tenancy, since invariant 5 forbids writing an
  unconfirmed role.
- **The completeness vocabulary.** **Closed for the first rule at 4.8:** it is a derived query, rule
  id `guarantor`, exception a separate row. Materialised state waits until a second rule joins and
  the list of missing things is no longer one label.
- **Cross-tenancy party identity.** **Closed at 5.5, and settled the other half at 6.5.** A2 step 5
  stands where it was written: **no name match across tenancies**, and the count that provoked that
  ruling is in the step. What 6.5 added is the case 5.5 could not reach — a **declared** identifier,
  captured from the lease under 6.4's catalogue, keys `upsertParty` and makes one person in two flats
  one party. A matcher over names still waits on a nameless duplicate that this portfolio does not
  have, and 5.5's 303 shared full names say why it will keep waiting.
