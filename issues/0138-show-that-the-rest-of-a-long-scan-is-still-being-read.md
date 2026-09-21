---
number: 138
title: "Show that the rest of a long scan is still being read"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent:
created: 2026-09-22
closed: 2026-09-22
---

## What is wrong

A long lease files on the first fifteen pages and then keeps reading on the work queue. Beat 3 already
prints `15 מתוך 38`. It does not say whether that remainder is still running, so an operator sitting
on תיוק חוזה cannot tell a healthy wait from a freeze.

## What should happen

While extract work for that document is still open and the two counts differ, beat 3's coverage chip
says the reading is continuing, shows a loader, and the empty reading refreshes itself until either
the fields arrive or the work row is done. A shortfall whose work has finished stays a count, with no
loader and no refresh — that is a stopped partial, not a wait. Once any extracted row is on the
screen, the page does not refresh (the operator may be stamping).

No live progress bar. The count still only moves when a slice finishes.

## Acceptance

- [x] `15 מתוך 38` with open extract work and no rows yet: loader, "הקריאה ממשיכה", auto-refresh
- [x] Same shortfall after the work row is done: count only
- [x] Rows already listed: no auto-refresh even if work is still open
- [x] Spec names this; `test:policy` and `npm test` stay green

## Comment — 2026-09-22

Closed. Beat 3 coverage chip grows a loader while `scheduled_work` for `extract:<id>` is still open.
The empty reading refreshes every eight seconds. A finished shortfall stays a count. No refresh once
rows are listed.
