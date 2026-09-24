---
number: 155
title: "Show the letting that blocks activation"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [154]
parent: 152
created: 2026-09-24
closed: 2026-09-24
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

Today a draft that overlaps a live letting shows a lit button, and the press fails on the database's
exclusion constraint with a generic sentence. The gate should know first.

Add a fifth check to `activationGate`: `unit_free` — no other `ACTIVE` letting on this Unit whose
range overlaps this draft's range. The gate returns the blocking letting's id and dates, never a
party. The page prints it as one more row in *מה נבדק*: the outgoing letting's dates, a link to it,
and — when the reader holds `tenancy.write` — a link to its end-early form (#154).

The exclusion constraint stays as the enforcement; the check is what makes the refusal legible.
`unit_free` is not waivable.

## Screen

Approved on the second look, 24 September 2026. `unit_free` is one more row in מה נבדק, the same
shape as the other checks. A pass uses the occupied chip (solid dot). A miss uses the alert chip.
The row names the outgoing letting by its dates only, with פתיחה and, for a writer, סיום מוקדם.
The activate button stays the primary pill and stays dark, with the unmet requirements in muted
type beside it.

## Comment — 2026-09-24

`unit_free` is the fifth check. A miss names the other active letting by id and dates only. The page links to it, and a writer also gets the end-early form. The exclusion constraint is still what rejects a promotion that skips the gate.

Dev restarted. The local database holds two drafts and no active letting, so the miss row is not on `:3000`. Both drafts show the occupied chip on הדירה פנויה בתקופה, and the activate button stays the dark primary while another check fails. The overlap, the links, and the dark button are the policy case and the page test. No active letting was inserted to manufacture the click.

## Acceptance criteria

- [x] Gate returns `unit_free` with its outcome, passes included; the blocking letting is named by id
      and dates only
- [x] Policy case, red first, asserting the check against a seeded overlap
- [x] Button stays dark while blocked; page links to the blocking letting
- [x] The database constraint is unchanged
- [x] SPEC-flows.md A5 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart
