---
number: 282
title: "Report an issue"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [278, 279]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

A tenant with tenancy access reports an issue: picks a category, describes it in any language, and states whether the office may enter when they are out. Before the first question, the form tells them to phone the duty number for an emergency, with a button that dials it. It becomes a `PORTAL` ServiceCall on their tenancy through the intake door; the category is a suggestion the sorter and the office may change.

**Paint screens 1i–1l** (`mockups/tenant-portal.html`). **The report is three steps and a confirmation**, with a three-part step bar under the top bar. Step 1 ("דיווח על תקלה", with a close button): the emergency card first — what counts as an emergency and a red **התקשרו לכונן** button that is a real `tel:` link to the duty number — then "מה התקלה?" as tiles of the office's active Categories. Step 2 (titled with the chosen category, with a back button): "ספרו לנו מה קרה", one text area with the hint "איפה, ממתי, וכמה זה חמור.", and the attachments from #283. Step 3 ("כמעט סיימנו"): "אפשר להיכנס לדירה כשאתם לא בבית?" as three radio cards — כן, מותר להיכנס / רק בתיאום מראש / לא, רק כשאני בבית — then a summary of category, description, files and flat, then **שליחת הדיווח**. The confirmation ("הדיווח התקבל") shows the call number and category, the reply line from #288 when it is on, **לצפייה בקריאה** and **חזרה לבית**.

## Acceptance criteria

- [ ] SPEC-calls is edited first: the tenant's category is a suggestion; the entry permission is recorded on the call.
- [ ] The duty number shown is the one at `/settings`.
- [ ] An emergency word triggers the same emergency handling as on WhatsApp.
- [ ] A double submit opens one call.
- [ ] The office sees the entry permission and the suggested category on the call page.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000`: the report appears in the office's calls list.
- [ ] The emergency card and its `tel:` link come before the first form field, on step 1.
- [ ] The category tiles are radios built from the active Category list; there is no `<select>`.
- [ ] A step's answers survive going back a step; nothing is a ServiceCall until **שליחת הדיווח**.
- [ ] Each step works without client JavaScript: every step is a server round trip.

## Blocked by

- #278
- #279
