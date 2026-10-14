---
number: 236
title: "Same-name candidates and the same-lease check at opening"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed: 2026-10-14
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

- [x] An existing party with the same given and family name and no other match is shown as a candidate. Pressing open without choosing creates a new party.
- [x] Choosing the candidate attaches the person to that party, and writes their approved contacts subject to the overlap refusal.
- [x] Two existing parties with the same name are both listed. Neither is chosen by default.
- [x] An existing tenancy with a party of the same ת.ז. and the same start date is offered. "Attach" writes only the document links to it; "new" proceeds as normal.
- [x] HTTP tests at the A16 seam for each case.
- [x] Clicked on `:3000`.

## Comment — 2026-10-14

The checks are on פתיחת טיוטה. A person with no ת.ז. and no contact match is listed beside parties who share that given and family name; the new-party choice is already selected. A printed ת.ז. is not offered that list, even when it matches nobody. Attach writes the tenancy evidence link and no party. The same-flat, same-start refusal still blocks a new draft, and attach stays available beside it. Eight HTTP cases at the A16 seam. The dev server was restarted. The click is still open: the screen asks for a Google account.

## Comment — 2026-10-14

Clicked on `:3000` while signed in. Lease `01a13abd` on flat 3. Signed the three names and both dates, and left the phones unsigned so a contact match would not hide the name list. פתיחת טיוטה shows "אותו אדם?" for the main tenant, the second tenant and the guarantor. "איש קשר חדש" is selected on each. Choosing the existing party selects that person and clears the new-party choice; the other two stay on new. The candidate link opens that party. This lease has no printed ת.ז., so there is no "חוזה קיים" offer, and each name matches one party. The two-candidate list and the attach choice stay on the eight HTTP cases. The draft was not opened.

## Blocked by

- #234
