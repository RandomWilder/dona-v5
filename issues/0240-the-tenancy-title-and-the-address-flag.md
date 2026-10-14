---
number: 240
title: "The tenancy title, and the address flag at activation"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [237]
parent: 232
created: 2026-10-14
closed: 2026-10-14
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

A tenancy is recognisable by its title everywhere it appears. The title is computed on every display and never stored:

`<given and family name of the primary tenant> · <street> <number>, <city> · דירה <unit number> · <start date>`

The primary tenant is the `PRIMARY_TENANT` party, or the first tenant in `tenancy_party` order when there is none. One pure function in the tenancy module computes it; the composition root supplies the name and the address. **שכירויות**, the tenancy page, A16's הטיוטה beat and **ממתינים לפתיחה** use it. Before a tenancy exists, the waiting list shows the name as read.

The activation gate gains one **flag, not a check**. When the tenancy's lease reading names an address and unit number that do not fold to the unit's own, the gate reports both, through its existing injected evidence reader and the cross-check's fold. It does not block activation. It is computed on every read and stored nowhere.

Spec: SPEC-tenancy "A draft opened from an unassigned lease".

## Acceptance criteria

- [x] The title renders in all four places in the stated format. Correcting a party's name changes the title everywhere with no other write.
- [x] With no `PRIMARY_TENANT`, the first tenant's name is used.
- [x] A tenancy opened on a flat that disagrees with the read address shows the flag on the activation gate. Activation is still possible when every check passes.
- [x] Matching addresses: no flag.
- [x] A unit test for the title function; HTTP tests for the flag on the tenancy page.
- [x] Clicked on `:3000`.

## Blocked by

- #237

## Comment — 2026-10-14

The title is computed wherever a letting is named: שכירויות, the tenancy page, A16's הטיוטה beat, and ממתינים לפתיחה. Before a tenancy exists the waiting row uses the name as read. Changing the party's given name changes those titles with no other write. With no primary tenant the first co-tenant is used.

The activation gate reports a flag when the approved lease reading of the address and the flat number do not fold to the unit. It is not a check. A matching address shows nothing. Activation still goes through when every check passes.

Clicked on `:3000` after restart, signed in. שכירויות showed `דנה חסום-107 · רחוב הקריאה 1, עיר קליק · דירה 1 · 2026-01-01`, and that letting's page used the same sentence. The activate button was live. That letting's address agreed with the unit, so no flag was on the page; the disagreeing case is the HTTP test.

Full suite: 1210 passed, plus 41 hook tests. Lint clean.
