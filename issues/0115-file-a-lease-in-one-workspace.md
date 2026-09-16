---
number: 115
title: "A16 — File a lease in one workspace (תיוק חוזה)"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-16
closed:
---

## Problem Statement

An operator with a signed lease in hand can already get that paper into the system, but the work is
split across surfaces that do not feel like one job. They file from **מסמכים** or a pile-of-paper
door; a mismatch looks like a different product; the reading is titled **מה נקרא מן המסמך**; the
draft appears on the Tenancy page. They have to know which app they are in. The office asked for one
workspace: always visible where you are in **this** filing, until the letting exists as a draft and
today is done.

They also asked that every **existing** tab and screen stay as it is. This is a new journey, not a
rewrite of the old doors.

## Solution

A new rail tab, **תיוק חוזה**, directly under **מסמכים**, only for people who may file. v1 is
**lease only**. Five named beats, status not a skip-wizard:

**המסמך · הדירה · הקריאה · הטיוטה · די היום**

Same commands as today (place from paper, file, stamp the reading that opens a letting, write a
draft). **New screens** under this tab. Old routes keep their copy and behaviour. Paint the journey
in the live shell, click it, then wire.

The lettered flow is **A16** in the flows spec. This issue is the work item.

## User Stories

1. As an operator who may file, I want a rail item **תיוק חוזה** under **מסמכים**, so that the
   Tuesday lease has a door that is not the catalogue.
2. As a viewer, I want that tab hidden, so that I never walk into a form that will refuse me.
3. As an operator, I want the tab's empty state to be the file beat, so that I start by attaching a
   lease, not by hunting a Unit.
4. As an operator, I want the type shown as **חוזה שכירות** and not as a menu, so that this journey
   cannot become every other document type.
5. As an operator, I want to attach one file and see the five beats on that screen, so that I know
   this is one filing, not five products.
6. As an operator, I want a scan that is not a lease to be refused on this tab with a sentence and
   nothing stored, so that I can attach the right file without leaving.
7. As an operator, I want a file the current reader cannot carry (today: about 15 MB for a scan that
   needs OCR; form still 20 MB) refused here with a sentence and nothing stored, so that I am not
   told it was filed when it was never read.
8. As an operator, I want street, city and apartment from the paper shown on the **same step** as the
   attach control, so that “where” is part of this filing, not a bounce to another app.
9. As an operator, when the paper matches **exactly one** Unit, I want to **see** that Unit and
   Continue, so that a machine match is still a human-visible choice.
10. As an operator, I want Continue on an exact match to be the moment the Document is written, so
    that nothing is stored until I accept the place.
11. As an operator, when nothing on the page is an address, I want A12's sentence for that cause on
    this step, so that I know to scan again or pick a Unit.
12. As an operator, when the lease defers the property to an annex, I want that named as a correct
    reading, not as a broken reader, on this step.
13. As an operator, when the address is in nobody's portfolio, I want that sentence on this step, so
    that I know why there is no Unit yet.
14. As an operator, when several Units answer, I want that sentence and a list to pick from, on this
    step, so that I choose without leaving the tab.
15. As an operator, I want a search for a Unit on this step, so that I can find a flat the reader
    did not uniquely name.
16. As an operator without estate write, I want pick and search only — no create control, so that I
    am not shown a door I may not walk through.
17. As an administrator with estate write, I want to create a Building and/or Unit **on this step**,
    so that a missing place does not dump me onto the estate forms.
18. As an administrator, I want those create fields prefilled from what was read, and editable, so
    that the paper's address is the starting point, not a retype.
19. As an administrator, after I create a place, I want to attach the file again on the same step, so
    that we still do not hold bytes between read and file.
20. As an operator, after a refusal that wrote nothing, I want the file input re-armed on this step,
    so that the price is a second attach, not a new app.
21. As an operator, I want duplicate bytes named as news on this tab, with a link to the existing
    Document, so that a second post is not a silent merge.
22. As an operator, once the Document exists, I want **קריאה** in this tab: names and dates to stamp
    so the letting can open, so that I am not sent to **מה נקרא מן המסמך** as if that were a
    different product.
23. As an operator, I want that reading thinner than the old ledger (no clone of every field, bulk
    approve-rest, promote, or reveal), so that this story stays “open the letting,” not “administer
    evidence.”
24. As an operator, I still want the old ledger at its old address for every other door, so that
    full-field work is not destroyed.
25. As an operator, when I stamp the required names and dates, I want the draft Tenancy written at
    that moment, so that approve still means what it means today.
26. As an operator, I want the next screen to be **טיוטה** in this tab — title, people, dates — so
    that the draft is a named arrival, not a teleport.
27. As an operator, I want **טיוטה** to show whether **פרוטוקול מסירה** is missing or present, so
    that “what is still missing to go live” is honest.
28. As an operator, I do not want an activate button on **טיוטה**, so that going live stays the
    Tenancy screen's act.
29. As an operator, I do not want to attach a protocol in this tab in v1, so that this journey stays
    one story.
30. As an operator, when a second lease hits the same Unit and the same start date, I want
    `conflict` named here, with a link to the existing Tenancy, so that we do not join two leases
    into one household.
31. As an operator, I want overlapping live + draft on one Unit to remain allowed, so that a lease
    signed before the current letting ends is not treated as a bug.
32. As an operator, I want **די היום** to offer file another (empty state of this tab), open the
    Tenancy, or open the Unit, so that today can end without inventing a queue.
33. As an operator, I want file-another to reset to beat 1 without destroying the draft I just made,
    so that the pile of paper can continue.
34. As an operator, I want the five beats visible on every screen of this tab as status only, so that
    I cannot skip ahead and cannot unfile by clicking backwards.
35. As an operator, if I leave mid-journey, I want this tab's empty state to be beat 1 again, so that
    this tab does not become a second incomplete queue.
36. As an operator, I want a refresh on **קריאה** to keep me on this tab's URL, so that a reload does
    not dump me into the old ledger.
37. As an operator, I want every other rail item and every old screen unchanged, so that A1, A12,
    A15, addendum confirm, protocol seed, activate, incomplete, and **מסמכים** still work as they
    do today — including A12 still auto-filing on exact one Unit.
38. As a director, I want a clickable paint of the five beats in the live shell before wiring, so
    that copy and sequence are cheap to correct.
39. As an operator, I want the paint and the wired screens in Hebrew, right-to-left, using the
    existing tokens, so that this tab matches the office.
40. As an operator who files from a Unit page, I want that old “add a document” door left alone, so
    that unit-first filing is not this tab's job.

## Implementation Decisions

- **A16 is additive.** New screens, new posts that sequence existing commands, one new rail
  destination. No schema. No new module. No change to A12's auto-file-on-exact-one, A15's ledger, A2's
  draft rule, A5, A6, A11/A13 **screens**, or **מסמכים**.
- **Modules.** Evidence owns the journey. Estate create-Building / create-Unit **commands** are
  reused from this tab when the role holds estate write. Tenancy draft-from-approved-reading is
  unchanged; this tab supplies a new arrival screen after that command. Staff permissions unchanged:
  tab = may file; create-on-step = estate write.
- **Paint first.** One mockup flow in the live shell, five beats, Hebrew, no client script, existing
  tokens. Director clicks. Wire only after that. Delete the paint when the flow is wired.
- **המסמך and הדירה are one step** in the browser: attach stays on the page; the reading of place
  appears there; Continue files. Server still holds nothing between a read that did not file and the
  next post. Create-then-attach-again is the same price as today.
- **קריאה is thin.** Stamps that open the letting (names, dates, required reading). A15 remains the
  full ledger. Reveal, promote, and approve-rest are not rebuilt here.
- **טיוטה reads activation facts** (lease present, protocol missing/present) and does not invoke
  activate.
- **File and OCR ceilings stay.** Larger scans are a later issue, not a second reader in this work.
- **Rail.** Label **תיוק חוזה**, immediately under **מסמכים**, same gate as that tab. Other items
  unmoved.
- **Type locked** to lease at the edge of this journey; the catalogue is not duplicated.

## Testing Decisions

- **Highest seam: HTTP against the new tab.** Sign in, open the tab, post a lease, see place on the
  same step, Continue, stamp, land on **טיוטה**, follow די היום. Assert Hebrew copy, status beats,
  and redirects **do not** go to the old ledger title or the Tenancy page except when the operator
  chooses a link.
- **Reuse existing proofs** for the commands: place reader, file-on-exact-one vs refuse-and-write-
  nothing, draft from approved reading, conflict on same Unit + start, duplicate hash, type guard,
  OCR-too-large, estate-write vs operator on create. Do not re-specify those internals. New tests
  prove **this tab's sequence and that old doors still respond as they do today**.
- **Prior art:** the intake HTTP suite (place from paper, four refusal sentences, nothing stored),
  the documents-tab gate on may-file, the approve-creates-draft suite, chrome dest tests if they
  exist for **מסמכים**.
- **Paint:** only that the mockup is served in the live shell (same bar as the old three-screen
  paint). No domain tests on static HTML.
- **Good test:** one request, one visible outcome (row counts, location, a sentence). No snapshots of
  layout. No tests of stepper internals — only that a future beat is not a working shortcut.

If this seam is wrong (you wanted a narrower command test, or a browser click-through as the gate),
say so before `/to-tickets`.

## Out of Scope

- Filing any type other than a lease in this tab.
- Protocol inside this journey; activate in this journey.
- Changing A12, A15, A1, A5, A6, A11/A13 screens, **מסמכים**, Home, login landing, incomplete queue.
- Raising file or OCR size; a reader for scans above the current ceiling; holding bytes; a queue of
  unfinished filings in this tab.
- Cloning the full ledger (bulk approve-rest, promote, identifier reveal) into this tab.
- Closing or retargeting old doors.

## Further Notes

Grilling 16 Sep 2026, continued from the Uploads-spine session. Confirmed: new tab, frozen else,
lease-only, protocol later, SPEC then paint then tickets, title **תיוק חוזה**, confirm-then-file on
exact one, create-in-tab with estate write, thin **קריאה**, draft born on stamp, **טיוטה** facts
only, no in-tab queue, conflict and duplicate as news here, size left at today's bounds.

A12 still files immediately on exact one. A16 is the journey where the human **sees** that match
first. That difference is the point of the new door, not a silent change to the old one.

## Comment — 2026-09-16

Paint is up for review, before tickets. Dev-only, live shell:

- `/dev/mockups/lease-filing` — empty (המסמך)
- `/dev/mockups/lease-filing-place` — exact one Unit, then Continue
- `/dev/mockups/lease-filing-several` — several + create-in-tab
- `/dev/mockups/lease-filing-reading` — thin קריאה
- `/dev/mockups/lease-filing-draft` — טיוטה + די היום
- `/dev/mockups/lease-filing-large` — too large, same step

Rail item **תיוק חוזה** is not in the chrome yet. The middle is the paint. No wiring.

## Comment — 2026-09-16

Paint pass 2, after the director's review: token excerpt (paper vs our sentence), filing-beats
(five beats), file-well (empty attach). Copy shortened. **די היום** stays a beat of this filing —
quiet until arrival, then the current/done step — not a product teaser. Old screens still untouched.

## Comment — 2026-09-16

Journey wired through #116–#119. Paint deleted; `/dev/mockups/lease-filing*` 404. Old doors unchanged.
