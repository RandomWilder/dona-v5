# SPEC: evidence

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The tables below are the
workbook's ([docs/model/](docs/model/)) and it is the specification they are measured against; where
this file and the workbook disagree, the workbook is right and this file is a bug.

- **Owns:** the paper, and every value that traces back to it. A **schema-driven ingestion engine, not
  a lease parser**: its inputs are a document, a declared type, and that type's field schema.
- **Entities:** E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField ·
  ExtractedField · FieldPromotion.
- **Depends on:** estate, parties, tenancy.
- **Builds:** week 3 (slices 3.1–3.3, 3.6) and week 4 (OCR, comprehension, promotion, the accuracy
  number). **The stub gained content at slice 3.1**, which is the signal its build started.
- **Carries:** **capture is open, promotion is governed** ([tasks/plan.md](tasks/plan.md) A8). A new
  type or field is a row — zero migrations, zero deploys — and is citable the moment it is extracted;
  an extracted value becoming a typed column costs a migration and a reviewed mapping.
  `DocumentTypeField` is versioned by `effective_from`, so a value extracted under version 3 of a
  schema is still explicable a year later. Type is **declared, not detected**: in bulk the folder path
  proposes and a human confirms in a confidence-ranked queue (A10). A Drive path is never a key.

## The tables (slice 3.1, `src/kernel/migrations/0011_evidence.sql`)

Four, in dependency order. Every column is the workbook's FIELDS sheet and there are no others; a
migration that drifts from it turns `src/evidence/schema.test.ts` red, which is what makes the
workbook a specification rather than a description.

- **`document_type`** — E15. The catalogue. `type_key` is the natural key and is never renamed and
  never reused, because filed documents point at it. `is_active = false` retires a type; **a type is
  deactivated, never deleted**, and the foreign key from `document` enforces that rather than asking
  for it. `verification_terms` holds the marker terms a document of this type is expected to contain
  and is read by slice 3.3's guard and by nothing else — it is nullable, so a type with no terms is
  unguarded rather than unfileable.
- **`document_type_field`** — E16. What a type declares, in one version. Unique on
  `(document_type_id, field_key, effective_from)`: redeclaring a field is a **new row**, never an
  edit, and closing a declaration sets `effective_to` without touching what the old row said.
  `value_type` has no `MONEY` member and no money field is ever seeded (foundation rule 2).
- **`document`** — E12. One file, hashed at ingest. `file_hash` is **unique**, which is what makes
  *the same file filed twice is one document with two links* a property of the database rather than a
  habit of the caller. `file_hash` and `storage_uri` are **immutable after insert**, enforced by the
  `document_is_immutable` trigger — the first trigger in this repository, and it is here because
  "immutable thereafter" is otherwise a comment.
- **`document_link`** — E13. R13: one document binds to many entities, so the binding is its own row.
  `entity_id` carries **no foreign key**, which is the price of not having six nullable ones on
  `document`; `entity_type` is checked against the workbook's eight kinds and the pair is half the
  primary key.

## What this module exports, and what it refuses

`src/evidence/contract.ts` is the whole public surface; nothing outside the module imports
`internal/` ([AGENTS.md](AGENTS.md), proved by `src/kernel/boundary.test.ts`).

- **No query here returns a person.** Documents link to parties, and who those parties are is
  `src/scope/`'s answer and nobody else's — the same rule `src/tenancy/` and `src/parties/` state.
  A document panel shows what is filed, not who signed it (slice 3.6, and until week 5 puts a session
  behind the screens, `tests/ui/tokens.test.ts` asserts it from outside).
- **The catalogue is read at run time, never compiled in.** `listDocumentTypes` and
  `documentTypeFields` are what slice 3.3's guard and slice 4.2's extraction read. A
  `Record<TypeKey, …>` in TypeScript would make A8 true of the catalogue and false of everything that
  consumes it, because a type added as a row would ship unguarded until the next release.
- **Ingest is idempotent on `file_hash`**, and linking is idempotent on the primary key. Filing the
  same file against a second entity adds a link and never a document.
- **`ingested_at` comes from the injected clock**, never `DEFAULT now()`.

## Seeding the catalogue — data, not a migration

The nine seed types live in `src/evidence/fixtures/document-types.ts` and are applied by
`npm run seed:doctypes`, which is **wired into no workflow**, for `src/seed.ts`'s reason: a fixture
that seeds itself on every deploy puts rows into production the next time a `v*` tag is cut.

They are data and not a backfill migration **because the acceptance bar says so**: a new document
type must cost a seed row and a re-deploy of data. If the nine arrived in a migration, the tenth
would too, and A8's open half would be false the day it was written.

The nine: `lease · lease_amendment · termination_notice · arnona · insurance · id · bank_guarantee ·
handover_protocol · inspection_certificate`. The first eight are the published Data Model's; the
ninth has been in the workbook since 3 Sep because SAFETY assets and the compliance tab need it, and
slice 3.5 needs it this week.

## What E12 deliberately does not carry

The published [Data Model](docs/data-model.html)'s `Document` card lists four columns the workbook's
E12 does not, and the Data Model is the authority on what the system is — so each omission is a
decision with a reason, made at slice 3.1 and recorded in [tasks/evidence/3.1.md](tasks/evidence/3.1.md).
All four are nullable `ADD COLUMN`s when they come.

- **`state`** — figure 5's `RECEIVED → EXTRACTED → ACCEPTED / REJECTED` is the review queue's state
  machine, and the review queue is slice 3.4, deferred with fuse F4. Type is declared rather than
  detected, so nothing this week branches on a document state, and a state column nothing reads is a
  second state machine standing beside `calls`' real one (foundation rule 3). **Slice 3.3 decides**
  whether a wrong file caught at the door leaves a row behind it.
- **`superseded_by`** — [SPEC-flows.md](SPEC-flows.md) invariant 2 already moved this: an addendum is
  not patching a document, it is contributing a value to a tenancy, so supersession is a fact about
  **values** and lives with their provenance (4.2, 4.3). A genuinely re-issued document — a corrected
  ארנונה bill, a renewed certificate — is answered by `valid_from`/`valid_to`, which E12 has: the
  current one is the one whose window covers today, which is a fact rather than a pointer somebody
  has to remember to set.
- **`tenant_visible`** — a per-row boolean deciding what a tenant may see is a **second access
  control standing beside the isolation join**, and foundation rule 1 is that the scope is a view and
  never a column. A model that misbehaves cannot widen a scope it never held, but it can be handed a
  row whose boolean someone flipped. What a tenant may see is derived from `document_link` through
  `src/scope/`. If week 9 needs a class of document that is admin-only even inside its own tenancy,
  that belongs on the **type** — one row, one rule, readable — and not on each document.
- **`uploaded_by`** — there is no authenticated actor in this system until week 5, so the column
  could hold only a placeholder, and a provenance column holding a placeholder for six weeks is worse
  than one that arrives with the identity it names.

## Later in this module, and not here yet

`ExtractedField` and `FieldPromotion` are week 4's (slices 4.2 and 4.3). Two things about them are
already settled and are recorded so they are not re-decided:

- **There is no `promotes_to` column anywhere in E15 or E16** (slice 3.0). A promotion target as a
  catalogue row would make promotion a row, which is the half A8 governs.
- **`ExtractedField` points at `document_type_field_id` and carries no separate `schema_version_id`.**
  E16 is versioned by `effective_from` on the field row itself, so the row *is* the version. Two names
  for one fact is a pair that can disagree.
