# ADR-0009 — Passage embeddings have no vector index yet

- **Date:** 2026-09-15
- **Status:** accepted
- **Context ticket:** [#103](../../issues/0103-one-reading-writes-passages.md), under [#99](../../issues/0099-admin-document-upload-flow.md)
- **Does not touch:** the welded embedding model or dimension. Those stay the boot-time settings already in [SPEC-kernel.md](../../SPEC-kernel.md). Retrieval stance and masking at read time are later tickets under the same parent.

## The decision

1. **`document_passage.embedding` is a `vector(n)` column and is not indexed.** There is no `hnsw` index and no `ivfflat` index. A sequential scan is the access path until a measured row count shows that it is not.
2. **This is a deferral, not an omission.** The column exists so a later index has something to attach to, and so a document is never stored as text without the vector that retrieval will compare. Adding the index is a later migration, justified by measurement, the same way `0010_scale_indexes.sql` was.
3. **The evals corpus remains a TEMP table.** `eval_chunk` is not a production access path and does not become one by sharing a type with `document_passage`.

## Why not an index now

An `hnsw` index on a 1536-wide column is a RAM and write-amplification cost paid on every ingest, for a query this ticket does not yet run. The parent spec already named the retrieval seam; this ticket keeps the text. Building the index before anything searches it would be speculative generality: a structure whose only present effect is to slow the write that this ticket is about.

The evals harness already compares vectors with `<=>` over an unindexed TEMP table. That is the precedent this decision follows, not a new one.

## What this obliges

- A migration that adds `USING hnsw` or `USING ivfflat` on `document_passage` is a new decision, recorded against a row count, not a silent follow-up in the next ticket.
- Tests of this ticket assert the absence of a vector index, so the deferral cannot rot into an accident.

## What this does not decide

How retrieval will scan, what distance is near enough, or when the index becomes due. Those wait on a caller that searches.
