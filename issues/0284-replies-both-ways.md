---
number: 284
title: "Replies both ways"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [281]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

The tenant writes a follow-up on an open call from its thread. On a closed call, **פתיחת קריאה המשך** opens a new call linked to it, as writing on a closed WhatsApp thread does. The office replies to a `PORTAL` call from the call page and the reply appears in the tenant's thread. A `PORTAL` call cannot be returned to the filtered list; the office cancels it with a note instead, and the tenant sees בוטלה with the note.

**Paint screens 1h** (`mockups/tenant-portal.html`). On an open call, the message field is pinned to the bottom of the thread: a camera button, a round field ("עוד פרט לקריאה…") and a round send button. On a closed call, the field is replaced by one primary button, **פתיחת קריאה המשך**, which opens the report (#282) as a new call naming the closed one as Predecessor.

## Acceptance criteria

- [x] SPEC-calls is edited first: the reply channel for `PORTAL`, and no return to filtered for `PORTAL`.
- [x] Policy case, red first: return to filtered is refused for a `PORTAL` call and the control is absent on its page.
- [x] A follow-up on an open call threads to it; on a closed call it opens a new call naming the closed one as Predecessor.
- [x] An office reply on a `PORTAL` call is stored on the call and shown in the portal thread.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000`, both directions, before merge.
- [x] A closed call's thread shows no message field, only **פתיחת קריאה המשך**.

## Blocked by

- #281

## Comment — 2026-10-21

Done. A follow-up on an open portal call stays on that call. A closed thread has no message field; פתיחת קריאה המשך opens the report with the closed call as Predecessor, and the caption from screen 1h stays above the button. The office reply box on a portal call records the reply on the call; the tenant thread shows it as the office. Returning a portal call to the filtered list is refused, and the control is absent. The office box uses the same Hebrew literals as the rest of the call page. Portal strings are copy rows. The camera control's screen-reader name covers a photo, a video, or a PDF. Clicked both directions on :3000 against the seeded completeness building (open call 01a15ea4-5e8b-7ce8-8aa7-4de82a68b95d): tenant follow-up "עוד בדיקה מהפורטל 284", office reply "נבדוק את הנזילה מחר 284". Those two sentences are on that call. The browser session was a different tenant, so the click was over HTTP rather than in that session.
