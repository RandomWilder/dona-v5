---
number: 107
title: "The tenancy page: one screen that shows one tenancy"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [100, 106]
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

There is no screen in this system that shows a single tenancy. An administrator who wants to know
what state a tenancy is in has nowhere to look. This ticket builds that place.

A tenancy has a page of its own, reached by its identifier. It states:

- the title — the tenant's name plus the address and apartment number, the same string that lets an
  administrator recognise it in a list without opening it;
- the status;
- the lease's dates;
- the documents the tenancy holds;
- what it is still missing;
- what was checked and passed, not only what failed;
- the activate button.

The button is dark until the gate passes. When it is dark, every requirement the gate checked is
named beside it with its outcome, so the button is explained rather than merely disabled. When the
only thing standing between the tenancy and activation is time, the page states the date the button
arms. Pressing the button activates the tenancy — a person does it, never the clock.

The page is built from the gate's returned facts rather than from a second reading of the same rules;
the screen, the queue and the policy case all read one answer.

The screen is drawn from the approved mockup, and the mockup file is deleted once this is wired. It
is server-rendered, Hebrew and right-to-left, with no client-side scripting. It is appended to the
existing screen registry rather than given a guard of its own, which is what asserts it carries no
hard-coded colour, no physical side, no script, and no tenant name reaching the markup by an
unintended path. Party names appear on the page with no new permission gate; a gate is a later change
that does not redraw the screen.

Clicked on a running local server before merge — including the refusal path and the activation press.

## Acceptance criteria

- [x] A tenancy is reachable at its own page by identifier
- [x] The page shows title, status, lease dates, documents held, what is missing, and what passed
- [x] The activate button is dark until the gate passes, and every checked requirement is named beside it with its outcome
- [x] A tenancy blocked only by its start date shows the date the button arms
- [x] Pressing the button activates the tenancy; nothing else does
- [x] The page reads the gate's returned facts rather than re-deriving the rules
- [x] The screen is appended to the existing screen registry and passes its guard
- [x] The screen is Hebrew, right-to-left, server-rendered, with no client-side scripting
- [x] The tenancy-page mockup file is deleted
- [ ] Both the refusal path and the activation press are clicked on a running local server before merge

## Blocked by

- #100 — Paint the three screens of the document-upload flow
- #106 — The activation gate, and a tenancy a person activates
