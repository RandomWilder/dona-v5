---
number: 154
title: "End a letting early"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [153]
parent: 152
created: 2026-09-24
closed: 2026-09-25
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

A person command, `endTenancyEarly`, the tenth write command in the tenancy module. It takes an
`ACTIVE` letting, an `actual_move_out` date, an optional `notice_date`, the actor, and an optional
source document (a signed notice when there is one; a phone call when there is not — the same
honesty `extended` already has). It moves the status to `TERMINATED_EARLY`, writes the two dates,
and appends a `tenancy_event` of kind `terminated` naming the person. The contractual `end_date` is
**not** moved: SPEC-tenancy.md already says `TERMINATED_EARLY` keeps its contractual end while
`actual_move_out` records reality.

Because `one_active_tenancy_per_unit` is partial on `ACTIVE`, the ended row no longer occupies the
Unit, and the incoming draft can activate. That is the point of the ticket and it is the policy case.

Refusals: not `ACTIVE` is `invalid`; a move-out before `start_date` or after `end_date` is `invalid`
(after the end, the clock ends it); a notice date after the move-out is `invalid`; a missing letting
is `not_found`. `terminated_has_no_document` currently forbids a document on `terminated` — decide in
the spec whether the person kind gets its own kind (`ended_early`) or the constraint is relaxed for a
person actor, and state it. Recommended: a new kind `ended_early`, so the clock's `terminated` keeps
its shape.

On the tenancy page, an `ACTIVE` letting shows a form: move-out date, notice date, optional
document, and a button. `POST /estate/tenancies/:tenancyId/end` behind `tenancy.write`.

The move-out date must be today or earlier. A future move-out is notice, not an end; recording it is
out of scope here and noted on #159.

## Screen

Approved on the second look, 24 September 2026. The form sits in a glass card on the tenancy page.
The household name and the active chip share one line, the way a building title does on נכסים, and
the lease dates sit under them. Move-out and notice are a pair of date fields. The notice letter is
a file field. The button is the primary pill, labelled סיום ההשכרה. The sentence that a future
move-out is notice, not an end, sits under the form in muted type.

## Acceptance criteria

- [x] Policy case, red first: an `ACTIVE` letting blocks an overlapping draft's activation; after
      `endTenancyEarly` the draft activates
- [x] Each refusal has its own reason
- [x] Event appended with the person as actor; UPDATE/DELETE on events still rejected
- [x] Contractual `end_date` unchanged
- [x] SPEC-tenancy.md and SPEC-flows.md edited in the same change
- [x] Clicked on `:3000` after a `dev` restart: end the outgoing, activate the incoming

## Comment — 2026-09-24

`endTenancyEarly` is the tenth write. The event kind is `ended_early`, so the clock's `terminated` still forbids a document. A signed notice is cited; a phone call is not. The contractual `end_date` does not move.

Dev restarted. The local database is not staging and holds two drafts, so the live shell cannot walk an outgoing active letting into an incoming activation. That walk is the policy case, on its own rows, rolled back. The form post is the route test: `TERMINATED_EARLY`, contractual end unchanged. On `:3000` the draft page shows the glass title, name and chip on one line, and no end form. No active letting was inserted to manufacture the click.

## Comment — 2026-09-25

Closed. The local book was given an outgoing active letting and an overlapping draft on רחוב מלאות 22, דירה 1. The draft stayed dark and named that letting by its dates. Ending it from the form, move-out 2026-09-25 and notice 2026-09-01, with no letter, set the status to ended early and left the contractual end at 2026-12-31. The incoming draft then activated and reads live.
