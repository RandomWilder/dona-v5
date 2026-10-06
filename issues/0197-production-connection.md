---
number: 197
title: Production connection: the real mailbox, then the real number
status: open
labels: [ready-for-human]
assignee:
blocked_by: [188, 193]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

Connecting production, in two steps, each with its own go-ahead. First the real shared mailbox: the
app registration in Dona Dom's tenant, admin consent, the RBAC scoping to that one mailbox, the cursor
starting on the connection day. Then the WhatsApp number, after ADR-0013's steps: business
verification, the Tech Provider terms, App Review, the privacy policy on the site, and the coexistence
onboarding on the receptionist's phone, with nothing before that day imported.

Before either: the emergency reply wording approved, the Category list from Dona Dom, the duty number
and hours, the response-goal thresholds, the 6-month retention confirmed, and the OpenAI DPA (F6).
This ticket is configuration and onboarding performed by people; it touches real tenant data and
signs things, so it is the director's.

## Acceptance criteria

- [ ] The real mailbox is read in production and a test email from Dona Dom's side appears in the tab
- [ ] The real number is connected by coexistence and a test message from a staff phone appears in the tab, with the receptionist's reply as an echo
- [ ] Each owed item listed above is recorded as done, with its date, in this file before the step that needs it

## Blocked by

- #188 — Outlook: the staging test mailbox arrives in the tab
- #193 — WhatsApp on Meta's test number
