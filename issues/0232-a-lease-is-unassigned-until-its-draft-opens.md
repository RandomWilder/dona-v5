---
number: 232
title: "A lease is unassigned until its draft opens (פתיחת טיוטה)"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-14
closed:
---

## Problem Statement

On 14 Oct 2026 the director filed a real lease on staging through **תיוק חוזה** (document `01a13956`). The session showed error screens while approving readings: one raw JSON body, and one 409 "that reading is already approved". In the end all 33 readings were approved, but no draft tenancy existed in **שכירויות** and no people existed in **אנשי קשר**. The tab sat on **הקריאה** with no action and no reason.

Underneath that there are four separate failures:

1. **The draft write hangs off the last approval, after the stamp has committed.** The approval that made the reading ready committed its stamp in its own transaction. The draft write that followed then failed, because the 12 Oct staging reset had emptied `terms_profile`. The stamp stayed and the draft never existed, and no later approval retries it, because every row is already approved.
2. **The upload asks for the flat.** The director expected the flat to be assigned on the tenancy, not hunted for during upload. The place step fails on leases that put the address in an annex (#177), on near matches among 1,500 flats, and on flats that are not yet in the system. Because storage cannot delete what it writes, the system forces the choice up front, which is the worst moment to make it.
3. **Contact details read off the lease go nowhere.** A phone or email approved on the reading has no promotion target and writes no `party_contact`. The people who should become reachable, and isolatable, through the tenancy are not.
4. **The two approval screens disagree.** A15 (`/documents/:id/fields`) and A16 (הקריאה) approve the same rows with different controls and different consequences. On A16, 33 rows meant 33 presses.

## Solution

A lease is stored at upload as an **Unassigned document**: no place, a storage path that names no flat. It is read and approved as today, on one screen. Approving only stamps. When the reading is ready, the administrator presses **פתיחת טיוטה**. One screen shows:
- the flat, preselected when the read address matches exactly one;
- the terms profile, preselected as `נספח תחזוקה — תקן`;
- the people, matched by ת.ז., phone or email, and offered as same-name candidates only for a deliberate link;
- anything that would block, stated in Hebrew before the press.

The press writes the draft tenancy, the parties, their phone and email contacts, and the document's links, all in one transaction. A lease that has not yet been opened waits on a **ממתינים לפתיחה** list at the top of שכירויות. The flat's word (פנויה / מושכרת) is unchanged: it is computed from the letting that counts today, and a draft does not move it.

The decision this rests on is [ADR-0015](../docs/decisions/ADR-0015-a-lease-is-unassigned-until-its-draft-opens.md).

## User Stories

1. As an operator, I want to upload a lease without choosing a flat, so that I don't have to search 1,500 flats while holding paper.
2. As an operator, I want the system to tell me when these exact bytes were already uploaded, with a link to the existing document, so that I don't file one lease twice.
3. As an operator, I want an uploaded lease to be read straight away, so that I can approve the reading before I know or decide the flat.
4. As an operator, I want a lease whose address is only in an annex to be filed and read like any other, so that #177's case no longer stops the upload.
5. As an operator, I want to approve names, ת.ז., phone numbers, emails, dates and the read address one row at a time, so that whatever decides who a person is and what they can reach is signed deliberately.
6. As an operator, I want one "approve the rest" press for every other row, so that a 33-row lease takes about ten deliberate presses, not 33.
7. As an operator, I want "approve the rest" never to sweep up an identity or access row, so that bulk approval can't become a reflex on the rows that matter.
8. As an operator, I want an approval to only stamp the row and never fail because of something downstream, so that I'm never told "error" about a row that was in fact saved.
9. As an operator, I want a second press on an already-approved row to say so in Hebrew and leave me on the same step, so that a double click isn't an error page.
10. As an operator, I want every refusal on these screens to be a Hebrew sentence in the page, never a JSON body, so that I know what to do next.
11. As an operator, I want a lease opened from A15's ledger to land on A16's reading step, so that one press means one thing everywhere.
12. As an operator, I want a phone read without its leading zero (`549797236`) to be offered back as `0549797236` before I approve, and a value that isn't a valid Israeli mobile number to be refused, so that a misread number never becomes someone's contact.
13. As an operator, I want each person on the lease (main tenant, second tenant, each guarantor) to have their own phone and email rows, so that a contact is attached to the right person by construction and not by position.
14. As an operator, I want the **פתיחת טיוטה** button to appear the moment the reading is ready, and a list of what is still missing when it isn't, so that the tab never sits on a step with nothing to press.
15. As an operator, I want the flat preselected on פתיחת טיוטה when the read address matches exactly one flat, so that the common case costs one confirming press.
16. As an operator, I want to search building and flat number on פתיחת טיוטה when the address matched none or several, so that I choose the flat where the tenancy is born.
17. As an administrator, I want to create the building or flat from פתיחת טיוטה when it isn't in the system, so that a new building doesn't send me out of the flow.
18. As an operator, I want to open the draft even when the chosen flat and the read address disagree, with both shown, so that a lease with a typo in its address isn't stuck.
19. As an administrator activating a tenancy, I want an address disagreement recorded at draft opening shown again at activation, so that the flat is checked against the paper before anyone gets access.
20. As an operator, I want the terms profile preselected as `נספח תחזוקה — תקן`, so that I don't choose it every time.
21. As an operator, I want פתיחת טיוטה to say in Hebrew that no terms profile exists and keep the button disabled, so that I never press into a failure like the one on 14 Oct.
22. As an operator, I want a person whose ת.ז., phone or email already belongs to a contact to be attached to that contact, so that one person signing two leases is one contact.
23. As an operator, I want a person matching an existing contact only by name to be shown as a candidate ("same person?"), with a new contact as the default, so that two different משה כהן are never merged without my press.
24. As an operator, I want two people on one lease resolving to the same ת.ז. to be refused with a sentence, so that one person's role isn't silently overwritten by another's.
25. As an operator, I want to be told when an existing tenancy has the same tenant ת.ז. and start date, with a link and a choice (attach this lease to it, or open a new draft anyway), so that a rescan of a filed lease doesn't make a second tenancy.
26. As an operator, I want a second lease on the same flat and start date refused, naming the existing tenancy, so that the letting's natural key still holds.
27. As an operator, I want פתיחת טיוטה to write the draft, the people, their contacts and the document's links together or not at all, so that a failure never leaves half a tenancy behind.
28. As an operator, I want each new person created with given name, family name, ת.ז. when printed, phone and email when read, and their role on the tenancy, so that the contact card is useful the day it is created.
29. As an operator, I want a guarantor created as a contact with the guarantor role and never as a service contact, so that a guarantor's phone never reaches the flat.
30. As a tenant, I want my WhatsApp messages to reach my flat only once my tenancy is live, so that a draft never gives anyone access.
31. As an administrator, I want a phone from a lease to start granting access only on activation, which is already behind the activation gate, so that two human checks stand between a misread and access.
32. As an operator, I want the tenancy titled `<primary tenant's name> · <street> <number>, <city> · דירה <n> · <start date>`, so that I recognise it in every list.
33. As an operator, I want that title computed on every display, so that correcting a name corrects the title everywhere.
34. As an operator, I want "primary" to mean the main tenant, or the first tenant listed when no main tenant was read, so that the title is deterministic.
35. As an operator, I want unopened leases listed at the top of שכירויות under **ממתינים לפתיחה**, with the date, the name read and a **פתח טיוטה** button, so that a lease one step short of a tenancy is visible where tenancies are looked for.
36. As an operator, I want a lease that waits because its building isn't in the system yet to stay on that list until I open it, so that "paper without a flat" has a place that isn't a flatless draft.
37. As an operator, I want an unopened lease to be invisible to the office question-answer panel and to tenants, so that no answer comes from paper not yet bound to a flat.
38. As an operator, I want to open the file of an unopened lease from the waiting list, so that I can still read it.
39. As an operator, I want the reading closed once the draft opens, and corrections made on the person or tenancy with the lease's value shown beside them, so that fixing one tenancy's typo never rewrites a person shared with another.
40. As an operator, I want a lease uploaded from a flat's page to arrive with that flat preselected on פתיחת טיוטה, so that the shortcut still saves the search.
41. As an operator, I want the stepper on תיוק חוזה to read **המסמך · הקריאה · פתיחת טיוטה · הטיוטה · די היום**, so that the step that used to block upload is where the tenancy is born.
42. As an operator, I want documents filed under flat paths before this change to keep working exactly as they do, so that nothing already filed moves.
43. As an operator, I want the flat's word (פנויה / מושכרת) unchanged by an upload or a draft, and to change only when a live letting counts today, so that the estate shows what is true and not what is planned.
44. As the director, I want the staging reset to keep `terms_profile` the way it keeps the other catalogues, so that a reset can't remove what every draft requires.
45. As the director, I want the lease stuck on staging (`01a13956`) opened with the new button once this ships, so that the whole path is clicked on real paper.

## Implementation Decisions

- **The decision record is ADR-0015.** Specs amended in the same change: SPEC-flows (the draft paragraph, A1, A2, A12, A15, A16), SPEC-evidence (object path and anchor), SPEC-parties (contacts written from a lease), SPEC-tenancy (title, terms profile at opening).
- **Unassigned lease storage.** A `lease` arriving through any door (A1 unit-first, A12, A16, the flat page) is stored under an object path rooted at a fixed `unassigned` segment, then the type key, then the file hash: no place kind, no place id. The leaf is still the file hash, so the put stays idempotent. No `document_link` is written at upload. A unit id carried by the door is kept only as the preselection for פתיחת טיוטה, not as a link. Other document types are unchanged and still require a place.
- **Anchor.** "Which flat this document is about" is read from the path when the path names a place, and from the document's `UNIT` `SUBJECT` link when the path is unassigned. פתיחת טיוטה writes that link exactly once. Search and retrieval already go through `document_link` and tenancy, so an unopened lease is invisible to them with no new code.
- **The place reader stays and moves.** A12's deterministic reader runs on a lease at upload as before, but its result is stored as the reading's address proposal and does not file. Exactly one flat becomes the preselection on פתיחת טיוטה. Zero, several, nothing read, or annex become that screen's candidate list and search, with A12's four sentences. Create-building and create-flat are offered there under `estate.write`, through the existing A11/A13 commands.
- **Approval only stamps.** Both approval routes write the stamp and redirect. The establish-the-draft call is removed from the approval path. A mapped field approved on a lease that already has a draft is still carried, as today. Carry on a lease without a draft waits for פתיחת טיוטה, which carries every mapped field already approved.
- **One approval screen per lease.** A16's הקריאה is the lease screen. A15's ledger for a `lease` document redirects to it. A15 remains the screen for every other type. Both call one approval command with one outcome.
- **Approve the rest on הקריאה.** One control, worded as A15's `אישור כל מה שלא סומן`. It skips every row in the identity-and-access set: any name, any identifier, any phone, any email, start date, end date, and the read address fields. It also skips every row below the read-quality threshold or with no read quality, the same as A15's flag. Those rows are sorted to the top and stay one press each.
- **Per-role contact fields.** New declared `lease` fields, as seed rows at a new `effective_from` (provisional field list, prefer seed rows): `main_tenant_phone`, `main_tenant_email`, `second_tenant_phone`, `second_tenant_email`, `guarantor_phone`, `guarantor_email`. Guarantor contacts pair with `guarantor_name` by the same ordinal, all-or-nothing rule as the identifiers. They have no `field_promotion` target; their value reaches `party_contact` only through פתיחת טיוטה. Any phone or email fields already declared through A14 on staging are reconciled into these keys when seeded.
- **Phone validation at approval.** A phone row is approvable only when `normalisePhone` (the scope module's function) produces a valid Israeli mobile number. Nine digits starting with 5 are offered back with the leading 0 as the correction. Anything else is a Hebrew refusal on the row. An email row is folded by `normaliseEmail`.
- **Reading readiness.** Ready means approved main tenant name, start date and end date, plus every name row of every role approved. The button lists exactly the rows that are missing.
- **פתיחת טיוטה is one post, one transaction.** Inputs: the chosen unit, the chosen terms profile, and per person either "new" or an explicit link to an existing party. In order:
  1. refuse an existing tenancy on (unit, start date);
  2. `upsertTenancy` DRAFT;
  3. `linkDocument` TENANCY, and the `UNIT` `SUBJECT` link;
  4. sign and promote the dates, and carry every approved mapped field;
  5. write the parties: `upsertParty` on ת.ז.; else the party holding an open `party_contact` of that normalised phone or email (a parties read, not the isolation join); the operator's explicit link; otherwise `createParty`;
  6. `upsertPartyContact` for each approved phone and email, from today, with the existing overlap refusal;
  7. `upsertTenancyParty` with `is_service_contact` false for `GUARANTOR`;
  8. `linkDocument` PARTY SIGNATORY.

  Any refusal rolls back everything and renders the screen with a Hebrew sentence.
- **Address disagreement is computed, not stored.** פתיחת טיוטה shows the read address beside the chosen unit's and does not refuse. The activation gate gains a flag that compares the tenancy's lease reading (through its existing injected evidence reader) with the unit's address, using the same fold as the cross-check. No column.
- **Duplicate tenancy check at opening.** Before the write, a lookup for any tenancy with a party of the same `national_id_key` and the same start date. A hit renders a choice: attach this document to that tenancy (link TENANCY plus EVIDENCE, no party writes), or open a new draft anyway.
- **Same-name candidates.** For a person with no identifier, phone or email match, existing parties whose given and family names equal the read names are listed as candidates. The default is new. Linking writes the read contacts onto the chosen party only after the same overlap refusal.
- **`tenancy.unit_id` stays NOT NULL; `terms_profile_id` stays NOT NULL.** No migration to either. The terms profile is a select on פתיחת טיוטה, preselected as the existing default rule picks it. An empty register disables the button with a sentence.
- **Tenancy title.** A pure function in the tenancy module over the primary tenant party, the unit's building address, the unit number and the start date. Used by שכירויות, the tenancy page, the A16 הטיוטה beat and the waiting list. Not stored.
- **ממתינים לפתיחה.** A read in evidence: `lease` documents with an unassigned path and no TENANCY link. Shown at the top of שכירויות for `documents.write`, each row with the upload date, the main tenant name as read, the file, and **פתח טיוטה** (or "המשך קריאה" when the reading isn't ready).
- **Reading closes at opening.** Once the document has a TENANCY link, approval and correction routes on its rows refuse with a sentence pointing to the person or tenancy. Corrections happen there, with the reading shown beside the record (#229's display).
- **Errors.** The generic handler renders a Hebrew page for HTML requests, and keeps JSON for JSON clients. The known refusals on these screens are rendered in the page, not by the handler.
- **Staging reset.** Done ahead of this ticket in PR RandomWilder/dona-v5#136: `terms_profile` joins `KEEP_TABLES`, and `seed:terms-profiles` upserts `נספח תחזוקה — תקן`, run on staging through `infra/run-job.sh` after deploy (approved by the director 14 Oct). Opening `01a13956` waits for this ticket's פתיחת טיוטה.

## Testing Decisions

- A good test drives the app as the operator does, through HTTP, and asserts what an operator or another module can observe: the page, the rows in שכירויות and אנשי קשר, and what the scope contract resolves a phone to. It does not assert which internal function ran.
- **Seam 1, HTTP against the app.** `buildApp` with the fake extractor, the memory object store and a migrated pool, as in the existing A16 suite. One test per story group:
  - upload stores unassigned and writes no link;
  - exact duplicate bytes show the existing document;
  - approve-the-rest skips the identity-and-access set;
  - a second approval renders a sentence, not an error;
  - a misread phone is offered with its 0 and an invalid one is refused;
  - the waiting list shows the lease;
  - פתיחת טיוטה with exact-one preselect writes the draft, parties, contacts and links in one go;
  - no terms profile disables the button with the sentence;
  - same ת.ז. + start date offers attach-or-new;
  - same flat + start date refuses;
  - a same-name candidate is not linked unless chosen;
  - an address disagreement opens and is shown at activation;
  - the reading refuses edits after opening;
  - A15 redirects a lease to A16;
  - an HTML error is a Hebrew page.
- **Seam 1, also a policy case, red first.** Inside the same suite, the scope contract's resolver: the approved tenant phone resolves to no unit while the tenancy is DRAFT, and to the unit once it is ACTIVE on the asked date. The guarantor's approved phone resolves to no unit at any point. This is a new deterministic constraint on the path, so it is written failing before the code.
- **Seam 2, `partitionTables`.** In the existing staging-reset suite: `terms_profile` is kept.
- **Prior art:** the A16 filing suite (HTTP, fixtures, fake reader), the scope suite (resolver through the contract), and the party-contacts suite (overlap refusal).
- **No golden run.** No prompt, model id, retrieval config or tool definition changes. The new declared fields are seed rows the extractor reads under its existing prompt. If the field hints change the extraction prompt text, the golden set runs.
- **Click pass before merge** on `:3000`: upload a fixture lease, approve, open the draft, see it in שכירויות and the people in אנשי קשר.

## Out of Scope

- A tenancy without a flat. `unit_id` stays required, and a lease without a flat waits as an unassigned document.
- Unassigned storage for any type other than `lease`. Handover protocols still arrive on a tenancy; building paper still names a building.
- Moving or copying documents already filed under flat paths.
- The ID mismatch between the promissory note and the lease (מיכל: `304910086` vs `3304910086`).
- The second guarantor the reader missed (שמעון פרידמן). Reading quality, a separate ticket.
- Making A15 and A16 one screen for every type.
- Letting the office question-answer panel see unopened leases.
- Re-seeding staging and opening `01a13956`. Director's acts, listed as stories 44–45 so the click pass names them.

## Further Notes

- The grill that produced this ran on 14 Oct 2026 in seventeen questions. All recommendations were accepted.
- A16's "nothing is held between read and file" and "does not list unfinished filings" are both reversed for leases by ADR-0015. The amended spec says where.
- The four bugs from the session (terms profile wiped, approval saved without the draft, raw JSON, no retry) are all closed by this design rather than patched separately. The draft no longer hangs off an approval, so there is nothing to retry. They are still worth separate tickets so each one closes with a test.
