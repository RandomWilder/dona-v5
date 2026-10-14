---
number: 236
title: "Same-name candidates and the same-lease check at opening"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed:
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

Two checks on פתיחת טיוטה protect against merging the wrong people and creating the same tenancy twice.

**Same-name candidates.** A person with no match by ת.ז., phone or email, whose given and family names equal those of existing parties, is shown with those parties as candidates: "same person?". The default is a new party. Only an explicit choice by the operator links the person to an existing party, and the link then goes through the same contact-overlap refusal as everything else. The system never matches a name on its own.

**The same lease, rescanned.** Before writing, the screen looks for any tenancy holding a party with the same `national_id_key` and the same start date. On a hit, it shows that tenancy with a link and a choice:
- attach this lease to it: the `TENANCY` and `EVIDENCE` links only, no party writes;
- or open a new draft anyway.

The byte-level duplicate refusal at upload is unchanged.

Spec: SPEC-flows A2 steps 5 and 6 as amended; SPEC-parties "Contacts from a lease".

## Acceptance criteria

- [ ] An existing party with the same given and family name and no other match is shown as a candidate. Pressing open without choosing creates a new party.
- [ ] Choosing the candidate attaches the person to that party, and writes their approved contacts subject to the overlap refusal.
- [ ] Two existing parties with the same name are both listed. Neither is chosen by default.
- [ ] An existing tenancy with a party of the same ת.ז. and the same start date is offered. "Attach" writes only the document links to it; "new" proceeds as normal.
- [ ] HTTP tests at the A16 seam for each case.
- [ ] Clicked on `:3000`.

## Blocked by

- #234
