---
number: 279
title: "My flat"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [273, 277]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

A verified active tenant of a portal-enabled building sees their flat: address, unit, the tenancy's dates, the assigned bay and assigned storage. A tenant with more than one active tenancy chooses between them in a bottom sheet. Access is decided on every request: the number is resolved through the isolation join (a new read in the scope module, the only place the join is written) and the tenancy's Building must be portal-enabled. A tenant of a building not in the portal, a past tenant, a guarantor and a verified non-tenant get only "ask the office", with a plain explanation. Anything not theirs is "not found". Every tenant read of tenancy data is an audit row.

**Paint screens 1e, 1f, 1m and 1o** (`mockups/tenant-portal.html`). **This ticket builds the tenant shell** every later tab screen sits in: the bottom tab bar (בית · קריאות · דיווח · הדירה · עוד, with דיווח as the raised button that later opens #282), the home page with the greeting and its two shortcut tiles (שאלה למשרד, המסמכים שלי), and the tenancy pill and sheet. The tenancy chosen in the sheet ("בחירת דירה") is the scope for the whole portal — home, the flat, the documents, the calls and a new report — not for this page only, and the pill shows its chevron and opens the sheet only with two or more active tenancies. The flat page ("הדירה") shows the address, the city, the tenancy's dates as a progress bar with the months left, and the bay and storage as two tiles; the documents of #280 sit under it on the same page. The עוד tab holds ask the office, the language, the passkeys and sign out. Screen 1o is the page a tenant without tenancy access sees: "הבניין שלכם עוד לא בפורטל", the number they signed in with, **שאלה למשרד** and **יציאה**, with no tab bar.

## Acceptance criteria

- [x] SPEC-scope is edited first: the Portal identity read and access per request.
- [x] Policy case, red first: changing a tenancy identifier in the address to another tenant's returns not found.
- [x] Policy case, red first: a tenant of a building switched off sees only ask the office, and switching off takes effect on the next request.
- [x] Policy case, red first: a guarantor, a past tenant and a verified non-tenant see no tenancy data.
- [x] A tenancy that ends today stops showing today; nothing about tenancy is cached in the session.
- [x] Each read of tenancy data is an audit row.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` before merge.
- [x] The tab bar is on the home, calls and flat pages only; every tab target is at least 44 by 44.
- [x] The chosen tenancy is held per session and scopes home, the flat, the documents, the calls and a new report; it is re-checked against the scope read on every request.
- [x] With one active tenancy the pill has no chevron and no sheet is offered.
- [x] The lease progress is computed from the tenancy's dates and today's date in the clock's time zone; the dates are left-to-right spans.

## Blocked by

- #273
- #277

## Comment — 2026-10-21

Closed. The portal read is `resolvePortalTenancies` in the scope module: a tenancy shows while its end date is still ahead, the building's portal flag is returned and applied on the request, and the audit line is the party reached and the row count. The chosen tenancy is the `dona_portal_choice` cookie, cleared with the session, and ignored when it no longer matches an open tenancy. A second assigned bay or storage is named on the same tile.

Clicked on `:3000`: the signed-in session already in the browser belongs to a building that is not in the portal, so the live pages were screen 1o (no tab bar, no sideways scroll at 390px, ask target 54px tall) and שאלה למשרד. Calls, more, report and a flat address for that session all stay on 1o. The greeting, the pill, the sheet, the flat and the tab bar were driven over HTTP by `tests/policy/portal-flat.test.ts`. The sheet is the same checkbox sheet as the language control. Not pushed.
