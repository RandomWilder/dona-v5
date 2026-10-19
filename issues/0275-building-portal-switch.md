---
number: 275
title: "Building portal switch"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [274]
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

An administrator switches a Building into the portal, or out of it, from the Building's page. The switch needs a new staff permission and every change is an audit row. It refuses to turn on while any current legal text in any portal language is a placeholder, and says which. It is read on every tenant request, so switching off takes effect on the tenant's next request.

## Acceptance criteria

- [ ] SPEC-estate (or the module that owns Building) and SPEC-staff are edited first.
- [ ] A staff account without the new permission sees the switch's state but cannot change it.
- [ ] Turning on with any placeholder text is refused with a message naming the text and language; nothing is written.
- [ ] Policy case, red first: the switch command refuses while a placeholder exists.
- [ ] Each change is an audit row with who and when.
- [ ] Clicked on `:3000` before merge.

## Blocked by

- #274
