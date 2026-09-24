---
number: 158
title: "The ready-to-activate queue"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [153]
parent: 152
created: 2026-09-24
closed: 2026-09-24
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

Activation stays a manual press (director, 24 September 2026). So the system says when to press.
חוזים לא שלמים gains a block above its misses: **מוכנות להפעלה** — drafts whose gate passes
today, oldest start first, each linking to its tenancy page — and **נדלקות בקרוב** — drafts whose
only miss is `start_reached` and whose `activatableOn` is within 14 days.

Built from `activationGate`'s own answer, never a second copy of its predicates, the same move #108
made for misses. No party names on the queue; unit, dates, and the date it arms.

A draft ready today and still unpressed tomorrow stays in the block and reads *מוכנה מאז <date>*,
because a missed day is the thing this ticket exists to make visible.

## Screen

Approved on the second look, 24 September 2026. Both blocks are glass cards on חוזים לא שלמים.
Each draft is a raised glass row: unit and address, the dates, and one chip. No party name.
מוכנה מאז uses the accent chip. מוכנה היום uses the occupied chip. נדלקת ב־ uses the neutral chip
with a hollow dot.

## Acceptance criteria

- [x] Both blocks read the gate; no predicate re-derived
- [x] 14 days is one named constant
- [x] No party name on the queue
- [x] Seam test over a seeded draft moving from armed-soon to ready
- [x] SPEC-flows.md A4 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart

## Comment — 2026-09-24

Closed. חוזים לא שלמים lists document-backed drafts from the activation gate: ready today, oldest start first, and arming within 14 days when the only miss is the start. A missed press stays on the block as מוכנה מאז the lease start. No party name. Dev restarted. On `:3000` the draft at רחוב הקריאה 1 reads מוכנה מאז 2026-01-01 and opens its tenancy page, which is where the household name appears. Nothing in the local book arms inside 14 days, so נדלקות בקרוב is empty.
