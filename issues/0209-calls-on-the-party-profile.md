---
number: 209
title: The calls a party opened, on its profile
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [202]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

The profile lists the calls this party opened — those naming it as requester — newest first, each
showing its date, category, state and emergency mark and linking to the call. The read is a new
function on the calls contract, composed into the profile at the composition root; the calls module
already depends on parties, so parties does not depend back.

Whether the requester column needs an index is decided by a measurement against the generated
portfolio's volume of calls, recorded in SPEC-calls with the numbers, as SPEC-parties records its
contact-index measurement. An index the planner will not choose is not added.

## Acceptance criteria

- [x] The profile lists the party's calls newest first, each linked to its call page, showing date, category, state and the emergency mark.
- [x] A party who opened no call shows that it has none.
- [x] Calls where the party is not the requester do not appear.
- [x] The read lives on the calls contract; the parties module gains no dependency.
- [x] The index decision is measured and written into SPEC-calls with the plan and timings, whichever way it goes.
- [x] Route tests cover a party with calls, one with none, and ordering.
- [x] The calls section is removed from the mockup; if this is the last wiring ticket to finish, the mockup file is deleted. Clicked on `:3000`.

## Comment — 2026-10-11

Closed. The profile lists the calls that name this party as requester, newest first, each linked to its call, with the day, the category or that none is set, the state, and the emergency mark. A party who opened none is told so. A call naming someone else, and a call naming nobody, stay off the page. The read is on the calls contract. Parties does not import calls. At one call for each of the 2,908 parties the generated portfolio holds, the planner chose a btree on the requester, so the partial index was added and the plan and timings are in SPEC-calls. The mockup file was already gone when #207 closed, and this was the last wiring ticket, so that deletion stands. On the restarted server at `:3000`, signed in, one profile listed its call and the link opened that call, and another profile said there were none.

## Blocked by

- #202 — the tab and the profile exist.
