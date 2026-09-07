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
   ([tasks/roadmap.md](tasks/roadmap.md), slice 3.1).
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

**Declaring a *new draft* tenancy from the upload screen is A2's, not A1's.** Invariant 5 puts a human
confirmation between a proposed party and a written `tenancy_party` row, and `upsertParty` needs a
ת.ז. it can key on, so the "declared by the administrator" path 3.3 was planned with would have been
an unauthenticated form collecting a name and an identity number before week 5's session exists. A2
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
4. **Role is confirmed by a human before any `tenancy_party` row is written.** This is invariant 5
   applied where it matters most: `is_service_contact` is forced false for `GUARANTOR` by a database
   constraint, and the isolation join carries `AND tp.is_service_contact` as its fourth hop, so a role
   the model guessed wrong is an isolation defect and not a data-entry defect. The model proposes the
   role; the administrator accepts it.
5. Parties named on the lease are **created under the tenancy the document was uploaded to.** No
   attempt is made to match a name against the global party register — cross-tenancy identity
   resolution is a month-two problem and a materially harder one.
6. The written tenancy is `DRAFT` and carries per-field provenance back to the lease.

**Cross-check:** the address and apartment number extracted from the document are asserted against the
unit the tenancy hangs on. This catches the error the type guard cannot — the right kind of document
filed against the wrong apartment. It needs extraction to exist, so it lands with comprehension rather
than with upload.

### A3 — An addendum completes a tenancy

**Trigger:** A1 completes for a document of type lease-addendum, whether it arrives with the lease or
months afterwards.
**Sequence:** identical to A2's, with no special case, because of invariant 2. The addendum
contributes values to the tenancy's fields and each carries its own provenance.
**Effects:** a guarantor named in an addendum becomes a `tenancy_party` under the existing tenancy and
the tenancy's completeness state is re-evaluated. Where an addendum supplies a value the lease already
set, **the later document wins and the earlier value is retained**, visibly, because both provenances
are recorded.

### A4 — Resolve an incomplete tenancy

**Trigger:** a tenancy fails a completeness rule.
**The rule this flow exists for:** *a tenancy must have at least one guarantor.* It is a **policy
case, written red first**, evaluated over saved rows — never a column constraint, or the addendum in
A3 could never land.
**Screen:** a queue of incomplete tenancies, each showing what is missing and the document it was
expected in.
**Resolution:** the administrator uploads the addendum (A3), or records the exception.
**Module:** policy owns the rule; the admin surface owns the queue.

### A5 — A draft tenancy becomes active

**Trigger:** the start date arrives, or the outgoing tenancy ends.
**Writes:** the outgoing tenancy moves to `ENDED` or `TERMINATED_EARLY`; the draft moves to `ACTIVE`.
**Enforcement:** the exclusion constraint. Promoting a draft that still overlaps a live tenancy is
rejected by the database, so ordering is not something the application has to remember to check.
**Effect on the agent:** the incoming household resolves through the isolation join from that day and
not before; the outgoing household stops resolving on the day their tenancy ends.

### T1 — A tenant asks a question

**Trigger:** an inbound message on the agent channel. **Week 9**, sketched here because A1–A5 exist to
make it answerable.
**First act, before any model call:** the five-hop isolation join resolves the number to exactly one
unit, or to nothing. A guarantor resolves to nothing. A person whose tenancy has not started resolves
to nothing.
**Open, and owed before week 9:** whether the notice to data subjects is delivered on first contact
through this channel. If it is, this flow gains a step, and that must be known in advance rather than
discovered during the build ([tasks/fuses.md](tasks/fuses.md), F6).

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

## Open

- **Which three to five document types open the concept work.** The catalogue seeds eight; the working
  set is smaller and is chosen by which ones a tenancy's fields actually depend on. Lease and
  lease-addendum are certain, given A2 and A3. The two handover protocols are A6's, landed at 3.5.
- **Where extraction proposals are held between propose and confirm.** A6 answered it for the
  deterministic case: recompute from stored bytes, no staging table. A2's model-based proposals
  still owe a staging shape that is not the live tenancy, since invariant 5 forbids writing an
  unconfirmed role.
- **The completeness vocabulary.** A4 needs to say *what* is missing, and that list is the set of
  policy cases over tenancy, which grows. Whether it is a derived view or a materialised state is
  decided when the second rule joins the guarantor rule.
- **Cross-tenancy party identity.** Deliberately absent from A2 step 5. Month two.
