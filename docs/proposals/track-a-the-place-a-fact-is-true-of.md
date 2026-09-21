# Proposal: Track A — the place a fact is true of

**Status: DRAFT, 2026-09-22. NOT ADOPTED.** This file is written to be grilled, not to be
implemented. It proposes no work until the director has been through it and the open questions at the
end have answers. Where it and a SPEC file could be read as disagreeing today, the SPEC file wins —
nothing here has been adopted into one yet.

**Date:** 2026-09-22
**Supersedes nothing. Would amend on adoption:** `SPEC-estate.md` (the tables, *What is deliberately
not a column*, the A13 unit screen, *Open*), `SPEC-evidence.md` (*Seeding the catalogue*, the
promotion target list under *FieldPromotion*), `SPEC-flows.md` (A11, A13), `CONTEXT.md` (two glossary
entries, if §3 is accepted).

---

## Why this exists

Track A was named on 21 September 2026, in one clause, inside the out-of-scope section of another
proposal: *"Track A (the Building declaration, and pre-created spaces)"*
([docs/proposals/track-b-intake-and-promotion.md](track-b-intake-and-promotion.md), §Out of scope).
It is mentioned three more times, every one of them a disclaimer saying it is not being addressed
here. It has no proposal, no spec section, no issue and no parent. Track B had a full draft before a
line of its code was written; track A has nine words.

That is not a criticism of the clause. It was written to keep `gush` and `helka` off the lease type,
and it succeeded. But it named the track after the first two facts anyone noticed, and reading the
residual now — after track B closed and took fourteen declarations with it — the shape underneath is
different from and larger than what the clause describes.

**This proposal exists because the evidence arrived after the name did.** Everything below is
derived from the two hand-read specimens in `evals/fixtures/lease-extraction.ts` and from what track
B actually built, not from the clause.

Two documents remains a thin sample, and this draft keeps track B's bias throughout: a seed row
rather than a migration, a derived value rather than a column, a cross-check rather than a capture.
It proposes **two** new columns in total, and argues against three more that look obvious.

---

## 1. What the residual says

`evals/fixtures/lease-extraction.ts` records 57 hand-keyed values across two leases. At #127's
baseline, 31 of them were scored by nothing, because the catalogue did not declare their keys and the
mapping schema enumerates declared keys. Track B's seed rows closed fourteen.

**Seventeen values across twelve keys are still undeclared. Fourteen of them are this track.**

| Group | Keys | Values |
|---|---|---|
| Facts about the **building** | `gush`, `helka`, `building_number` | 4 |
| Facts about the **unit or its space** | `rooms`, `floor`, `apartment_type`, `has_storage`, `storage_space_number` | 10 |
| **Not a fact about a place at all** | `parking_space_number` | 2 |
| Not this track | `security_structure`, `index_base_month`, `index_publication_date` | 3 |

The residual is not scattered leftovers. It is one coherent body of work that two specimens have
already evidenced end to end, and it is the last thing standing between the fixture and a fully
gradable reading. That is the argument for doing track A next, and it is a stronger argument than the
one available when the track was named.

The three in the last row are called out here so nobody folds them in. `security_structure` is a
different `document_type` bound into the same PDF, sharing one `file_hash`, which `document` cannot
represent — a real defect, and not a place fact. `index_base_month` and `index_publication_date` are
indexation terms of the letting; they belong beside rent, which is track B's furniture. Neither is
proposed here.

---

## 2. It is three levels, not one

**Belongs in:** `SPEC-estate.md`, new subsection under *The shape, and why it is this one*.

"The Building declaration" names one level. The residual sits on three, and the distinction is the
whole content of this track, because **the defect track A exists to prevent is a fact stored at the
level it was printed at rather than the level it is true of** — which is exactly the reasoning that
kept `gush` off the lease type in the first place, applied one turn further.

- **`gush`, `helka`** are true of the **building** — strictly, of the land it stands on. They change
  effectively never, they are identical for every flat in the building, and both specimens print
  them because Israeli lease boilerplate identifies the property that way.
- **`building_number`** is true of the **building**, and is not its name. `building.name` today holds
  free text — the register fixture generates `בניין הרצל 8`, an address-derived name
  ([src/register/fixtures/generate.ts:380](../../src/register/fixtures/generate.ts:380)). The
  specimens print `בניין מס' 206`, where 206 is the building's number **within the Beit Shemesh
  project**. A project with numbered buildings has a fact that `name` is not carrying.
- **`rooms`, `floor`, `apartment_type`** are true of the **unit or its space**, and two of the three
  already have columns: `unit.rooms` (`numeric NOT NULL`) and `space.floor` (`text`, nullable —
  correctly, since ground, basement and roof are not numbers).
- **`has_storage`, `storage_space_number`** are true of the unit's **relationship to a space**, which
  is `unit.storage_space_id` and already exists.
- **`parking_space_number`** is true of **none of those**. §3.

A declaration that puts `rooms` on the lease type, extracts it, and promotes it onto `unit.rooms` is
doing something defensible. A declaration that puts `gush` there is doing the thing track B refused.
The line between them is not obvious from the document — both are printed in the same paragraph on
the same page — and this proposal's first job is to draw it somewhere a later reader can find.

**The proposed rule.** A fact is declared on the document type that *establishes* it, and
cross-checked from every other type that merely *recites* it. A lease recites `gush`. It establishes
nothing about the land. §8 is what follows from that rule and is the open question of this draft.

---

## 3. The bay is not the flat's, and the schema says it is

**Belongs in:** `SPEC-estate.md`, amending the `unit` table commentary and D3; possibly
`SPEC-tenancy.md`.

This is the most substantive finding in the residual, and nothing in the repo currently names it.

`unit.parking_space_id` puts the bay on the **flat**, by a foreign key deliberately built to make a
bay a `Space` of kind `PARKING` so it can hold a gate motor and receive service calls
([src/kernel/migrations/0004_estate.sql](../../src/kernel/migrations/0004_estate.sql), D3). That
modelling is good and this proposal does not touch it.

The paper disagrees about who the bay belongs to. From the fixture's own note on
`parking_space_number` ([evals/fixtures/lease-extraction.ts:184](../../evals/fixtures/lease-extraction.ts:184)):

> Assigned to the tenancy and reassignable by the landlord at will — permanently, per the second
> starred clause on this page. **It is not a property of the flat.**

Both specimens carry that clause. So:

- **The schema says** flat 7 has bay 574.
- **The lease says** this *letting* has bay 574 for as long as the landlord does not move it, and
  moving it requires no amendment and no new document.

These are different claims, and today the second one has nowhere to live. Promoting
`parking_space_number` onto `unit.parking_space_id` would write a tenancy fact onto an estate row,
where it would outlive the tenancy that created it and be read by the next household's screen as a
property of their flat. That is the same class of error as `current_tenant` on a unit — foundation
rule 1, which this repo enforces with a grep guard over the migrations.

**Three ways out, and this draft does not choose between them.** This is question 2 in §10.

1. **The assignment is a tenancy fact.** A column or a `tenancy_event` on the letting, and
   `unit.parking_space_id` keeps meaning *the bay this flat was built with*, which is what the
   developer's plan says and what a service call needs.
2. **The assignment is the only truth and the unit column is wrong.** `unit.parking_space_id` becomes
   derived from the current letting, or is dropped. Cheapest to state, most expensive to live with: a
   vacant flat then has no bay, and the asset register loses the thing a gate motor hangs off.
3. **Both, explicitly.** The flat has a default bay; the letting may override it. Two facts, both
   true, one of them nullable.

Whichever is chosen, **`parking_space_number` must not be declared on the lease type until it is**,
because a declaration creates a capture, a capture invites a promotion, and there is currently no
correct target for it to land on.

---

## 4. Pre-created spaces are pre-created with names the paper does not use

**Belongs in:** `SPEC-estate.md`, *The second — `GET /estate/buildings/:buildingId/units/new`*.
**This is a live defect and should be a ticket regardless of what the rest of this proposal becomes.**

`upsertUnitRow` creates, for every unit the A13 screen makes, a `PARKING` space named
`חניה {unit_number}` and a `STORAGE` space named `מחסן {unit_number}`
([src/estate/internal/importer.ts:411](../../src/estate/internal/importer.ts:411)). The naming is the
function's own; the register importer passes explicit `parkingSpaceName` and `storageSpaceName` and
does not hit this path.

Against the two specimens, in the same building, in the same month:

| Flat | Placeholder created | The plan's actual bay | The plan's actual storage |
|---|---|---|---|
| 206-4 (`pinchot`) | `חניה 4`, `מחסן 4` | **594** | **unnumbered** — `מחסן צמוד מהמרפסת, כמסומן בתכניות` |
| 206-7 (`bloch`) | `חניה 7`, `מחסן 7` | **574** | **601** |

Three separate errors in one function:

1. **The names are wrong.** Bay numbering is a property of the plan and is unrelated to the door
   number. Nothing will ever reconcile `חניה 7` with bay 574 except a person noticing.
2. **The storage space is created unconditionally**, so `pinchot`'s flat gets a numbered storage room
   invented for a storage room that has no number, and any flat with no storage at all gets one
   anyway. `has_storage` in the fixture exists precisely because the two specimens disagree — the
   note on it calls the pair *"the whole argument for a boolean beside a nullable number rather than
   one number field"*.
3. **`space` is keyed `(building_id, space_kind, name)`**, and SPEC-estate already warns that two
   writers spelling a name two ways are two apartments behind one door. This function is the second
   writer, and it spells bay names in a scheme no document uses.

The defect is bounded — it affects units created through A13, not through the register import — and
it is silent, which is worse. It should be filed now and fixed independently of §§2–3, because it
corrupts data on every use and does not depend on any design question this proposal raises.

**What the fix probably is, and it is not "name them better".** The screen should either ask for the
bay and storage numbers, or create neither and let a later act create them with the numbers the plan
prints. Inventing a placeholder to satisfy a nullable foreign key is the root of it: `MATCH SIMPLE`
already leaves `parking_space_id` unenforced while null, and *unassigned* is described in the
migration itself as the ordinary state.

---

## 5. What needs a column, and what does not

**Belongs in:** `SPEC-estate.md`, *What is deliberately not a column*, extended.

This draft proposes **two** new columns and argues against three that look necessary.

**Two columns, on `building`:**

| Column | Type | Why |
|---|---|---|
| `gush` | `text` | Not an integer — it is an identifier, printed with no arithmetic ever done to it. |
| `helka` | `text` | **A list.** `pinchot` prints `חלקות 43, 46` — two parcels, one building — and the fixture's note records that the list *"is not ordered the same way on every page"*. An integer column is wrong on the first building we own. |

`helka` being a list is a genuine modelling question and question 3 in §10: `text` holding `43,46`,
or a `building_parcel` table. This draft proposes `text`, on the reversibility bias — a table is the
kind of thing that is cheap to add later and impossible to remove once written to, and nothing
deterministic reads a parcel today.

**Three that should not be columns:**

- **`has_storage`** — derive it. `unit.storage_space_id IS NOT NULL` already answers this exactly,
  and a stored boolean beside a nullable foreign key is two facts that can disagree. This is R6's own
  argument (`Building.unit_count` is counted, never stored) applied to a new candidate. The fixture's
  note asks for *"a boolean beside a nullable number"* — that is a correct description of the
  **reading**, and the reading is `extracted_field`, which already holds exactly that. It is not an
  argument for a column.
- **`building_number`** — probably not a column, probably a cross-check. See §8; it depends entirely
  on whether `building.name` is meant to be human-facing text or an identifier, which is question 4.
- **`apartment_type`** — `BG` on `pinchot`, `B1` on `bloch`. This is a **tender typology**: a
  developer's plan designation, shared by every flat of that layout across the project. Storing it on
  `unit` denormalises a fact about a *type* onto each of its instances. If it is worth having it is
  worth having as a small table keyed by project, and this draft's position is that nothing reads it
  yet and it should be captured and left in `extracted_field` until something does.

---

## 6. Promotion onto an estate column, which does not exist yet

**Belongs in:** `SPEC-evidence.md`, the promotion target list under *FieldPromotion*.

Every piece of promotion machinery track B built is tenancy-shaped, end to end:

- `field_promotion.target` is a `CHECK` enum. It held two values at 4.3 and holds five after `0034`,
  all of them `tenancy.*`. The migration's own header names this cost as the design:
  *"a new typed column the isolation join or the responsibility matrix could read cannot be added by
  seeding a catalogue field."*
- `promoteExtractedField` resolves its subject by looking up a **`TENANCY`** link specifically
  ([src/evidence/internal/promote.ts:113](../../src/evidence/internal/promote.ts:113)) and refuses
  with *"that document is not bound to a tenancy"* otherwise.
- It writes through `applyPromotedField` on **tenancy's** contract. Evidence issues no estate SQL and
  must not start.

So `unit.rooms` as a promotion target needs three things, and none of them is a rewrite:

1. A migration widening the `target` CHECK. Deliberate, and correct — it is the governed half of A8
   working as specified.
2. A second link-kind branch in `promote.ts`: a `unit.*` target resolves through the `UNIT` link, a
   `building.*` target through `BUILDING`. Both entity types already exist in `document_link`'s CHECK
   ([0011_evidence.sql:214](../../src/kernel/migrations/0011_evidence.sql:214)), so the link half
   costs no migration.
3. An estate-side `applyPromotedField`, mirroring tenancy's. Estate already exposes exactly this
   shape of seam — `applyProtocolSeed` is what A6 calls so that evidence never writes `asset`, `unit`
   or `building` itself. The rule is on file; this is a second function under it.

**This is extension along a seam that exists, and the seam was designed for it.** It is the
best-aligned part of track A.

---

## 7. "Occupied" means something different one level down

**Belongs in:** `SPEC-evidence.md`, amending #130's rule where it is stated.

#130 built the refusal that stops a promotion silently moving a typed column. Its definition of
occupancy is precise, and `promote.ts` states it in a comment:

> Occupancy is a stamp from a *different* extracted field on this letting, **not a register date**.

That carve-out is right for tenancy dates. The register importer writes `tenancy.start_date` without
a document, and treating an imported date as an occupant would have made the ordinary case an error.

It does not survive the move to estate columns, for one reason: **`unit.rooms` is `NOT NULL`.** Every
unit in the system has a `rooms` value, written by the A13 screen or the register importer, with no
`extracted_field` row behind it and therefore no stamp. So a promotion onto `unit.rooms` would find
no occupant, and would silently overwrite an operator's typed value with a model's reading of a
lease. `space.floor` is nullable but is written by the same two hands and has the same problem
whenever it is set.

For tenancy dates the gap was survivable and #130 said so explicitly. **One level down it is the
common case, not the edge.** Something has to distinguish *nobody has said* from *a person said, with
no document* — a provenance the estate tables do not currently carry. That is question 5, and it is
the one place where this track needs a rule that track B did not need.

---

## 8. Where a building fact comes from, and the recommendation

**Belongs in:** `SPEC-evidence.md`, *Seeding the catalogue*; `SPEC-estate.md`, the A11 screen.

§2's rule says a fact is declared on the type that establishes it. Applied to `gush`:

- The **lease** recites it. Track B already ruled that declaring it there puts the fact where it was
  printed rather than where it is true, and that ruling is in `SPEC-evidence.md:984`. It stands.
- The **building handover protocol** is the only building-level type in the catalogue, and it
  declares exactly one field, `handover_date`
  ([src/evidence/fixtures/document-types.ts:503](../../src/evidence/fixtures/document-types.ts:503)).
  It is a מסירה record. There is no reason it would carry a parcel number.
- The document that actually establishes `gush` and `helka` is a **tabu extract (נסח טאבו)** or the
  **plan**. Neither is a document type here, and whether either exists in the corpus at all is
  unknown to this draft.

**Recommendation: do not extract `gush` and `helka`. Type them.** Two columns on `building`, filled
on the A11 building screen, with the `estate.write` stance both halves of that screen already carry.

The argument is proportion. Shoham is tens of buildings, not thousands. The values are on the tabu,
they are five digits, they change never, and one of them is a list whose order varies by page. Against
that: extracting them would require a new document type, a new declaration set, a second promotion
family, a second golden set with its own specimens — Document AI captures of documents nobody has
confirmed we hold — and a scorer that is currently coupled to leases by
[evals/extraction.ts:645](../../evals/extraction.ts:645). That is a great deal of machinery to read a
number once per building.

**What the lease's printed `gush` becomes instead is more useful than a capture: a cross-check.** The
value is declared, extracted and scored, and the scorer asserts it against the *typed* building — the
same shape as the four arithmetic identities the fixture already carries, which assert a relationship
rather than a value. A lease whose `gush` disagrees with its building's is either filed against the
wrong building or is not the document it claims to be, and that is a genuinely valuable thing for a
gate to catch. It is also the only use of the extracted value that does not put the fact in the wrong
place.

This recommendation is reversible in the direction that matters: if a tabu extract turns out to be
routinely filed, the typed column becomes a promotion target and nothing already written is wrong.

---

## 9. One value is on a drawing

**Belongs in:** `SPEC-evidence.md`, if `apartment_type` is pursued at all.

`apartment_type` comes from the title block of a plan drawing, and the fixture's note is a warning:

> This is a drawing, not prose — no text layer worth reading, and the words sit in table cells.

Both specimens' plan pages are images inside the PDF. §5 argues `apartment_type` should not be a
column; this section adds that it is also the value least likely to be read correctly, and the two
arguments point the same way. **Capture it, score it, and let the baseline say whether the reader can
see a title block at all.** That is a cheap experiment and a genuinely interesting number — nothing
in the corpus has tested the reader against a drawing.

---

## 10. Open questions — these are what the grill is for

This draft proposes nothing that can start before these have answers. They are ordered by how much
downstream work each one decides.

1. **Is there a tabu extract, a plan, or any building-level document in the corpus for these
   buildings?** Decides §8 entirely. If yes, extraction may be worth it after all and this proposal's
   central recommendation is wrong.
2. **Does the bay belong to the flat, to the letting, or to both?** §3. Decides whether
   `parking_space_number` may be declared at all, and whether `unit.parking_space_id` survives
   unchanged.
3. **Is `helka` a text list or its own table?** §5. Cheap either way today, expensive to change after
   something reads it.
4. **Is `building.name` a human-facing name or an identifier?** §5. Decides whether `building_number`
   is a new column, a cross-check against `name`, or nothing.
5. **How does a promotion tell "nobody has said" from "a person typed it"?** §7. The only rule this
   track needs that track B did not, and it blocks every unit-level promotion.
6. **Is the A13 placeholder defect (§4) its own ticket, filed now?** This draft says yes and says it
   should not wait for answers to 1–5.

---

## Order of work, if it is adopted as drafted

Written the way track B's §9 was, because that ordering worked: the reversible things first, the one
irreversible thing after the reading that depends on it has been measured.

1. **The A13 placeholder defect** (§4). Independent of everything else, corrupts data today, needs no
   answer to any open question.
2. **Seed rows** for the unit-level declarations that have somewhere correct to land — `rooms`,
   `floor`, and `building_number`/`gush`/`helka` as **cross-checks only**, not promotion targets. No
   DDL. Re-measure on the golden set; the reader has never been asked for these.
3. **The typed columns** — `building.gush`, `building.helka`, on A11. One migration.
4. **The provenance rule** (§7), red first as a policy case, before any estate column becomes a
   promotion target. #130's ordering argument, reused: build the refusal while the gap is still
   survivable.
5. **The estate promotion family** (§6) — the `target` CHECK widened, the link-kind branch, estate's
   `applyPromotedField`. This is the irreversible one and it arrives last.
6. **The bay** (§3), whatever question 2's answer turns it into.

Steps 1 and 2 touch no schema. Step 3 adds two nullable columns. Step 5 is the only one that changes
what `promote` can do to a table it has never written to.

---

## Out of scope

**`security_structure`** — a `security_election` document bound into the same PDF as a lease, sharing
one `file_hash`, which `document` cannot represent. A real defect with real consequences (it is the
page that explains `bloch`'s three-month deposit) and it belongs to intake, not to place.

**`index_base_month`, `index_publication_date`** — indexation terms of the letting. They sit beside
rent and are track B's furniture, left undeclared there rather than assigned here.

**#125** — what place paper a tenant may read for their own flat. Parented to #124, open, the
director's to triage. It is adjacent to this track and is not part of it: this proposal is about where
a fact is stored, #125 is about who may read a document.

**The obligation and compliance regimes** that hang off `asset`. Untouched.

---

## What this proposal is measured against

Track B's claims became measurable because `evals/fixtures/lease-extraction.ts` existed before the
work started. The same fixture already covers this track — all fourteen values, with their printed
Hebrew, their page numbers and their hazards, hand-keyed from the same two specimens. The scorer from
#127 runs them the day they are declared.

So there is no new ground truth to build and no new specimen to capture. **The measurement for
everything in §§2, 5 and 9 is the same golden set, re-run**, with the residual count falling from
seventeen. Judge it over at least eight runs and compare ranges rather than means — the correction on
#127 is the reason that sentence is here.
