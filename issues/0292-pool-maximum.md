---
number: 292
title: The database pool has a stated maximum
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 289
created: 2026-10-22
closed: 2026-10-22
---

## Parent

#289 — Staging portal service.

## What to build

The pool sets no maximum, so each instance may open the driver's default of 10 connections. The
staging Cloud SQL instance (`db-f1-micro`) allows about 25, and the office alone can reach 30 at
three instances. After this ticket the pool reads its maximum from the environment, defaulting to 5.
A value that is present but not a positive whole number stops the process at boot with `invalid`,
the same way a missing database URL does. The staging connection budget is then 3 × 5 for the office
plus 1 × 5 for the portal, which leaves room under the limit for the migration and sweep jobs.

SPEC-kernel's database section is edited first. It names the variable, the default and the refusal.

## Acceptance criteria

- [x] SPEC-kernel names the variable, the default of 5 and the refusal, in the same change and before the code.
- [x] Through `createPool(env)`: the default is 5, and a set value is used.
- [x] Zero, a negative number, a fraction and a word are each refused as `invalid` before any connection is attempted.
- [x] `.env.example` names the variable, commented, with its default.
- [x] `npm run dev` still starts with nothing set, and `/health` reports `db:up`.

## Comment — 2026-10-22

`DATABASE_POOL_MAX` is named in SPEC-kernel before the pool reads it. Absent, the maximum is 5. `0`, `-1`, `1.5` and `many` each stop boot with `invalid`, and no pool is built. `.env.example` comments the variable at 5. A server started with nothing set answered `/health` with `db:up`. Full suite: 1391 pass, hooks 41 pass. One earlier full run failed `hidden-flow` on a link the expiring page did not draw; the same test passed alone, and the next full run was green.

## Blocked by

- None (can start immediately).
