---
number: 251
title: Policy document versions — a new version ends the old one
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [250]
parent: 247
created: 2026-10-16
closed: 2026-10-17
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

An ADMIN can upload a new version of a Policy document.

- The new version gets its own effective-from date. The previous version is given an effective-to
  equal to that date.
- Nothing is overwritten and nothing is deleted. Both versions stay readable, with their passages.
- The מדיניות tab shows a document's history: every version with its dates, and which one is in
  force today.
- **In force:** a version is in force on a date when effective-from ≤ date, and effective-to is
  empty or date < effective-to. This is the predicate #254's as-of search uses, so it lives in one
  place and is tested there.
- **Refused:**
  - a new version whose effective-from is not after the current version's effective-from;
  - two versions in force on the same date.
- **Audit:** the supersession is written to the audit trail.

## Acceptance criteria

- [x] SPEC-policy states the in-force rule and the supersession rule.
- [x] Uploading a new version sets the old version's effective-to, and both rows remain.
- [x] The in-force predicate is tested on the boundary dates:
  - [x] the day before the new effective-from;
  - [x] the day itself;
  - [x] a version with no effective-to.
- [x] The overlap refusal and the backdated-version refusal each have a policy case that was red first.
- [x] The history view shows every version and marks the one in force today.
- [x] Clicked on `:3000`.

## Blocked by

- #250

## Comment — 2026-10-17

A new upload of the same title in the same section is a new version. Its effective-from has to be after the open version's, and that date becomes the open version's effective-to. Both rows and their passages stay. The מדיניות tab lists every version and marks the one in force today. In force is `policy_document_in_force`: effective-from on or before the date, and effective-to empty or the date strictly before it. The overlap refusal was red first (the second open row was stored), then the exclusion constraint made it 23P01. The backdated upload was red first (303), then the server answers 409. Ending a version writes `policy.supersede`. Clicked on `:3000` after a dev restart: Specimen policy gained a version from 01.10.2026, marked in force, and the 15.03.2026 version stayed readable. A later upload dated 01.09.2026 was refused.
