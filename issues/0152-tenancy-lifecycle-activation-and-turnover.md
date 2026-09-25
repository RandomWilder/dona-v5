---
number: 152
title: "Tenancy lifecycle: activation, turnover, and the vacant-to-occupied move"
status: closed
labels: []
assignee:
blocked_by: []
parent:
created: 2026-09-24
closed: 2026-09-25
---

## Problem Statement

An administrator can create a draft tenancy from an approved lease (A2, A16) and activate it on the
tenancy page once the gate passes (A5, #106, #107). Occupancy is derived from an `ACTIVE` letting
whose dates cover today, and nothing stores it. That core is correct and stays.

Around it, the flow has six gaps, found on 24 September 2026 while reading the flow end to end:

1. **Nothing ends a letting early.** Only the register importer writes `TERMINATED_EARLY`,
   `notice_date` or `actual_move_out`. A household that leaves before its contract end stays
   `ACTIVE`, and `one_active_tenancy_per_unit` then refuses the incoming household's activation.
   Turnover — the ordinary case, per SPEC-flows.md's *Tenancy states* — is a dead end.
2. **The block is invisible.** When activation fails on the exclusion constraint the page says the
   tenancy cannot be activated, not which letting is in the way.
3. **Activation depends on memory.** A fully-papered draft whose lease starts next month waits for
   an administrator to come back on that day. Nothing lists what is ready today.
4. **The handover protocol has no door on the path.** A16 explicitly does not file it and the
   tenancy page has no upload. It is filed from מסמכים by someone who knows to anchor it to the
   TENANCY.
5. **Occupancy is binary.** A Unit is vacant or let. Signed-but-not-started, papered-but-waiting,
   and notice-given are invisible on נכסים.
6. **The handover date is never compared to the lease.** The protocol's date may fall outside the
   lease term and nothing says so.

## Decisions (director, 24 September 2026)

- **Activation remains a manual press.** The clock still never writes `ACTIVE`. A queue lists what
  is ready so the day is not missed.
- **The handover protocol is waivable, with a written reason.** A named person records the waiver;
  the gate reports the check as passed-by-waiver and the page and queue show it. This reverses
  #108's "gate misses are not excepted" for this one rule only. `lease`, `start_reached` and
  `within_term` are never waivable.
- **A Unit is occupied from the lease `start_date`**, unchanged. The handover date is recorded and a
  mismatch is a flag, never a gate miss and never a status change.

## Work items

0. [#153](0153-paint-the-tenancy-lifecycle.md) — paint the screens.
1. [#154](0154-end-a-letting-early.md) — end a letting early.
2. [#155](0155-show-the-letting-that-blocks-activation.md) — show the letting that blocks activation.
3. [#156](0156-waive-the-handover-protocol-with-a-reason.md) — waive the protocol with a reason.
4. [#157](0157-file-the-handover-protocol-from-the-tenancy.md) — file the protocol from the tenancy.
5. [#158](0158-ready-to-activate-queue.md) — the ready-to-activate queue.
6. [#159](0159-derived-unit-occupancy-states.md) — derived Unit occupancy states.
7. [#160](0160-handover-date-outside-the-lease-term.md) — handover date outside the lease term.

## Out of scope

A clock that activates. A stored occupancy column. A second copy of the isolation join's day
predicate — every derived state composes on `resolveOccupiedUnits` and the tenancy reads that
already exist.

## Comment — 2026-09-24

[#153](0153-paint-the-tenancy-lifecycle.md) closed. Director approved the paint on `:3000`. Next is [#154](0154-end-a-letting-early.md).

## Comment — 2026-09-24

Second look approved on `:3000`. The screens in #154–#160 use the נכסים glass: glass cards, the same chips, the file well for a protocol, and unit tiles of one size. [#154](0154-end-a-letting-early.md) can start.

## Comment — 2026-09-24

[#155](0155-show-the-letting-that-blocks-activation.md) closed. A draft that overlaps a live letting stays dark and names that letting. Next is [#156](0156-waive-the-handover-protocol-with-a-reason.md).

## Comment — 2026-09-24

[#156](0156-waive-the-handover-protocol-with-a-reason.md) closed. A missing handover protocol can be waived with a reason; the gate passes that check and the page and queue show who recorded it. Next is [#157](0157-file-the-handover-protocol-from-the-tenancy.md).

## Comment — 2026-09-24

[#158](0158-ready-to-activate-queue.md) closed. חוזים לא שלמים names the drafts to press. Next is [#159](0159-derived-unit-occupancy-states.md).

## Comment — 2026-09-25

Closed. All eight children are closed.

- [#153](0153-paint-the-tenancy-lifecycle.md) — paint approved; the paint file is gone now that #154–#160 are wired.
- [#154](0154-end-a-letting-early.md) — an active letting can end early, and the incoming draft then activates.
- [#155](0155-show-the-letting-that-blocks-activation.md) — a blocked draft names the live letting.
- [#156](0156-waive-the-handover-protocol-with-a-reason.md) — a missing protocol can be waived with a reason.
- [#157](0157-file-the-handover-protocol-from-the-tenancy.md) — the protocol is filed from the tenancy page.
- [#158](0158-ready-to-activate-queue.md) — חוזים לא שלמים lists the drafts to press.
- [#159](0159-derived-unit-occupancy-states.md) — four occupancy states, none stored.
- [#160](0160-handover-date-outside-the-lease-term.md) — a handover date outside the lease term is a flag, not a gate.

No next child. A new session does not pick work from here.
