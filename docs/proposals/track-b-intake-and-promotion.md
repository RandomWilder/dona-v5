# Proposal: Track B — intake, promotion, and the tenancy card

**Status: ADOPTED, 2026-09-21.** The specs are now the authority and this file is the record of how
they got that way. Where this proposal and a SPEC file could be read as disagreeing, the SPEC file
wins — the same rule `CONTEXT.md` states about itself.
**Date:** 2026-09-21
**Supersedes nothing. Amended on adoption:** `SPEC-evidence.md` (the scorer, under *Reading a filed
document*; two `ExtractedField` bullets on position and reasoning effort; the lease declarations,
under *Seeding the catalogue*; the `is_required` commentary; three subsections after the 7.4 copy
ruling; A16 beat 3), `SPEC-tenancy.md` (the *no amount column* paragraph, and a new section on the
option exercised), `SPEC-flows.md` (A16 beat 3), `CONTEXT.md` (the render-only rule and two glossary
entries: **Option**, **Credited absence**).

Two things were decided at adoption that this draft left open, and both are in the specs rather than
here. The `tenancy_event` kind for an option exercise is **`extended`, with a nullable
`source_document_id`** — neither neighbour's shape, because an option exercise is honestly sometimes
papered and sometimes a phone call. And the migration's blast radius is named: `src/tenancy/schema.test.ts`
asserts `tenancy`'s column list exactly, so it goes red on the three new columns by design and moves
in the same change.

This file is the draft the director asked for before any spec file was edited. It is written as the
prose that would be folded into those specs, section by section, so that approving it was approving
the words rather than a summary of them. Each section names the file and heading it belongs under.

---

## Why this exists

The lease extraction field list was derived from one document on 20 September 2026 and extended by a
second on 21 September. Reading both end to end, by hand, produced a set of values the running
system does not currently reach — not because the model is wrong, but because of four things this
codebase does to the document before the model ever sees it. That reading is now written down as
`evals/fixtures/lease-extraction.ts`: 57 values, 2 credited absences, 4 arithmetic identities, 10
recorded hazards, across two specimens. It is the first ground truth this module has had, and it is
what makes every claim below measurable rather than argued.

Two documents is a thin sample. Everything proposed here is therefore biased toward the reversible
change: a seed row rather than a migration, a view rather than a column, a declaration rather than a
constraint. One migration is proposed, and its justification is that something deterministic will
read what it adds.

---

## 1. The reading is scored before it is improved

**Belongs in:** `SPEC-evidence.md`, new subsection under *Reading a filed document*.

A golden set for extraction joins the existing `evals` gate. It runs the live extractor over the two
specimen leases and compares every value against `evals/fixtures/lease-extraction.ts`. Like every
other eval in this repo it needs `OPENAI_API_KEY` and is skipped without one; it adds no new CI
machinery.

**What it asserts.** Per-field exact match at 95% or better; no value returned with a confident
citation that disagrees with the fixture; both of the second lease's credited absences credited; all
four arithmetic identities holding. Required-field accuracy and optional-field accuracy are reported
**separately and never blended**, because a miss on `guarantor_name` and a miss on `rent_amount` are
not the same failure and one percentage hides which one you have.

**What the bar is for.** It is a tripwire against regression, not a proof of accuracy. Two documents
cannot establish that the reader is good; they can establish that a change made it worse. The
baseline is measured *before* any of section 2 lands, on a green branch — a baseline taken on a red
suite is not a baseline.

**A credited absence** is a declared field that correctly returns nothing, because the document does
not contain it. The second specimen names no guarantor at all; extraction returning zero of them is
the right answer. Scoring that as a miss would tune the reader toward inventing guarantors. This is
already the module's doctrine — a missing required field is a result and not an error — and the
scorer is the first thing that has to encode it in arithmetic rather than in prose.

---

## 2. What the model is given

**Belongs in:** `SPEC-evidence.md`, *ExtractedField*, amending the **Two engines** bullet.

Today the mapping model is handed `{id, page, text}` per word. The measuring engine produced
`x`, `y`, `width`, `height` and `confidence` for every one of those words, and all of it is discarded
before the prompt is built. On a Hebrew lease this is expensive in a specific way: the annex that
carries the commercial terms is a two-column right-to-left table, where the label sits *beside* its
value rather than before it. In reading order the label and the value are far apart; on the page they
are adjacent. Stripping position removes the only signal that says so.

**Each word is therefore sent with a normalised position**: `x` and `y` as integers in a 0–1000 page
space, no width and no height. Normalised rather than raw because page dimensions vary across the
corpus and the model needs relative placement, not absolute points; `x`/`y` only because the token
cost of four coordinates per word across a 38-page document is real and the extent of a word carries
little that its origin does not.

**This changes nothing about citation.** `extracted_field.bbox` is written by the measuring engine
and is what the provenance viewer highlights. It is unaffected. The two are separate uses of the same
measurements and conflating them has already caused one wrong estimate.

**Reasoning effort.** `extraction.reasoning_effort` defaults to `none`. Several of the values on a
lease are only reachable by arithmetic the document itself invites — a deposit stated as a number of
months of rent plus maintenance, a promissory note at six. A reader given no room to work cannot
check its own answer against the identity printed beside it. The default becomes `medium`. This is a
settings row read per call, not a deploy.

**What is deliberately not changed yet.** The extractor makes one call per document, carrying every
declared field across every page, and `EXTRACT_INSTRUCTIONS` is a single accumulated string of bug
patches. Both are real defects and both are larger changes. They wait, because position and reasoning
effort are independent of each other and cheap, and a measured run across the two of them will say
which of the remaining two is worth building. If normalised position does not move the score, the
layout hypothesis is wrong and the larger line-reconstruction work should not be done at all.

---

## 3. What a lease declares

**Belongs in:** `SPEC-evidence.md`, *Seeding the catalogue — data, not a migration*.

All of the following are seed rows at a new `effective_from`. No migration.

### 3.1 The household is named by role

A lease is signed by more than one person, and the declaration has to say which person each value
belongs to. `extracted_field` permits two rows of one declaration and always has, but two rows of
`tenant_name` and two rows of `tenant_id_number` arrive with **no link between them** — nothing says
which identifier belongs to which name. On the second specimen the two signatories carry different
*kinds* of identifier, a passport and a ת.ז., one line apart. A pairing heuristic that gets this
wrong writes one person's identifier onto another person's record, and looks entirely correct doing
it.

The declaration therefore names the role:

| Key | Required | Becomes |
|---|---|---|
| `main_tenant_name` | yes | `tenancy_party.role = 'PRIMARY_TENANT'` |
| `main_tenant_id_number` | no | that party's `national_id` |
| `second_tenant_name` | no | `tenancy_party.role = 'CO_TENANT'` |
| `second_tenant_id_number` | no | that party's `national_id` |
| `guarantor_name` | no | `'GUARANTOR'` — unchanged, already declared |
| `guarantor_id_number` | no | unchanged, already declared |

Pairing is solved by construction: `main_tenant_id_number` belongs to `main_tenant_name` because the
declaration says so. There is no proximity heuristic and no screen that asks an operator to attach an
identifier to a name.

The keys mirror `tenancy_party.role`, which already distinguishes `PRIMARY_TENANT` from `CO_TENANT`.
They do not invent a parallel idea of seniority; they name one the tenancy module already governs.

**The cap at two is a seed cap, not a schema cap.** A lease with three signatories is served by a
`third_tenant_name` row at a new `effective_from` — a seed row, reversible, no migration, exactly the
direction this module prefers. Nothing in the schema will need to change to accommodate it.

**The existing `tenant_name` and `tenant_id_number` rows are closed**, not edited. R18 is not
negotiable here: a value extracted in September under the old declaration must keep meaning what it
meant, and an edit would silently rewrite it.

**A duplicate capture is shown, not resolved.** There is still no unique key on
`(document_id, document_type_field_id)`, so a model returning two values for `main_tenant_name` writes
two rows. The reading screen renders both and the operator picks. A silent first-wins would be the
bug — the point of capture being open is that disagreement survives to a person.

### 3.2 The terms the specimens actually print

| Key | Type | Required | Note |
|---|---|---|---|
| `maintenance_amount` | NUMBER | no | ועד בית, charged monthly beside the rent |
| `maintenance_currency` | TEXT | no | paired with the amount, per ADR-0008 |
| `deposit_months` | NUMBER | no | the multiplier, **not** assumed — see below |
| `promissory_note_amount` | NUMBER | no | שטר חוב |
| `promissory_note_currency` | TEXT | no | |
| `option_end_date` | DATE | no | the end of the extension period, distinct from `end_date` |
| `signed_date` | DATE | no | when it was signed, which is not when the term starts |

**`deposit_months` is declared rather than assumed, and this is the fixture's central finding.** Both
specimens compute their deposit as (rent + maintenance) × a multiplier. The first uses two months;
the second uses three, and states so on a page that is **a different document bound into the same
PDF** — an election form filed as part of the lease file. A deposit check hard-coded at two would
flag a correct lease as wrong, and would do so on the lease whose own paperwork explains why.

**`option_end_date` is the fix for a trap the current hints cannot see.** Both leases run five years
with a five-year option, and both print all four dates. The live hint for `start_date` says only that
the value is ISO-formatted; nothing in it distinguishes the original period from the option, so there
is nothing stopping the option's dates landing in `end_date`. Declaring the option separately makes
the distinction the reader's job and gives the scorer something to fail on.

### 3.3 What is not declared here

`gush`, `helka` and the plan's structure designation are printed on both leases and are **facts about
the building, not about the letting**. They belong to a Building declaration — Track A — and
declaring them on the lease type would put a fact in the place where it happens to have been printed
rather than the place it is true of. Both specimens also disagree with themselves about the plot
number, printing one value in the body and another on the plan, identically in both documents. That
is a property of the form, not a typo, and the fixture records it as a known conflict with no field
key and no score attached: there is no right answer to grade.

---

## 4. Required and optional

**Belongs in:** `SPEC-evidence.md`, *The tables*, amending the `is_required` commentary.

`is_required` stays a boolean and keeps meaning exactly what it means today: a declaration about what
a document of this type is expected to carry, never a refusal. A missing required field is a result.

Two cases do not fit a boolean, and neither becomes a column:

**A pair.** An amount without its currency is not a partial answer, it is an unusable one. This is a
property of the reading, not of the declaration, and it is enforced at the one place where it
matters — see section 5.

**A conditional.** `guarantor_id_number` is optional in general and expected once `guarantor_name` is
present. This is left as reading-screen behaviour rather than schema, because the lease is currently
the only type with enough structure to need it and a `requirement` enum added for one type is a
migration paid by every other.

---

## 5. Promotion

**Belongs in:** `SPEC-evidence.md`, *Which declared fields are copies — the ruling*, amending the
table and adding two subsections.

### 5.1 Three more copies

Slice 7.4 widened the promotion target list by nothing, and gave a reason better than the default it
agreed with: promotion is the verb for a value the document is the source of. That reason admits
three more fields and refuses the rest.

| Declared field | Copy? | Why |
|---|---|---|
| `rent_amount` · `rent_currency` | **Yes** | The lease *is* the source of the price of the letting, in exactly the sense its dates are the source of the term. Arrears, reminders and the office bag all branch on it. The pair promotes together or not at all. |
| `option_end_date` | **Yes** | Whether a letting can be extended, and until when, is a question the renewal path asks of the record rather than of the paper. |
| `deposit_amount` · `deposit_currency` · `maintenance_*` · `promissory_note_*` | No | Quoted at move-out and cited from the page. Nothing branches on them. |
| `main_tenant_name` · `second_tenant_name` · the identifiers | No | Unchanged from 7.4. A household is written by the confirm as `PARTY` links; an identifier becomes `party.national_id` by an act, not a copy. |
| `signed_date` · `deposit_months` | No | Facts about the document. No column to land on. |

The test is **"will code branch on it?"** — not "is it important". A tenant's passport number is
important and is never compared to anything by a machine; the rent is compared to a payment.

This costs one migration: the `field_promotion.target` CHECK widens, and `tenancy` gains
`rent_amount`, `rent_currency` and `option_end_date`. None of the three is `NOT NULL` — completeness
is a state and never a constraint.

### 5.2 A promotion onto an occupied column

`promoteExtractedField` is idempotent for the same row re-promoted, but nothing today examines
whether the target column already carries a value promoted from a *different* extracted field. With
dates alone this was survivable. With rent it is not: an amendment, a corrected reading or a second
document on the same letting would move the price of a tenancy with nothing said.

**A promotion onto an occupied column succeeds silently when the value is identical, and refuses with
`conflict` when it differs.** Re-filing the same lease is an ordinary act and must not be an error. A
rent that changed is the single thing an operator most needs to be told. The refusal names the
existing value and the document it came from, and superseding it is a deliberate second act.

This is a policy case, red first.

### 5.3 A half-priced pair is not promotable

An amount may be approved without its currency — capture is open, and what the page says is always
approvable. It may not be **promoted** without it. The refusal lives in `promote`, beside the
approval requirement and for the same reason: the columns a copy lands on are read by machinery that
no model decides, and half a price on one of them is worse than no price at all.

This is the seam the module already has, used as it was designed: open on the way in, governed at the
gate. It is a policy case, red first.

---

## 6. What a view may read

**Belongs in:** `CONTEXT.md`, *Paper*, as a new paragraph after the capture/promotion rule.

Most of what a tenancy card shows will never be a typed column, because most of it is never branched
on. The alternative — promoting twenty fields so a screen can render them — would spend the
governed verb on a display problem and would make every future screen an argument about migrations.

**The render-only rule.** A view may read an **approved** `ExtractedField` value in order to display
it and to cite it. It may not branch on one, compare one, aggregate over one, or let one decide what
happens next. Those remain the exclusive business of typed columns, which is what the contract test
has always been about: the rule's target is *decisions*, not pixels, and a value shown on screen
beside a link to the page it came from is the opposite of a hidden dependency.

The boundary is kept structural rather than honour-based: these reads live in the read model and the
view layer, and never inside a module's `internal/`. The contract test continues to assert that no
deterministic path reads a capture.

This rule needs writing down precisely because "display only" is the exact phrase that erodes. The
first comparison written against an approved capture will be small, reasonable, and the end of the
distinction.

---

## 7. The reading screen

**Belongs in:** `SPEC-evidence.md`, A16, amending **Beat 3 is thin reading**.

The five beats — המסמך · הדירה · הקריאה · הטיוטה · די היום — are unchanged. Everything here lands
inside beat 3 and beat 4. The beats are named for what the operator is doing, and reading a lease and
signing the reading are one sitting; splitting them would make the workspace the office asked for
into two.

**Fields are grouped in the view**, not in the schema: dates, money, people, place. `document_type_field`
gains no `group_key` column. The lease is the only type with enough declared fields to need grouping,
and a column added for one type is paid for by every type that follows. The day a second type has
twenty fields, the column is the right answer; today it is speculative structure.

**Beat 3 widens from four rows to the declared set.** It is still one row per value, one אישור, one
optional correction. Reveal, promote, and bulk approval stay off this screen: this journey ends in a
draft letting, and the ledger at `/documents/:id/fields` remains the door for everything else.

**A pair with a missing half is marked on the screen** and approvable anyway — the refusal is at
promotion, not here.

**Identifiers are shown as printed.** This flow is the administrator stance throughout; nothing in it
is masked. There is no tenant-facing route to any of these screens and inventing masking rules for a
route that does not exist would be speculation. It is noted here, once, that **the tenancy card will
need a stance the day it acquires a tenant route** — a screen that grows one and inherits the office's
identifier rendering is precisely how a leak ships.

---

## 8. The option, exercised

**Belongs in:** `SPEC-tenancy.md`, new section; and `CONTEXT.md` if `TenancyEvent` needs the term.

Both specimens run an initial term with an option to extend. When a tenant takes the option, the
letting does not end and a new one does not begin: the same household stays in the same flat under
the same agreement, for longer.

**Exercising the option writes a `tenancy_event` and moves `end_date`.** The event is the history —
the same shape `ACTIVATED` and `TERMINATED` already use. `option_end_date` is not cleared, because a
letting that was extended is a different fact from a letting that was always five years long, and the
column is the only place that distinction survives.

The two alternatives were considered and refused. Updating `end_date` alone loses the fact that an
option ever existed. Creating a second tenancy row makes one continuous letting look like a turnover,
which is exactly the distinction the isolation rule exists to preserve: a previous household's paper
must not be reachable from a current letting, and a renewal is not a previous household.

---

## 9. Order of work

1. **The scorer**, on the fixture, measuring the extractor as it is today. It proves nothing yet; it
   establishes the number every later claim is measured against. On a green suite.
2. **Normalised position and `reasoning_effort`.** Re-measure. Decide from the numbers whether
   splitting the call and rewriting the instructions are worth building.
3. **Seed rows** for the declarations in section 3, with the old `tenant_*` rows closed.
4. **The migration** in 5.1, with the two policy cases in 5.2 and 5.3 red first.
5. **The reading screen** — grouping, pairs, the household by role.
6. **The tenancy card**, under the render-only rule.

Steps 1 and 2 touch no schema and can be undone by reverting one commit. Step 4 is the only
irreversible one in the list, and it arrives after the reading it depends on has been measured twice.

---

## Out of scope

Track A (the Building declaration, and pre-created spaces) and Track C (the retrieval bound leak, and
tenant isolation across a unit's lettings) are not addressed here. This proposal covers intake,
promotion and the card. Track C is a defect rather than a design and should not queue behind it.
