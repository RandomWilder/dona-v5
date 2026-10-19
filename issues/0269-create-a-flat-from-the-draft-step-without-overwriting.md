---
number: 269
title: Creating a flat on פתיחת טיוטה works on staging and never overwrites the estate
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-19
closed: 2026-10-19
---

## Problem Statement

Split out of #268, which was written from the same staging incident on 19 October 2026.

On staging, an admin filing a lease through תיוק חוזה pressed create building and flat on פתיחת
טיוטה, and the press failed with an error page. Three defects sit behind that one press:

1. **Creating a flat from פתיחת טיוטה fails on staging every time.** The building and flat were
   written and committed, and the step after it then rewrote the lease's proposal object in document
   storage. The runtime account may create objects but deliberately may not delete them, and
   replacing an object is a delete, so storage refused it and the press returned 503. Every lease
   filed through תיוק חוזה already has a proposal object, so the press cannot succeed there. The test
   object store allows overwrites, so no test saw it.
2. **Creating a flat at an address that already exists overwrites the existing building and flat.**
   The create path upserts on the address key. A building already held at that address has its
   handover date reset to today, its warranty to two years from today and its project cleared, and an
   existing flat with the same number is reset to one room with no area. On 19 October this write
   committed before the 503, so the real building may already have been changed.
3. **An unexpected error leaves no trace in the application log.** It returns 503 and writes
   nothing, so the cause had to be found in the storage audit log.

## Solution

Creating a building and flat from פתיחת טיוטה works on staging, and never changes a building or flat
that already exists: an existing building at the typed address is used as it is, and an existing flat
with the typed number is selected rather than written. The flat is preselected on פתיחת טיוטה through
the redirect, as it is today, and no stored object is rewritten.

An unexpected error writes one log line naming its cause, with no personal data in it.

## User Stories

1. As an admin, I want creating a building and flat from פתיחת טיוטה to succeed on staging, so that
   a lease at a new address can be opened.
2. As an admin, I want creating a flat at an address that already exists to leave that building's
   handover date, warranty, project and status unchanged, so that a filing press never rewrites the
   estate.
3. As an admin, I want creating a flat whose number already exists in that building to select the
   existing flat, so that I never reset its rooms, area or ממ"ד.
4. As an admin, I want the flat I just created to be preselected on פתיחת טיוטה, as it is today, so
   that the next press opens the draft.
5. As an operator, I want an unexpected error to write one log line with its code and cause, so that
   the next 503 can be explained from the application log alone.
6. As an operator, I want that log line to omit request bodies and database detail text, so that a
   tenant's data never reaches the log.
7. As a developer, I want the test object store to refuse replacing an existing object, as staging
   does, so that a test catches the next overwrite before staging does.

## Implementation Decisions

- **The create-flat press no longer rewrites the proposal object.** The redirect after creating
  already carries the new flat id, and that is the preselection. The helper that rewrote the object
  is removed. Document storage is create-only for the runtime account, and the object-store contract
  says so: writing a path that exists fails.
- **The memory object store refuses to write a path that exists**, with the same error kind the cloud
  store raises (`unavailable`), so that tests behave as staging does.
- **The create-flat press looks up the typed address first**, by the same address key the unique
  index uses. If a building exists there, its held facts are used and never rewritten. If a flat with
  the typed number exists in it, nothing is written and the press redirects with that flat's id.
  Otherwise it creates as today.
- **The application error handler** writes one log line for an `unavailable` outcome: the kernel
  error's code, message and details, or for any other error its name, database error code and
  constraint name. Never the database detail text, which can quote row values, and never the request
  body.
- **Spec first.** The evidence spec's place section and the flows spec's A2 flat bullet say that
  creating a flat never changes an existing building or flat and does not rewrite the proposal.

## Testing Decisions

- **One seam: the filing routes in the evidence module, through the app with the memory object store
  and a real database**, the seam the existing lease-filing test uses. The object-store contract gets
  its own case at the kernel object-store seam.
- **Cases, each red first:**
  - Create-flat on a lease filed through תיוק חוזה succeeds against the create-only memory store.
  - Create-flat at an address with an existing building, without naming it: the building's
    handover, warranty and project are unchanged, and the flat is created in it.
  - Create-flat with a flat number that exists: no write, redirect with the existing flat id, its
    rooms and area unchanged.
  - The memory object store refuses a second write to the same path.
- Prior art: the lease-filing route test and the kernel object-store test.

## Out of Scope

- Repairing the staging building at הרב קוק 50, בית שמש if the 19 October press overwrote it. That is
  real pilot data and is the director's decision; the check is read-only first.
- Granting the runtime account delete permission on document storage. Create-only is deliberate.

## Further Notes

- Evidence from staging, 19 October 2026, document `01a14846-54d0-770d-945e-9c9daddfa98b`: the
  create-flat press at 05:06:25 returned 503 in 0.32 s; no database error at that time; the storage
  audit log shows the object create refused for lack of delete permission on the lease's proposal
  object in the same second.
