---
number: 110
title: "Confirm, create the tenancy, and close the old door"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [107, 109]
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

The second half of the flow, and the removal of the path it replaces.

After approving the values, the administrator confirms three things and nothing else: which flat,
which letting, and each party's role. A correctly-read document must never be attached to the wrong
place, which is why the flat is confirmed rather than assumed. Roles are set from the start, so
tenants, guarantors and service contacts are distinguished; a guarantor is never a service contact,
so that the person who guaranteed the contract is never contacted as though they lived there.

Confirming creates the tenancy **as a draft**. Nothing goes live merely because a document was read
well — going live is #106's command, pressed by a person on #107's page. The tenancy is titled with
the tenant's name plus the address and apartment number, and is assigned to the flat it was confirmed
against.

The old route that created a tenancy from a document is **deleted**, not left beside the new one. Two
routes with two approval conventions is drift this codebase has already paid to undo once. The
addendum case moves onto the same sequence with it, remaining a contribution to a tenancy rather than
becoming a second mechanism. An addendum that shortens a tenancy is explicitly not in scope here.

The confirm screen is redrawn from the approved mockup — flat, letting and roles, nothing competing —
and its mockup file is deleted once wired. It joins the screen registry.

The HTTP suite begun in #109 is extended to assert the whole flow as one story: upload a lease,
read it, correct a value, approve, confirm the flat and roles, see the draft tenancy, attempt
activation and be refused for a stated reason, upload the handover protocol, approve it, activate.
That single run is the demonstration that the flow is a flow.

## Acceptance criteria

- [ ] The confirm screen presents flat, letting and party roles, and nothing else
- [ ] A guarantor cannot be recorded as a service contact
- [ ] Confirming creates a tenancy in draft, assigned to the confirmed flat
- [ ] The tenancy's title is the tenant's name plus the address and apartment number
- [ ] The old document-to-tenancy route is deleted and no caller remains
- [ ] The addendum case runs through the new sequence and still contributes to an existing tenancy
- [ ] The confirm-screen mockup is deleted; the screen is in the registry and passes its guard
- [ ] The HTTP suite asserts the whole flow end to end, including the refused activation with its reason and the successful activation after the handover protocol is approved
- [ ] All three mockup files from #100 are now gone from the repo
- [ ] Every screen and write path is clicked on a running local server before merge
- [ ] Both required gates pass, with no silently skipped suite

## Blocked by

- #107 — The tenancy page: one screen that shows one tenancy
- #109 — The orchestrator: upload, read, approve
