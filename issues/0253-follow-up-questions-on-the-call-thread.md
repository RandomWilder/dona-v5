---
number: 253
title: Follow-up questions on the Call thread
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [252]
parent: 247
created: 2026-10-16
closed: 2026-10-18
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
- [x] Clicked on staging: two follow-ups from two staff accounts, each showing its asker.

## Comment — 2026-10-17

The question sits under the brief. Two staff accounts on one call each append a turn, and the page shows the names in the order they asked. A question that names another unit on file, or another party's full name, is the record refusal and the model is not called. The golden follow-up cites the bank guarantee; the out-of-bound case is the record sentence with no citation. Both passed. One older building-protocol case missed its phrase on this run. The click is still open: `:3000` is behind Google sign-in, so two live accounts were not typed on the page.

## Comment — 2026-10-18

Closed from the staging click. On call `01a14ab1-1978-7da2-a0b1-9d1d56b98c7f`, one Google session opened the call and posted four follow-ups, then signed out. A second Google account signed in and posted one follow-up, then refreshed the brief. All five follow-ups and the refresh returned 303, and the following page loads returned 200. Nothing in that window was a warning or an error. The request log does not name the role, so admin and viewer are the director's report of the two accounts. Lease-only answers are #254, which this close unblocks. #251 is already closed.

## Blocked by

- #252
