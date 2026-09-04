# ADR-0002 — Scanned documents are read by OCR, and manual field entry is not a fallback

- **Date:** 2026-09-04 · **re-adopted from v3**, where it was decided 2026-08-31
- **Status:** accepted
- **Context slice:** 1.1 — re-adopted by reference, not re-argued
- **Original:** `docs/decisions/ADR-0002-ocr-is-required.md` in `RandomWilder/dona-v3`

## The decision

**OCR is a required capability of this system.** Manual field entry is not an acceptable degraded
mode for it.

## Why it carries into v5 unchanged

It was decided on measurement, and the measurement is the same corpus v5 will ingest. Of the two real
leases v3 saw, one was a scan end to end: five pages, five with no readable text, **zero clauses
extracted**. The pipeline behaved correctly and recorded what it saw — and was completely useless,
because everything after ingestion reads clauses.

Three findings from that ADR are load-bearing in v5 and are carried forward rather than rediscovered:

1. **Scans are not the exception.** Half the sample was one.
2. **Manual entry is a different product.** The lease annex obliges Dona Dom to run a 24/7 response
   centre with a per-apartment fault history. A system whose documents are read by a person typing
   fields is an office process with a database attached — the thing this replaces.
3. **The dangerous case is a hand-made correction to printed text.** OCR that reads a struck-out figure
   and never notices the strike returns the *superseded* term, cleanly, with no signal anything is
   wrong: a wrong answer wearing the shape of a right one. The bar for the OCR path is therefore not
   "is the Hebrew readable" but **"does the output reveal what was changed by hand"** — and if it does
   not, the honest answer is to route that page to a human.

## What changes for v5

- **It is no longer a cut line, and it is not a spike.** v5 plans it in from the start: slice 4.1 is
  the Document AI OCR adapter, and week 4's demo is the accuracy number it produces.
- **The processor is named in advance.** Document AI, inside the same GCP project that already holds
  the documents — which is an argument, not a free pass, and it gets its line in `SPEC.md` under
  ADR-0004's rule.
- **v3's open question is closed by a different route.** That ADR worried that a citation might degrade
  from a clause to a page. v5 does not depend on one document's numbering scheme at all: capture is
  schema-driven ([tasks/plan.md](../../tasks/plan.md) A8), and an `ExtractedField` carries
  `(page, bbox, confidence, model, schema_version_id)`. **A value points at pixels**, which is a
  stronger guarantee than a clause reference and survives a document with no numbering.
- **The "schema over templates" framing that ADR deferred is now settled** as A8 and is not reopened
  here.

## What stays fixed

The guarantee that a field points at text a human can check comes from the plumbing, not from the
model. The model returns an id; a citation naming something that was never sent is rejected. That rule
is what makes a wrong answer visible rather than plausible.
