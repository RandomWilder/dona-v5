---
number: 153
title: "Paint the tenancy lifecycle screens"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 152
created: 2026-09-24
closed: 2026-09-24
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

`mockups/tenancy-lifecycle.html`, served at `/dev/mockups/tenancy-lifecycle`, in the live shell. It
paints what #154–#160 will wire, so the director clicks the whole lifecycle before any of it exists:

- the tenancy page of an `ACTIVE` letting with the end-early form (#154);
- a `DRAFT` whose activation is blocked by that outgoing letting, naming it (#155);
- a `DRAFT` missing its protocol, with the upload door (#157) and the waiver form (#156);
- the same draft after a waiver, the check reading as passed-by-waiver;
- the ready-to-activate block on חוזים לא שלמים (#158);
- the four Unit states as chips on a נכסים row (#159);
- the handover-date flag (#160).

Every value is invented. The file is deleted when the last of #154–#160 is wired.

## Acceptance criteria

- [x] Paint served at `/dev/mockups/tenancy-lifecycle` after a `dev` restart
- [x] Every state above is on the page
- [x] Director has clicked it and commented

## Comment — 2026-09-24

Director reviewed `http://127.0.0.1:3000/dev/mockups/tenancy-lifecycle` and approved the paint. Every state listed above is on that page. The file stays until the last of #154–#160 is wired.

## Comment — 2026-09-24

Second look approved, after the paint was redrawn in the נכסים glass. Director confirmed the unit tiles as well: every card is one size, including a unit with nothing under its name, so a full grid stays even. That look is the screen instruction on #154–#160.

## Comment — 2026-09-25

Paint deleted. #154–#160 are wired, so `mockups/tenancy-lifecycle.html` is gone.
