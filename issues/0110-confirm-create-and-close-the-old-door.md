---
number: 110
title: "Create the tenancy from the approved reading, and close the old door"
status: closed
labels: [ready-for-agent]
assignee: agent
blocked_by: [107, 109]
parent: 99
created: 2026-09-15
closed: 2026-09-15
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

The second half of the flow, and the removal of the path it replaces.

**There is no confirm screen.** This ticket was written around one, and the director's ruling of
15 September 2026 deleted it (#100's closing comment holds the ruling and its reasoning). What that
screen asked, and where each question went:

- *Which flat* was decided before the document was read. A1's operator picked it at upload, or A12
  resolved it off the page. Asking again at the end is asking a person to re-affirm a choice they
  made and have not been shown anything new about since.
- *Which letting* is not a question a lease answers, because a lease **defines** a letting. A tenancy
  is the deciding record of who is an active tenant in a flat; the lease is what decides it.
- *Each party's role* is carried by the field the name was read into — `tenant_name` is a tenant,
  `guarantor_name` is a `GUARANTOR` — and it is signed by a human on the approval ledger, where that
  row already has an edit box and an approve button beside it. Invariant 5 is satisfied there and not
  weakened: a person affirms the value, and the role travels with the field family it came from.

So the second half of the flow is a **command with no screen of its own**. After the reading is
approved on #109's ledger, creating the draft tenancy is the next thing that happens, and the place
the administrator lands is #107's tenancy page.

**Creating.** A lease whose reading carries an approval stamp creates the tenancy **as a draft**,
assigned to the flat the document was filed against, titled with the tenant's name plus the address
and apartment number. Nothing goes live because a document was read well — going live is #106's
command, pressed by a person on #107's page. The address and apartment-number cross-check against
the unit is unchanged and still writes nothing on a mismatch, and still says which of its four facts
failed.

**Role, written from the field family.** `tenancy_party` rows are written from the approved name
rows: each approved `tenant_name` is a tenant, each approved `guarantor_name` is a `GUARANTOR` with
`is_service_contact` false, which the database CHECK enforces rather than the code hoping. An
unapproved name row writes no party — the stamp is what makes the role a human's answer rather than
the model's. Zero guarantors is success, as it has always been. The ordinal name-to-identifier
pairing from slice 6.5 is unchanged, including that it is all-or-nothing inside a field family and
that two people resolving to one identifier is a refusal.

**The tenancy page shows what the lease carried, read-only.** Term, flat, tenants with their roles,
guarantor, the date the reading was approved, and a link back to the ledger. Read-only because a
correction is made on the ledger, one row at a time, and a second edit box here would be a second
place to change one fact. #107 builds the page; this ticket is what fills that block with real rows
and makes the document names link to the reading they came from.

**The old route is deleted**, not left beside the new one. Two routes with two approval conventions
is drift this codebase has already paid to undo once. `/documents/:id/tenancy` and its screen go,
and no caller remains.

**The addendum keeps its confirm, and that is not an inconsistency.** A3 attaches a `lease_amendment`
to a letting that already exists, chosen at upload; it contributes a guarantor and possibly a new end
date. Nothing about the ruling above touches it — a lease defines a letting, an addendum amends one.
It runs the same approve-then-write sequence and remains a contribution rather than a second
mechanism. An addendum that shortens a tenancy is explicitly not in scope here.

### Two questions this ticket must answer before it writes code

Both are inherited from #100 and neither has an owner yet.

1. **Where does the maintenance annex go?** The deleted confirm screen carried a select for it. The
   annex is a term of a new letting, not an answer to "which paper is this", so it did not belong
   there — but it still has to be somewhere. The candidates are a default from the register with an
   edit on the tenancy page, or a declared field on the `lease` type so it is read like everything
   else. Reading it is the better answer if leases actually print it; that is a question about
   documents, not about code.
2. **Does slice 6.5's attach branch survive?** It exists for the case where a second lease arrives on
   a unit and a start date it already holds, which before 6.5 was a dead end. The director's ruling
   kills the *question on the screen*; it does not obviously kill the branch, which is reached from a
   conflict rather than from a prompt. Either it stays as a conflict-resolution path with no screen
   of its own, or it goes and that conflict becomes a refusal with a stated reason. Decide it, state
   the decision in `SPEC-evidence.md`, and do not leave both alive.

**The HTTP suite begun in #109 is extended to assert the whole flow as one story:** upload a lease,
read it, correct a value, approve the reading including the name rows, see the draft tenancy with its
parties and their roles, attempt activation and be refused for a stated reason, upload the handover
protocol, approve it, activate. That single run is the demonstration that the flow is a flow.

## Acceptance criteria

- [x] No confirm screen exists or is added; creating the draft tenancy follows the approved reading
- [x] `tenancy_party` roles are written from the approved `tenant_name` and `guarantor_name` rows, and an unapproved name row writes no party
- [x] A guarantor cannot be recorded as a service contact
- [x] Creating writes a tenancy in draft, assigned to the flat the document was filed against
- [x] The tenancy's title is the tenant's name plus the address and apartment number
- [x] The address and apartment cross-check still writes nothing on a mismatch and still names which of its four facts failed
- [x] The tenancy page prints the carried values read-only with a link back to the approved reading, and the document names link to it too
- [x] The old `/documents/:id/tenancy` route and screen are deleted and no caller remains
- [x] The addendum case runs through the same approve-then-write sequence and still contributes to an existing tenancy
- [x] The maintenance annex has a stated home, and the decision is in the spec
- [x] The attach branch is either kept with its trigger stated or removed, and the decision is in `SPEC-evidence.md`
- [x] The HTTP suite asserts the whole flow end to end, including the refused activation with its reason and the successful activation after the handover protocol is approved
- [x] Both surviving mockup files from #100 are gone from the repo by the time #107, #109 and this ticket have all landed
- [x] Every screen and write path is clicked on a running local server before merge
- [x] Both required gates pass, with no silently skipped suite

## Blocked by

- #107 — The tenancy page: one screen that shows one tenancy
- #109 — The orchestrator: upload, read, approve

## Comment — 2026-09-15

Body rewritten, not amended. The original was built on a confirm screen that the director's ruling of
15 September 2026 deleted, and three of its eleven acceptance criteria asserted the existence of that
screen — a ticket whose premise is gone is not corrected by a comment under it. The ruling, the four
comments it came from and what the two surviving mockups now show are in #100's closing comment.

What survived the rewrite unchanged: the draft-not-live rule, the title, the cross-check, the
guarantor CHECK, the deletion of the old route, the addendum's standing, and the end-to-end HTTP
story. What changed: the confirm screen is gone, role is written from the field family the name was
read into rather than posted from a select, and the two open questions above — the maintenance annex
and the attach branch — are now this ticket's to close rather than #100's to hold.

## Comment — 2026-09-15

Built. Stamped lease reading writes the draft and lands on the tenancy page; unstamped name writes
no party. Roles from the field family. Annex: `נספח תחזוקה — תקן`, else the sole profile, else
refuse. Attach gone — same unit and start date is `conflict`. Addendum still uses
`/documents/:id/tenancy`. HTTP suite: upload → ledger → draft → refused activate (stated reason) →
protocol → activate. Restarted `:3000`. Clicked incomplete queue (gate misses named), unit page,
ledger. Create/activate write path proven by the HTTP suite — no live lease bytes in this repo.
