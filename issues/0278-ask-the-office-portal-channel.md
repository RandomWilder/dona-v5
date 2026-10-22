---
number: 278
title: "Ask the office, and the PORTAL Source channel"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [273]
parent: 270
created: 2026-10-19
closed: 2026-10-20
---

## Parent

#270 — Tenant portal.

## What to build

Any signed-in tenant — any verified number — can ask the office a question from the portal. It becomes an ordinary ServiceCall with Source channel `PORTAL`, through the same intake door as WhatsApp and email: dedupe, store, emergency check, thread, sort, identify. The tenant sees "received" and the call number at once. A number that resolves to a Party is identified by number with no Tenancy attached; a number that resolves to nobody stays unidentified and is marked as from a verified number. The office sees it in the same calls list, marked `PORTAL`.

**Paint screens 1n** (`mockups/tenant-portal.html`): a close button, the line "השאלה מגיעה לאדם במשרד, ונשמרת עם הקריאות שלכם.", one text area and **שליחה**. The verified non-tenant and the tenant of a building not in the portal reach it from screen 1o's primary button (#279). The paint's topic chips ("נושאים נפוצים. מוגדרים במשרד.") are a design proposal that needs an office-managed list; they are not in this ticket.

## Acceptance criteria

- [x] SPEC-calls and SPEC-channel are edited first: `PORTAL` in the Source channel list, the portal intake, the verified-number mark.
- [x] A migration adds `PORTAL` to the allowed Source channels.
- [x] The submission carries a per-submission idempotency key; submitting the same form twice opens one call.
- [x] An emergency word in the question triggers the same emergency handling as on WhatsApp.
- [x] A verified non-tenant's call shows no tenancy on the office's call page.
- [x] The office calls list and channel tile show `PORTAL` calls like any other channel.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000`: the question appears in the office's calls list.

## Comment — 2026-10-20

A signed-in verified number posts one question. It becomes one ServiceCall on `PORTAL` through the intake door. The same form twice is that same call. An emergency term flags it and the confirmation shows the duty sentence; nothing is sent. A number that is one Party is identified with no tenancy on the page. A number that is nobody stays unidentified and the office page marks it as from a verified number. Call 1769, "בדיקה מהפורטל: יש שריפה במטבח", was the click on `:3000` and is still open.

## Blocked by

- #273
