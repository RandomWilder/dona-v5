---
number: 109
title: "The orchestrator: upload, read, approve"
status: open
labels: [ready-for-agent]
assignee: agent
blocked_by: [100, 101, 102]
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

The first half of the designed flow, as one path rather than a set of screens in an order nobody
chose.

An administrator uploads a lease against a specific flat — the document is anchored to the place it
concerns from the moment it arrives. It is read once. If it is not the type that was declared, it is
rejected at the door rather than three screens later. The reading's confidence is stated, so the
administrator knows how carefully to check.

They then land on the approval ledger: the extracted values as a table they can scan, one row per
field, each carrying the page it was read from. A wrong value can be corrected, so that the tenancy
is built from what the contract says rather than what the reader guessed. Each value can be approved
individually, so that a signature means that value was looked at. Everything unflagged can be
approved in one action, so a fourteen-page lease is not fifty clicks — but only where the confidence
signal is honest enough to support it; where it is not, that action is not offered. Amounts appear as
ordinary rows, because after #101 they are.

Behind the screens is **one orchestrator** sequencing the filing, extraction and approval commands
that already exist. The commands are not new; the path through them is. The unit-first document list
remains as a second door into the same orchestrator, not as a second mechanism.

The approval ledger is redrawn from the approved mockup rather than ported: it leads with the table
and collapses the explanatory prose that dominates it today. Its mockup file is deleted once wired.
Both this screen and the read screen are appended to the existing screen registry.

The end-to-end HTTP suite starts here, driven by request injection the way an administrator drives
the system: a real multipart upload through the whole path, then read, correct, approve. The reader
and extractor are injected fakes, so the suite is deterministic and spends nothing. It asserts on
responses, on the rendered Hebrew, and on the rows that exist afterwards — never on how the answer
was reached. It follows the existing evidence route suite's posture, which commits and cleans up
against its own bucket because routes read through the pool.

## Acceptance criteria

- [ ] An administrator uploads a document against a flat, and the document is anchored to that flat
- [ ] A document whose content does not match the declared type is rejected at upload
- [ ] The reading's quality verdict is shown to the administrator
- [ ] The approval ledger shows the extracted values as a table, one row per field, each with its page number
- [ ] A value can be corrected, and the correction is what gets approved
- [ ] A value can be approved individually
- [ ] Everything unflagged can be approved in one action, and that action is withheld where the confidence signal does not support it
- [ ] Amount fields appear as ordinary rows on the ledger
- [ ] One orchestrator sequences the existing commands; no command is duplicated
- [ ] The unit-first document list enters the same orchestrator
- [ ] The approval-ledger and lease-approval mockup files are deleted; both screens are in the screen registry and pass its guard
- [ ] An HTTP suite drives upload, read, correct and approve with real multipart bodies and injected fakes, asserting on responses, rendered markup and resulting rows
- [ ] Every screen and write path in this ticket is clicked on a running local server before merge

## Blocked by

- #100 — Paint the three screens of the document-upload flow
- #101 — Retire foundation rule 2; the lease gains four amount fields
- #102 — Delete the word-box overlay; the page number replaces it
