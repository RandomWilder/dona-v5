---
number: 108
title: "Gate misses reach the incomplete-tenancy queue as named rules"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [106]
parent: 99
created: 2026-09-15
closed: 2026-09-15
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

An administrator works one list, not several. A tenancy waiting on a handover protocol is an
incomplete tenancy in exactly the sense the existing queue already means, so it belongs in that queue
rather than in a second one built beside it.

Each failure the activation gate reports surfaces in the existing incomplete-tenancy query as a named
rule — not as prose, and not as a bare count. The name is what lets an administrator tell at a glance
which tenancies are waiting on which document, and sort or scan accordingly. The rule identifiers are
the gate's own, so the queue and the tenancy page never disagree about why a tenancy is not active.

Only misses appear. A tenancy whose gate passes is not incomplete and does not enter the queue.

## Acceptance criteria

- [x] A draft tenancy missing an approved lease appears in the existing incomplete-tenancy queue, with a named rule saying so
- [x] A draft tenancy missing an approved handover protocol appears with its own named rule
- [x] A tenancy blocked only by its start date appears with the rule naming that, distinct from a missing document
- [x] Rule identifiers come from the activation gate; the queue holds no second copy of the rules
- [x] A tenancy whose gate passes does not appear in the queue
- [x] No second queue or list is introduced
- [x] The queue screen is clicked on a running local server before merge

## Blocked by

- #106 — The activation gate, and a tenancy a person activates

## Comment — 2026-09-15

Closed: `39499d8`. Gate misses join `listIncompleteTenancies` as the gate's own rule ids. Queue
clicked on `:3000` (session fetch; Google login blocked the browser tab). Exception write remains
ערב only.
