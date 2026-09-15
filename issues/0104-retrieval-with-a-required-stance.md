---
number: 104
title: "Retrieval with a required stance"
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

An administrator asks the system a question about the documents and gets an answer drawn from them,
cited to the document and the page it came from — including questions about money, which the system
may now read, quote and compute from.

Search over the passage store returns, per hit: the document, the page, the text, the document type,
the flat the document is anchored to, and a distance. The type and the flat travel with the hit so
that a result is meaningful without a second lookup. The distance orders the results and is never
asserted on anywhere.

The search function takes a **required** stance — required rather than defaulted, so that no caller
can retrieve without stating who is asking. The administrator stance returns identifiers as printed.
The tenant stance masks them. Because passages are stored raw, this masking is a read-time
transformation of the returned text, and every reveal of a withheld identifier continues to write a
ledger row exactly as it does today. The tenant-facing surface that would use the tenant stance is
not built here; the stance and its masking are.

The passage store and the decision to chunk one passage per page are retrieval configuration, so this
change enters the golden set rather than waiting for a consumer. Cases are graded on rank against the
corpus fixtures and ratcheted to what the system achieves on the day they land, so they go green
immediately and block the next regression rather than the current state.

## Acceptance criteria

- [x] Search returns, per hit, the document, page, text, document type, anchored flat and a distance
- [x] The stance parameter is required; there is no default and no caller omits it
- [x] The administrator stance returns identifiers as printed
- [x] The tenant stance masks identifiers in the returned text; the stored passage is unchanged
- [x] A reveal of a withheld identifier writes a ledger row
- [x] A question about a rent or deposit amount returns the exact figure with its document and page
- [x] Golden cases are added, rank-graded, ratcheted to the day's achieved result, and green on landing
- [x] No assertion anywhere is made on a distance
- [x] The full golden set runs and passes; the glossary gains the stance as a noun

## Blocked by

- #103 — One reading writes passages: the document text is kept

## Comment — 2026-09-15

Closed: `c934dea`. Passage search takes a required stance; admin returns identifiers as printed,
tenant masks at read time. Golden set ranks money questions. No distance assertion.
