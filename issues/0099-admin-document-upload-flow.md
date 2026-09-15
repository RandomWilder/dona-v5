---
number: 99
title: "Admin document-upload flow: one reading, approve, confirm, activate"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-15
closed:
---

## Problem Statement

An administrator at Dona Dom receives a signed lease (הסכם שכירות) for one of roughly 1,500
apartments and needs the system to know about it: who the tenant is, which flat it covers, when the
tenancy starts and ends, what the rent is, and whether this tenancy is real yet or still a draft
waiting on paperwork.

Today that work is possible but it is not a flow. It is a set of screens that each do one correct
thing in an order nobody designed:

- The order of operations is not the order of the work. A document is filed, then extracted, then
  approved, then — through a separate route that also serves the addendum case — turned into a
  tenancy. An administrator who has just uploaded a lease has to know which screen comes next.
- Nothing in the system activates a tenancy. Draft-to-active is specified and unbuilt. There is no
  screen that shows one tenancy, no place that says what a tenancy is still missing, and no command
  that refuses to activate one for a stated reason.
- The mandatory second document — the handover protocol (פרוטוקול מסירה) — is a concept with no
  enforcement behind it. Nothing checks for it and nothing blocks on its absence.
- The document text is read once at upload and then discarded. Every later view of the reading pays
  for a second OCR call. Nothing about a document can be searched, asked about, or answered from,
  because no copy of its text is kept.
- Amounts are the single most important thing on a lease and the system refuses to record them. A
  declaration naming money is rejected outright by a vocabulary guard, so the rent on a signed
  contract cannot be captured, cannot be approved, cannot be shown, and cannot be answered.
- The approval and confirmation screens are dense walls of prose. The administrator's real task —
  scan the extracted values, spot the wrong one, fix it, approve — is buried in explanation.

The result is that the most common administrative task in the business is also the one the system
supports worst.

## Solution

One designed flow, document-first, in three screens, backed by one orchestrator over commands that
mostly already exist.

1. **Upload and read.** The administrator uploads a lease against a flat. The document is read
   exactly once in its life. That reading produces the verdict, the extracted fields, and — new — a
   stored, searchable, vectorised copy of the text, page by page. No later screen ever reads the
   bytes again.
2. **Approve.** A redrawn ledger screen: the extracted values as a scannable table, each one
   carrying the page it was read from, each one editable and approvable. Explanation is available
   but collapsed. Amounts appear here like every other field, because they are.
3. **Confirm and create.** A second screen fixes the flat, the letting and the roles, and creates
   the tenancy. Its title is the tenant's name plus the address and apartment number.

The tenancy then has a page of its own — the first screen in this system that shows one tenancy.
It states the title, the status, the dates, the documents held, what is still missing, and carries
the activate button. The button is dark until the tenancy holds an approved lease and an approved
handover protocol and today falls inside the lease's dates. When it is dark, the screen names every
requirement that was checked, not only the ones that failed. A person presses it; the clock never
does.

Separately, and because the text is now kept: an administrator can ask the system questions about
the documents and get exact, cited answers — including about money.

## User Stories

1. As an administrator, I want to upload a lease against a specific flat, so that the document is
   anchored to the place it concerns from the moment it arrives.
2. As an administrator, I want the system to read the document once and never again, so that viewing
   what it read is instant and costs nothing.
3. As an administrator, I want the reading to tell me whether it was confident, so that I know how
   carefully to check the values.
4. As an administrator, I want the document rejected if it is not the type I declared, so that a
   handover protocol filed as a lease is caught at the door rather than three screens later.
5. As an administrator, I want the extracted fields presented as a table I can scan, so that I can
   find the wrong value without reading paragraphs.
6. As an administrator, I want each extracted value to tell me which page it came from, so that I
   can check it against the paper in front of me.
7. As an administrator, I want to correct a value the reader got wrong, so that the tenancy is built
   from what the contract says rather than what the reader guessed.
8. As an administrator, I want to approve each value individually, so that my signature means I
   looked at that value.
9. As an administrator, I want to approve everything that was not flagged in one action, so that a
   fourteen-page lease does not take fifty clicks — but only where the confidence signal is honest
   enough to support it.
10. As an administrator, I want the rent amount captured from the lease, so that the most important
    number on the contract is in the system.
11. As an administrator, I want the deposit amount captured separately from the rent, so that the
    two are never confused.
12. As an administrator, I want each amount to carry its own currency, so that a lease pricing the
    deposit in one currency and the rent in another is recorded correctly.
13. As an administrator, I want an amount printed with separators and a currency symbol to be stored
    as a plain number plus a currency, so that it can be compared, summed and displayed consistently.
14. As an administrator, I want to confirm which flat and which letting the lease belongs to before
    a tenancy is created, so that a correctly-read document is never attached to the wrong place.
15. As an administrator, I want to set each party's role on the tenancy, so that tenants, guarantors
    and service contacts are distinguished from the start.
16. As an administrator, I want a guarantor never to be a service contact, so that the person who
    guaranteed the contract is never contacted as though they lived there.
17. As an administrator, I want the tenancy created as a draft, so that nothing goes live merely
    because a document was read well.
18. As an administrator, I want the tenancy titled with the tenant's name and the address and
    apartment number, so that I can recognise it in a list without opening it.
19. As an administrator, I want a page for a single tenancy, so that there is one place that answers
    "what is the state of this tenancy".
20. As an administrator, I want the tenancy page to list the documents it holds, so that I can see
    what evidence stands behind it.
21. As an administrator, I want the tenancy page to name what is missing, so that I know what to go
    and get.
22. As an administrator, I want the tenancy page to name what was checked and passed as well as what
    failed, so that a dark button is explained rather than merely dark.
23. As an administrator, I want to upload a handover protocol against a letting, so that the second
    mandatory document reaches the tenancy it belongs to.
24. As an administrator, I want a tenancy to refuse activation without an approved lease, so that no
    tenancy is ever live on an unread contract.
25. As an administrator, I want a tenancy to refuse activation without an approved handover protocol,
    so that no tenancy is live before the tenant accepted the flat.
26. As an administrator, I want a tenancy to refuse activation before its start date, so that a
    lease signed in October for a November tenancy does not make a household visible in October.
27. As an administrator, I want a tenancy to refuse activation after its end date, so that an
    already-expired lease cannot be activated into a row the clock closes the same night.
28. As an administrator, I want to press the activate button myself, so that a tenancy going live is
    always a human act.
29. As an administrator, I want a fully-approved future tenancy to tell me the date it becomes
    activatable, so that I can plan rather than guess.
30. As an administrator, I want activation recorded as an event, so that there is a record of who
    made this tenancy live and when.
31. As an administrator, I want the set of documents required for activation to be a single stated
    definition, so that adding a third required document later is one deliberate change rather than
    a hunt.
32. As an administrator, I want an expired tenancy to be ended rather than reopened, so that a
    finished tenancy never quietly acquires a new member.
33. As an administrator, I want a document that lapsed after activation to raise a flag rather than
    change the tenancy's status, so that the status means what it says and the problem is still
    visible.
34. As an administrator, I want the tenancies that are missing something to appear in the existing
    incomplete-tenancy queue, so that I work one list rather than several.
35. As an administrator, I want each missing requirement to appear in that queue as a named rule, so
    that I can tell at a glance which tenancies are waiting on which document.
36. As an administrator, I want to ask the system a question about the documents and get an answer
    drawn from them, so that I do not have to open and read a contract to answer a question.
37. As an administrator, I want every answer to cite the document and page it came from, so that I
    can verify it.
38. As an administrator, I want to ask about amounts and get exact figures, so that money is as
    answerable as any other fact on the contract.
39. As an administrator, I want the system to be able to compute from amounts it read — for example
    the total rent over the active portion of a tenancy — so that routine arithmetic is not my job.
40. As an administrator, I want retrieval to return the document's type and the flat it is anchored
    to alongside the text, so that a result is meaningful without a second lookup.
41. As an administrator, I want identifiers such as a ת.ז. visible to me, so that I can verify a
    party against their paperwork.
42. As a tenant, I want any answer I am given to be drawn only from my own documents, so that no
    other household's information can reach me.
43. As a tenant, I want identifiers withheld from what I am shown unless deliberately revealed, so
    that a casual query does not restate personal data back at me.
44. As an administrator, I want every reveal of a withheld identifier recorded, so that access to
    personal data is accountable.
45. As an administrator, I want documents read before this flow existed to be brought into the
    searchable store, so that the archive is as answerable as anything uploaded today.
46. As an administrator, I want the screens to work without client-side scripting, so that they are
    fast, reliable and consistent with the rest of the system.
47. As an administrator, I want the screens in Hebrew and right-to-left, so that they read the way
    the documents do.
48. As an administrator, I want to see the flow painted before it is built, so that I can correct
    the design when correcting it is cheap.
49. As a developer, I want a single orchestrator over the existing commands, so that there is one
    path that creates a tenancy from a document rather than two.
50. As a developer, I want the addendum case to move to the same sequence, so that an addendum
    remains a contribution to a tenancy rather than becoming a second mechanism.
51. As a developer, I want the activation gate expressed as data returned from one function, so that
    the screen, the queue and the tests all read the same facts.
52. As a developer, I want the tenancy module not to import the evidence module, so that the module
    boundary survives a feature that spans both.
53. As a developer, I want the money vocabulary guard removed rather than narrowed, so that no future
    change has to reason about a rule that no longer exists.

## Implementation Decisions

**Modules touched.** `evidence` (the orchestrator, the new route family, the passage store, the
screens), `tenancy` (activation, the tenancy page's read model), `kernel` (the OCR client loses its
page-image path). `scope` is untouched — the isolation join does not move. This spans two modules and
adds a migration, so the work is planned before it is written.

**The reading happens once.** The existing single decision point that chooses native text versus OCR
stays the only place bytes are read. Its output now fans out to three destinations instead of two:
the verdict, the extracted fields, and a new per-page text store. No route re-reads bytes.

**New table: the document passage.** One row per page of a document, holding the document id, the
page number, an ordinal, the text as printed, and an embedding. The embedding model and dimension
are the ones already welded at boot; no second model is introduced. Text is stored raw, exactly as
printed — including identifiers.

**No vector index initially.** Correctness first; an index is added when measured row counts justify
it, following the precedent already set for embedding work in this codebase. This is a deliberate
deferral, not an oversight.

**The word-box overlay is deleted.** The page-image overlay and its geometry are removed from the
read screen, from the reader's return shape, and from the OCR client. The OCR request is switched to
its imageless mode, which shrinks every response and moves the system further inside its request size
cap. Extraction continues to anchor a field to the words it was read from while extracting; that
geometry is no longer persisted and no longer drawn. The read screen keeps the per-page text and the
quality verdict, and every extracted value is labelled with its page number. This removes the need
for page rendering entirely, and therefore adds no rasterising dependency.

**Foundation rule 2 is retired.** The rule forbidding money — the declaration vocabulary guard, the
schema assertions forbidding money-named columns on tenancy tables, and the agent-facing prohibition
on price and balance — is removed in full. Money becomes ordinary data: readable, capturable,
approvable, promotable, retrievable, quotable, and computable. This is a reversal of a foundation
rule and is recorded as an architecture decision record, not merely as a spec edit.

Rule 3 is unaffected and continues to stand on its own: no model participates in the responsibility
decision or in the service-call state machine. What remains forbidden is the state machine branching
on a model-derived value — of any kind, money included. The money rule's removal does not weaken it.

**No new value type for money.** Amounts are captured as a number with a separate currency field
beside them. Four seeded fields are added to the lease type: rent amount, rent currency, deposit
amount, deposit currency — paired per amount rather than one currency per document, because a lease
can price two amounts in two currencies. Because the number and currency reuse existing value types,
the money change requires no schema migration at all. Capture normalises a printed amount to a bare
number; separators and symbols are the paper's, not the store's. Each amount field carries an
extraction hint that excludes the amounts it is not, in the same shape the identifier fields already
use.

**The route family is new; the commands are not.** One orchestrator sequences the existing filing,
extraction, approval and tenancy-upsert commands. The old route that created a tenancy from a
document is deleted rather than left beside the new one; two routes with two approval conventions is
drift this codebase has already paid to undo once. The addendum case moves to the new sequence with
it. The unit-first document list remains as a second door into the same orchestrator.

**Activation lives in tenancy.** A command that a person invokes. It refuses unless the tenancy holds
an approved lease and an approved handover protocol and today falls within the lease's dates. The
lease is the only document that defines when a tenancy starts and ends. The gate returns all four
facts, not only the failures, so the screen can name what was checked. The required set is a single
stated constant, expected to grow:

```
REQUIRED_FOR_ACTIVATION = ['lease', 'handover_protocol']
```

The evidence-side readers the gate needs are injected at the composition root, so the tenancy module
does not import the evidence module — the shape the incomplete-tenancy query already uses.

**Nothing activates on a clock.** A fully-approved tenancy whose lease starts in the future sits as a
draft, and its page states the date the button arms. Expiry remains clock-driven, as today; only
activation is human. A document that lapses after activation raises a flag and never moves the
tenancy's status.

**The handover protocol is per letting**, not per document upload — it is what records that the
tenant accepted the flat after inspecting it.

**Gate misses join the existing queue.** The activation gate's failures surface as named rules on the
existing incomplete-tenancy query rather than as a second list.

**New screen: the tenancy page.** The first screen showing one tenancy: title, status, dates,
documents held, what is missing, and the activate button with its reasons. The two existing screens
in the flow are redrawn rather than ported — the approval ledger leads with a scannable table and
collapses its prose, and the confirm screen is reduced to flat, letting and roles. All three are
painted as static mockups, served in the live shell under the dev-only mockup path, and reviewed
before any of them is wired. The mockups are deleted once wired. Screens remain server-rendered,
Hebrew, right-to-left, with no client-side scripting and no hard-coded colours.

**Party names appear on these screens** with no new permission, as previously settled; a permission
gate can add the check later without redrawing the screen.

**Retrieval takes a required stance.** The search function returns, per hit, the document, the page,
the text, the document type, the flat the document is anchored to, and a distance. Distance is used
for ordering and is never asserted on. The stance is required rather than defaulted, so no caller
can retrieve without stating who is asking.

**Withholding moves to read time.** Passages are stored as printed. The administrator stance returns
identifiers; the tenant stance masks them. There is one store and one embedding run; masking at write
time would both hide a tenant's own identifier from them and corrupt the vector, since the embedding
is computed from whatever text is stored. Every reveal continues to write a ledger row exactly as it
does today.

**Backfill.** Documents read before this flow existed have no passages. A sweep brings them in,
following the shape of the existing unverified-document sweep, and is allowed to run down to zero.

**Spec files are edited before the code, in the same change**, per this repo's standing rule: the
foundation rules and status, the evidence, tenancy and flows specs, and the glossary's nouns. The
glossary gains the passage and the stance, and loses the sentence forbidding money to the agent.

## Testing Decisions

**What makes a good test here.** A test drives the system the way its user drives it and asserts on
what the user can observe — a status code, the rows that exist afterwards, the text on the rendered
page, the reasons a refusal gave. It does not assert on how the answer was reached. Where a test
needs a constant that is also a production rule, it imports that constant rather than restating its
value, so that moving the rule does not silently turn a case green. Where a test guards a rule nobody
may decide, it is written red first.

**Four seams, all of them already in use. No new seam is introduced.**

1. **The HTTP surface, driven by request injection.** The primary seam and the highest one available.
   A new suite drives the whole flow the way an administrator drives it: upload a real multipart body,
   read, correct a value, approve, confirm the flat and roles, see the draft tenancy, attempt
   activation and be refused, add the missing document, activate. Assertions are on responses, on the
   rendered Hebrew, and on the rows that exist afterwards. The reader and extractor are injected
   fakes, so the test is deterministic and spends nothing. Prior art: the existing evidence route
   suite, which posts real multipart bodies through the whole path including the sniffer, the type
   guard and the object store, and which commits and cleans up against its own bucket because routes
   read through the pool.

2. **The policy gate, for activation.** Activation is a new deterministic constraint, so it gets a
   policy case written red first. The case builds its own rows in a rolled-back transaction and
   asserts each refusal reason independently: no approved lease; no approved handover protocol; today
   before the start date; today after the end date; and the passing case. It asserts against the
   required-set constant itself, never a second copy of the list. Prior art: the existing read-quality
   policy case, which is the same shape and for the same reason — a deterministic rule about what a
   person is allowed to do without looking.

3. **The agent gate, for retrieval.** The passage store and the decision to chunk one passage per page
   are retrieval configuration, so they enter the golden set rather than waiting for a consumer.
   Cases are graded on rank against corpus fixtures and ratcheted to what the system achieves on the
   day they land, so they go green immediately and block the next regression. No assertion is ever
   made on a distance. Prior art: the existing golden-case runner and its rank grading, and the
   corpus fixtures it already reads.

4. **The token-discipline guard, for the three screens.** The three new screens are appended to the
   existing screen registry rather than given a second guard file. This automatically asserts no
   hard-coded colour, no physical side, no client script, and no tenant name reaching the markup
   through an unintended path. Prior art: the registry itself, which renders each screen as a
   function and asserts on the bytes that reach the wire.

**Deletions are part of the testing change.** The money-field policy case and its route-level mirror
are removed, and the tenancy schema assertions forbidding money-named columns are removed. Nothing
replaces them: the rule they enforced no longer exists, and a guard kept alive after its rule has
been retired is worse than no guard, because the next reader will reason from it.

**Both gates run.** The retrieval change runs the full golden set. The new deterministic constraint
adds a policy case. Both are required for merge, and a silently skipped suite is treated as a failure
in continuous integration.

**Clicked before merged.** Each screen and each write path is exercised in a running local server
before the change merges; the review reads a diff and cannot tell anyone that a page renders.

## Out of Scope

- **Owner and landlord as extracted fields.** Dona Dom is the owner and landlord in every case in
  hand, so no owner field is declared and no landlord is extracted.
- **The tenant-facing flow.** The stance parameter and the masking rule are built and tested, but the
  tenant-facing surface that would use them is not built here.
- **Addendum shortening a tenancy.** An addendum that ends a tenancy before its lease's end date is a
  later piece of work. Only the addendum case as it exists today moves to the new sequence.
- **`verify` as a third verb.** Named in the glossary, still not built.
- **A vector index.** Deferred until measured, deliberately.
- **Page rendering and any rasterising dependency.** Removed from scope by the deletion of the overlay.
- **A permission gate on party names.** The names are shown now; the gate is a later change that does
  not redraw the screen.
- **Further required documents for activation.** The required set is written so that adding to it is
  a one-line change, but only the lease and the handover protocol are required today.
- **Migrating amounts into typed columns on the tenancy.** Amounts are captured and approved here.
  Promotion of an approved amount onto a typed column remains available and governed as before, and
  no such promotion is performed as part of this work.

## Further Notes

**This reverses a foundation rule.** The prohibition on money was one of the original numbered rules
and was enforced in three separate places. Retiring it is the single most consequential decision in
this spec, it was made deliberately and reaffirmed, and it is recorded as its own architecture
decision record so that a future reader finds the reasoning rather than only the absence.

**The overlay deletion is a subtraction that pays twice.** It removes a feature whose value was
validating extracted fields against the page — a job the page number does more cheaply, since the
administrator has just uploaded the document and has it in front of them. It also removes the last
reason to fetch page images from the OCR service, which shrinks every response and eliminates the
need to render pages for documents that never go through OCR at all. A rasteriser may still be worth
adding one day; it would be its own change, justified on its own merits.

**One reading per document is the point.** Three separate costs disappear together: the second OCR
call behind every view of a reading, the re-read behind re-extraction and the sweeps, and the
impossibility of answering a question about a document without opening it. All three are consequences
of the same omission — that the text was thrown away — and all three are fixed by the same table.

**The flow is designed to be extended.** The required-documents constant, the stance parameter, the
single orchestrator and the tenancy page are each shaped so that the next managerial flow — more
document types, more required evidence, the tenant-facing surface — is an addition rather than a
second mechanism.

## Comment — 2026-09-15

Migrated from GitHub issue #99, which is closed and points here. The tracker moved to local Markdown
files on this date; see `docs/agents/issue-tracker.md` for the format and the reasoning.

## Comment — 2026-09-15

The director clicked #100's paint and ruled the confirm screen out of the flow. Three places in this
epic are overtaken by that ruling, and are left standing above rather than rewritten, because the epic
is the record of what was asked for and this comment is the record of what changed:

- **Step 3, "Confirm and create"**, describes a second screen that fixes the flat, the letting and the
  roles. There is no such screen. Creating the draft tenancy follows the approved reading directly,
  and the administrator lands on the tenancy page (#107).
- **Story 14** — confirming which flat and which letting — is answered before the reading, not after
  it: the flat was picked at upload (A1) or resolved off the page (A12), and a lease **defines** a
  letting rather than belonging to one.
- **Story 15** — setting each party's role — is answered on the approval ledger. The role is carried
  by the field the name was read into, and the operator's approval of that row is the human
  confirmation invariant 5 requires.

The reasoning and the director's four comments are in #100's closing comment; #110's body is rewritten
to match. Nothing else in this epic changes: one reading, approve, create as draft, activate by a
person, remains the shape.
