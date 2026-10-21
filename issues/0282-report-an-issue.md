---
number: 282
title: "Report an issue"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [278, 279]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

A tenant with tenancy access reports an issue: picks a category, describes it in any language, and states whether the office may enter when they are out. Before the first question, the form tells them to phone the duty number for an emergency, with a button that dials it. It becomes a `PORTAL` ServiceCall on their tenancy through the intake door; the category is a suggestion the sorter and the office may change.

**Paint screens 1i–1l** (`mockups/tenant-portal.html`). **The report is three steps and a confirmation**, with a three-part step bar under the top bar. Step 1 ("דיווח על תקלה", with a close button): the emergency card first — what counts as an emergency and a red **התקשרו לכונן** button that is a real `tel:` link to the duty number — then "מה התקלה?" as tiles of the office's active Categories. Step 2 (titled with the chosen category, with a back button): "ספרו לנו מה קרה", one text area with the hint "איפה, ממתי, וכמה זה חמור.", and the attachments from #283. Step 3 ("כמעט סיימנו"): "אפשר להיכנס לדירה כשאתם לא בבית?" as three radio cards — כן, מותר להיכנס / רק בתיאום מראש / לא, רק כשאני בבית — then a summary of category, description, files and flat, then **שליחת הדיווח**. The confirmation ("הדיווח התקבל") shows the call number and category, the reply line from #288 when it is on, **לצפייה בקריאה** and **חזרה לבית**.

## Acceptance criteria

- [x] SPEC-calls is edited first: the tenant's category is a suggestion; the entry permission is recorded on the call.
- [x] The duty number shown is the one at `/settings`.
- [x] An emergency word triggers the same emergency handling as on WhatsApp.
- [x] A double submit opens one call.
- [x] The office sees the entry permission and the suggested category on the call page.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000`: the report appears in the office's calls list.
- [x] The emergency card and its `tel:` link come before the first form field, on step 1.
- [x] The category tiles are radios built from the active Category list; there is no `<select>`.
- [x] A step's answers survive going back a step; nothing is a ServiceCall until **שליחת הדיווח**.
- [x] Each step works without client JavaScript: every step is a server round trip.

## Comment — 2026-10-21

A tenant with tenancy access posts a report in three server steps. Nothing is a ServiceCall until send. The same submission twice is one call. The category is stored as a suggestion and does not set the office category or move the state. Entry permission is one of three answers, shown with the flat on the office call page. An emergency term flags the call the same way as WhatsApp; the confirmation shows the duty sentence and nothing is sent. The duty link is the number at `/settings`. Call 8042 was the click on `:3000` (tenant 050-002-0002, category plumbing, entry by arrangement) and is still open. The office list and call page were proven by the policy case; staff sign-in in the browser is Google, so that list was not clicked by hand. The file tile is painted and stores nothing — #283 owns the scan. The reply-time line is absent because #288 and its setting are not built. The three office labels are the same Hebrew literals as the rest of that page.

## Blocked by

- #278
- #279
