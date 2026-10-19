---
number: 284
title: "Replies both ways"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [281]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

The tenant writes a follow-up on an open call from its thread. On a closed call, **פתיחת קריאה המשך** opens a new call linked to it, as writing on a closed WhatsApp thread does. The office replies to a `PORTAL` call from the call page and the reply appears in the tenant's thread. A `PORTAL` call cannot be returned to the filtered list; the office cancels it with a note instead, and the tenant sees בוטלה with the note.

**Paint screens 1h** (`mockups/tenant-portal.html`). On an open call, the message field is pinned to the bottom of the thread: a camera button, a round field ("עוד פרט לקריאה…") and a round send button. On a closed call, the field is replaced by one primary button, **פתיחת קריאה המשך**, which opens the report (#282) as a new call naming the closed one as Predecessor.

## Acceptance criteria

- [ ] SPEC-calls is edited first: the reply channel for `PORTAL`, and no return to filtered for `PORTAL`.
- [ ] Policy case, red first: return to filtered is refused for a `PORTAL` call and the control is absent on its page.
- [ ] A follow-up on an open call threads to it; on a closed call it opens a new call naming the closed one as Predecessor.
- [ ] An office reply on a `PORTAL` call is stored on the call and shown in the portal thread.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000`, both directions, before merge.
- [ ] A closed call's thread shows no message field, only **פתיחת קריאה המשך**.

## Blocked by

- #281
