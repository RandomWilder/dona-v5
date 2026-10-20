---
number: 277
title: "Building portal switch"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [276]
parent: 270
created: 2026-10-19
closed: 2026-10-20
---

## Parent

#270 — Tenant portal.

## What to build

An administrator switches a Building into the portal, or out of it, from the Building's page. The switch needs a new staff permission and every change is an audit row. It refuses to turn on while any current legal text in any portal language is a placeholder, and says which. It is read on every tenant request, so switching off takes effect on the tenant's next request.

## Acceptance criteria

- [x] SPEC-estate (or the module that owns Building) and SPEC-staff are edited first.
- [x] A staff account without the new permission sees the switch's state but cannot change it.
- [x] Turning on with any placeholder text is refused with a message naming the text and language; nothing is written.
- [x] Policy case, red first: the switch command refuses while a placeholder exists.
- [x] Each change is an audit row with who and when.
- [x] Clicked on `:3000` before merge.

## Blocked by

- #276

## Comment — 2026-10-20

The switch is on the נכסים building page. It starts off. An administrator can change it; anyone else who can open the page sees the same state and a post is refused. Turning it on while a current legal text is still a placeholder names that text and its language and writes nothing. Once every current text has a later version that is not a placeholder, turning it on and turning it off each write an audit row with who and when. The flag is a column on the building. It is not stored on the tenant session. The tenant page that reads it on each request is #279. On :3000, בניין רקפת 12 שוהם showed the switch off, listed the twelve placeholder texts, and stayed off after save.
