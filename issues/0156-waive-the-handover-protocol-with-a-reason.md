---
number: 156
title: "Waive the handover protocol with a reason"
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

The director ruled on 24 September 2026 that the handover protocol may be waived for one letting,
with a written reason, by a named person. Typical cases: the same household signing a new lease on
the same flat, and a letting loaded from the register whose protocol predates the system.

Reuse `tenancy_completeness_exception`: widen its `rule` CHECK from `guarantor` to
`guarantor · handover_protocol` (migration). The gate reads that row and reports the
`handover_protocol` check as `passed: true, waived: { actor, at, reason }`. Nothing else is
waivable: `lease`, `start_reached`, `within_term` and `unit_free` (#155) refuse a waiver, and the
CHECK is the enforcement, not the form.

On the tenancy page, the protocol row shows *ויתור* with the reason and who recorded it; while it
is missing, the row carries the reason field and a *רשום ויתור* button (`tenancy.write`). The
waiver is visible on the A4 queue as the row's resolution, and the completeness query stops listing
the miss.

This amends #108's sentence that gate misses are not excepted; the spec says so and names this
issue.

## Screen

Approved on the second look, 24 September 2026. While the protocol is missing, the reason field
and רשום ויתור sit under the upload, inside that same check row. The button is the small secondary
pill. After a waiver the chip reads ויתור: the neutral chip, hollow dot. The line under it is the
reason, who recorded it, and the date.

## Acceptance criteria

- [x] Migration widens the CHECK; nothing else in the table changes
- [x] Policy case, red first: a waived protocol passes the gate; a waiver of `lease` is refused by the
      database
- [x] Reason required, actor recorded, clock-stamped
- [x] Page and queue show the waiver and who recorded it
- [x] SPEC-tenancy.md and SPEC-flows.md A4/A5 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart

## Comment — 2026-09-24

Closed. The CHECK now allows `handover_protocol` and still refuses `lease`, `start_reached`, `within_term` and `unit_free`. A waived protocol passes the gate and names who, when, and why. Dev restarted. Google login blocked the browser tab; the restarted server was driven with a session. The draft on בניין קליק that had no protocol showed רשום ויתור; posting it recorded the waiver. The page reads ויתור with the reason, `dev@dona.local`, and 2026-09-24, and the activate button is live. The incomplete queue no longer lists that protocol miss; the row that remains (the guarantor) shows the waiver. The upload above the form is #157 and is not on this page yet.
