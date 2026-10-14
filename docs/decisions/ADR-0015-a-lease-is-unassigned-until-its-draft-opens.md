# ADR-0015 — A lease is unassigned until its draft opens

- **Date:** 2026-10-14
- **Status:** accepted
- **Supersedes:** SPEC-flows A12 "Nothing is held between the read and the file", and the director's ruling of 14 Sep, for leases only
- **Context:** the staging lease upload of 14 Oct 2026 (document `01a13956`): 33 readings approved, no draft, no people; [#177](../../issues/0177-the-filing-tab-reads-the-annex-a-long-lease-defers-to.md)

## The decision

A lease is stored at upload as an **Unassigned document**: no place, an object path named by the document, not by a flat. It is read and its rows are approved as today. Nothing else is written until an administrator presses **פתיחת טיוטה**. That press chooses the flat (preselected when the read address matches exactly one), the terms profile, and the people. In one transaction it writes the draft tenancy, the parties and their contacts, and the document's links. The flat is assigned in the tenancy, at the moment the tenancy is born, and never at upload.

`tenancy.unit_id` stays `NOT NULL`. A draft always has a flat. A lease whose flat is not yet in the system waits on the **ממתינים לפתיחה** list in שכירויות, not as a flatless draft.

## Why reverse A12

A12 required a real place at upload because storage cannot move or delete what it writes (slice 3.2), so a document filed on the wrong flat is filed there for good. That reasoning assumed the place could usually be read off the paper. It cannot be read reliably:
- leases put the address in an annex (#177);
- the 1,500-flat search returns near matches;
- on 14 Oct the place step is where the director's session broke.

Every fallback asked the administrator to find the flat during the upload, the step this decision removes. An object path named by the document cannot be wrong about a place, so the permanence argument now favours not naming one.

## Considered and refused

- **Filing on the building when the address matches one.** A wrong building is as permanent as a wrong flat. This narrows the risk without removing it, and keeps two paths.
- **A draft with no flat.** It would make `unit_id` nullable and replace the natural key (unit, start date). Every screen that joins a tenancy to a flat would need a fourth state. The unassigned document already covers "paper without a flat".
- **Writing the draft when the reading becomes ready.** That is what failed on 14 Oct: the approval committed, and the draft write that followed failed on a missing terms profile. The UI was left with every stamp approved and nothing to act on. An explicit button can show what is missing before the press.

## Consequences

- Duplicate detection gains a second check. Bytes at upload (`file_hash`, unchanged). At פתיחת טיוטה, a tenant ת.ז. plus start date that match an existing tenancy offer to attach the lease to that tenancy instead.
- The office question-answer panel does not see an unassigned lease. Answers are bound to a place, and this lease is not yet a fact about any flat.
- Documents already filed under place-named paths stay where they are. Both path forms are read.
- Other document types are unchanged. A handover protocol still arrives on an existing tenancy; building paper still names its building.
