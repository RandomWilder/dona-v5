---
number: 253
title: Follow-up questions on the Call thread
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [252]
parent: 247
created: 2026-10-16
closed:
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

Under the brief, a staff member can ask the copilot a follow-up question about the call. Each
answer becomes a turn on the same Call thread.

- The thread is shared. Everyone who opens the call sees every turn, and each turn records which
  staff account asked.
- A follow-up uses the same bound and exclusions as the brief (#252). It cites, or it answers with the
  frozen refusal.
- A follow-up may not widen the bound. A question about another tenant or another unit answers with
  the record refusal, not with that record.
- Asking is open to anyone who can read the call. Sending is `calls.reply` (#256).

## Acceptance criteria

- [x] A follow-up appends one turn, recording the asker and the time, and the page shows it in thread order.
- [x] A question outside the bound gets the frozen record refusal. A red-first policy case proves it.
- [x] The full golden set runs, with a new follow-up case and an out-of-bound case.
- [ ] Clicked on `:3000`: two follow-ups from two staff accounts, each showing its asker.

## Comment — 2026-10-17

The question sits under the brief. Two staff accounts on one call each append a turn, and the page shows the names in the order they asked. A question that names another unit on file, or another party's full name, is the record refusal and the model is not called. The golden follow-up cites the bank guarantee; the out-of-bound case is the record sentence with no citation. Both passed. One older building-protocol case missed its phrase on this run. The click is still open: `:3000` is behind Google sign-in, so two live accounts were not typed on the page.

## Blocked by

- #252
