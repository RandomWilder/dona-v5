---
number: 276
title: "Ask the office, and the PORTAL Source channel"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [271]
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

Any signed-in tenant — any verified number — can ask the office a question from the portal. It becomes an ordinary ServiceCall with Source channel `PORTAL`, through the same intake door as WhatsApp and email: dedupe, store, emergency check, thread, sort, identify. The tenant sees "received" and the call number at once. A number that resolves to a Party is identified by number with no Tenancy attached; a number that resolves to nobody stays unidentified and is marked as from a verified number. The office sees it in the same calls list, marked `PORTAL`.

**Paint screens 1n** (`mockups/tenant-portal.html`): a close button, the line "השאלה מגיעה לאדם במשרד, ונשמרת עם הקריאות שלכם.", one text area and **שליחה**. The verified non-tenant and the tenant of a building not in the portal reach it from screen 1o's primary button (#277). The paint's topic chips ("נושאים נפוצים. מוגדרים במשרד.") are a design proposal that needs an office-managed list; they are not in this ticket.

## Acceptance criteria

- [ ] SPEC-calls and SPEC-channel are edited first: `PORTAL` in the Source channel list, the portal intake, the verified-number mark.
- [ ] A migration adds `PORTAL` to the allowed Source channels.
- [ ] The submission carries a per-submission idempotency key; submitting the same form twice opens one call.
- [ ] An emergency word in the question triggers the same emergency handling as on WhatsApp.
- [ ] A verified non-tenant's call shows no tenancy on the office's call page.
- [ ] The office calls list and channel tile show `PORTAL` calls like any other channel.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000`: the question appears in the office's calls list.

## Blocked by

- #271
