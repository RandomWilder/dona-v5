---
number: 105
title: "Backfill the archive into the passage store"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [103]
parent: 99
created: 2026-09-15
closed: 2026-09-15
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

Documents read before this flow existed have no passages, so the archive is silent to any question
put to it. An administrator should be able to ask about a lease filed last year and get the same
cited answer they get for one filed today.

A sweep brings them in: it finds documents with no passages, reads each one through the same single
decision point that new uploads use, writes its passages, and moves on. It follows the shape of the
existing unverified-document sweep — same batching, same reporting, same operational posture — and it
is allowed to run down to zero, meaning a second run over an already-swept corpus finds nothing to do
and says so.

The sweep is not in any workflow, like its siblings. It is invoked deliberately.

## Acceptance criteria

- [x] A sweep exists that finds documents holding no passages and writes their passages
- [x] It follows the shape of the existing unverified-document sweep
- [x] It runs down to zero: a second run over a swept corpus does no work and reports so
- [x] A backfilled document is retrievable on the same terms as a newly uploaded one
- [x] Re-running the sweep never duplicates passages for a document
- [x] The sweep is not added to any workflow

## Blocked by

- #103 — One reading writes passages: the document text is kept

## Comment — 2026-09-15

Closed: `a7e2a47`. Sweep writes passages for documents that have none, same shape as the unverified
sweep, second run is a no-op, not in any workflow.
