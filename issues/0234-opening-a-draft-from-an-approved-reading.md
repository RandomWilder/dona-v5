---
number: 234
title: "פתיחת טיוטה opens the draft from an approved reading"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 232
created: 2026-10-14
closed: 2026-10-14
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

Approving a reading row only stamps it. The draft tenancy is no longer written as a side effect of the approval that makes the reading ready. Instead, when the reading is ready, A16's הקריאה step shows a **פתיחת טיוטה** button. When it is not ready, the step lists exactly which rows are still missing (main tenant name, start date, end date, every name row of every role).

Pressing it opens a screen that shows, before anything is written:
- the flat the lease is filed on (in this ticket, still the flat it was filed on at upload; #237 moves the choice of flat onto this screen);
- the terms profile, a select preselected by the existing rule (`נספח תחזוקה — תקן`, or the sole profile);
- each person and the role they will hold;
- every reason the press would be refused, each as a Hebrew sentence.

An empty terms-profile register disables the button with a sentence saying so.

The press is one post and one transaction. It writes:
- the `DRAFT` tenancy;
- the document's `TENANCY` link;
- the signed dates, and every approved mapped field carried;
- the parties: `upsertParty` on a printed ת.ז., otherwise `createParty`;
- the `tenancy_party` rows, with a guarantor never a service contact;
- the `SIGNATORY` links.

The existing (unit, start date) refusal stands. Any refusal writes nothing and re-renders the screen with its sentence. After the press, the tab arrives at הטיוטה as today.

This fixes the 14 Oct failure at its root: the draft write no longer follows a committed stamp, so there is no longer a state of "all approved, no draft, nothing to press". The lease stuck on staging (`01a13956`) is filed on a flat and becomes openable with this ticket alone.

Spec: SPEC-flows A2 and A16 as amended at #232; SPEC-tenancy "A draft opened from an unassigned lease".

## Acceptance criteria

- [x] Approving any row on A16 or A15 writes only the stamp. No tenancy, party or link appears, even when the reading becomes ready.
- [x] הקריאה lists the missing rows while the reading is not ready, and shows **פתיחת טיוטה** once it is.
- [x] The opening screen shows the flat, the preselected terms profile, the people with their roles, and any refusal, before the press.
- [x] No terms profile in the register: the button is disabled and the screen says why. Nothing is posted.
- [x] The press writes the draft, the links, the dates and carried fields, the parties and their roles in one transaction. A forced failure part-way leaves no row behind.
- [x] (unit, start date) already taken: refused with the existing sentence and a link to that tenancy. Nothing is written.
- [x] Two people resolving to one ת.ז.: refused with a sentence. Nothing is written.
- [x] HTTP tests at the A16 seam cover ready, not ready, no profile, success, and both refusals. The existing A16 and lease suites are updated where they assumed approve-writes-draft.
- [ ] Clicked on `:3000` with a fixture lease. After deploy, the director opens `01a13956` on staging (after the PR RandomWilder/dona-v5#136 seed has run).

## Blocked by

None (can start immediately).

## Closing notes

- The last criterion is half done: clicked locally on a fixture lease (on :3001, because :3000 was another session's server on pre-change code). Opening `01a13956` on staging is the director's, after deploy and the RandomWilder/dona-v5#136 seed.
- The read address no longer refuses the press. SPEC-flows A2 as amended at #232 strikes that refusal, and `01a13956` had to open with this ticket alone. The disagreement is shown beside the flat on the screen; the activation-gate flag is #240.
- Readiness keeps one exception the ticket's wording did not: a `main_tenant_name` read twice needs one signed capture, not both (now in SPEC-flows A16). Signing the twin would have written two primary tenants for one person, and nothing dismisses a row.
- "The reading closes at opening" is #239's. An approval on a lease that already has a draft still carries its mapped field, as #232 says.
