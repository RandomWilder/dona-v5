---
number: 103
title: "One reading writes passages: the document text is kept"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [102]
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

A document uploaded today is read exactly once in its life, and its text survives that reading.

At present the text is read at upload, used, and thrown away. Every later view of a reading pays for
a second OCR call, re-extraction pays for another, and nothing about a document can be searched or
answered from, because no copy of its text exists.

This ticket keeps it. The single existing decision point that chooses native text versus OCR stays
the only place bytes are read; its output now fans out to three destinations rather than two — the
verdict, the extracted fields, and a new per-page passage store. Each passage is one row per page of
a document: the document it belongs to, the page number, an ordinal, the text exactly as printed, and
an embedding. The embedding model and dimension are the ones already welded at boot; no second model
is introduced. Text is stored raw, including identifiers — masking happens at read time, not write
time, because masking here would both corrupt the vector and hide a tenant's own identifier from
them.

No vector index is created. Correctness first; an index is added when measured row counts justify it,
following the precedent already set for embedding work here. This is a deliberate deferral and should
be recorded as one.

The observable outcome: after uploading a document, its passages exist, one per page, with text
matching what the reading produced; and viewing the reading again makes no second call to the reader.

This ticket is blocked by #102 because both change the reader's fan-out. The subtraction lands first.

## Acceptance criteria

- [ ] A migration adds the passage table: document, page number, ordinal, text as printed, embedding at the welded dimension
- [ ] Uploading a document writes one passage per page, in page order
- [ ] Passage text matches the text the reading produced, identifiers included, unmasked
- [ ] The reading still happens at exactly one decision point; no route re-reads bytes
- [ ] Viewing a reading a second time makes no second call to the reader
- [ ] No vector index is created, and the deferral is recorded
- [ ] The glossary gains the passage as a noun, edited in the same change

## Blocked by

- #102 — Delete the word-box overlay; the page number replaces it
