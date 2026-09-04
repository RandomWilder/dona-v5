# SPEC: evidence

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the paper, and every value that traces back to it. A **schema-driven ingestion engine, not
  a lease parser**: its inputs are a document, a declared type, and that type's field schema.
- **Entities:** E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField ·
  ExtractedField · FieldPromotion.
- **Depends on:** estate, parties, tenancy.
- **Builds:** week 3 (slices 3.0–3.4, 3.6) and week 4 (OCR, comprehension, promotion, the accuracy
  number).
- **Carries:** **capture is open, promotion is governed** ([tasks/plan.md](tasks/plan.md) A8). A new
  type or field is a row — zero migrations, zero deploys — and is citable the moment it is extracted;
  an extracted value becoming a typed column costs a migration and a reviewed mapping.
  `DocumentTypeField` is versioned by `effective_from`, so a value extracted under version 3 of a
  schema is still explicable a year later. Type is **declared, not detected**: in bulk the folder path
  proposes and a human confirms in a confidence-ranked queue (A10). A Drive path is never a key.
