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

## The object path convention (slice 3.2)

`document.storage_uri` is `NOT NULL` from 3.1 and this is the rule that fills it. The object store
itself is infrastructure and knows nothing about leases ([SPEC-kernel.md](SPEC-kernel.md)); **the
path is built here, by the module that owns the paper.**

```
gs://<bucket>/<place kind>/<place id>/<type key>/<file hash>.<ext>
gs://dona-v5-staging-docs/unit/019a4c7e-…-6f1a0d3e9b42/lease/3f9c…8a1.pdf
```

Every segment is a uuid, a word from a fixed vocabulary, or a hex digest. There is no name, no
address, no transliteration and no uploader-supplied filename anywhere in it.

- **The path carries the place and never the people, and that is enforced by type rather than by
  care.** `documentObjectPath` accepts a **`PlaceKind`** — `PROJECT · BUILDING · SPACE · UNIT` — which
  is a narrower union than `DocumentLink`'s eight `entity_type` values. `TENANCY`, `PARTY`, `ASSET`
  and `OBLIGATION` are not places and cannot be passed, so a lease cannot be filed under a
  signatory's id even by a caller who wants to. [SPEC-flows.md](SPEC-flows.md) invariant 1 makes the
  *tenancy* the upload's primary binding; that stays a `document_link` row. A tenancy is temporal,
  and rooting the filing cabinet at it would scatter one flat's papers across its lettings.
- **Inputs are validated, never sanitised.** A builder that cleans a street name into a path segment
  is exactly the failure the convention exists to prevent, wearing a helmet: two streets that
  transliterate alike would file one flat's lease under another's — a correctness failure with
  isolation flavour, and it arrives quietly. Anything that is not a uuid, a `type_key`-shaped word, a
  64-character lowercase hex digest or an allowed extension is `invalid` at the edge.
- **The leaf is the `file_hash`, not the `document_id`.** `document.file_hash` is `UNIQUE` and
  `ingestDocument` is idempotent on it, so keying the object by the digest makes the *object* write
  idempotent too. A `document_id` leaf would strand an object every time a re-ingest returned the
  existing row rather than the fresh uuid the caller had already written under.
- **`storage_uri` holds `gs://<bucket>/<path>` and not a bare path**, and a read parses it and
  **refuses a bucket that is not the configured one**. A database cloned from staging to a laptop
  then names the bucket it means, and a row pointing at another environment's bucket is refused
  rather than followed.

**The ingest order, which slice 3.3 must follow:** hash the bytes → look the hash up → `put` the
object only when no document already holds it → `ingestDocument`. Hashing first is what makes the
whole path computable before anything is written, and looking up before putting is what keeps the
same bytes filed against a second place from writing a second copy. `ingestDocument` excludes
`storage_uri` from its update path, so the first path filed stays authoritative whatever a later
caller computes.

## Filing a document — flow A1 (slice 3.3)

The administrator holds a file and knows what it is, so **the type is declared and never detected**
([SPEC-flows.md](SPEC-flows.md) invariant 6). Classification does not exist in this system. What is
left is the cheap guard for the error that actually happens: the right slot with the wrong file.

**The order, and it is the one slice 3.2 fixed:** read the bytes → **sniff the kind** → hash →
**verify the declared type** → look the hash up → `put` the object only when no document already
holds it → `ingestDocument` → `linkDocument`. `fileDocument` on `contract.ts` is the whole of it, and
nothing outside it writes a document row.

- **The extension comes from the bytes and never from the upload.** `%PDF-`, `\xFF\xD8\xFF`, the PNG
  signature and both TIFF byte orders are the four `documentExtensions` this system stores, and the
  browser's filename and `content-type` are both discarded unread. A filename is uploader-supplied
  text that routinely carries a household's name (`שכירות כהן.pdf`), and the path convention above
  exists to keep exactly that out of the object store — reading the extension off it would put the
  rest of the name one edit away from the path. **The filename is not stored, not logged and not
  rendered.**
- **The guard reads the catalogue.** `document_type.verification_terms` is its only input, so a type
  added as a seed row arrives with its own guard and a type nobody wrote terms for is unguarded
  rather than unfileable (A8, and slice 3.0's call). There is no `Record<TypeKey, string[]>` anywhere.
- **Every declared term must be present**, and the rule is that strict because the terms are the
  fixed printed language of the form rather than anything a particular household's copy says. One
  matching term is not enough and the corpus shows why: the standard lease says ארנונה in the clause
  about utilities, so *any-term* filing would accept a lease into the ארנונה slot. The comparison is
  over whitespace-collapsed text, because a PDF breaks a term across two runs whenever the line wraps.
- **Three verdicts, not two.** `verified` · `refused` · `unverified`, plus `unguarded` for a type with
  no terms. **`unverified` is a file with no text layer** — a photograph, or a scan — and it is
  **filed**, because refusing it would refuse most real leases and OCR is slice 4.1's. A verdict of
  `unverified` filed silently would make `verified` mean nothing, so the verdict is on the audit line
  either way.

### A refused upload leaves no row — the question slice 3.1 left open

**Decided at 3.3: a caught upload is refused, and no `document`, no `document_link` and no object are
written.** The guard runs before the hash is looked up and before anything is `put`, which is what
the acceptance bar means by *caught before it is filed*.

The published Data Model's figure 4 says *"REJECTED is a state, not a deletion — the wrong file is
evidence too, of what someone tried to file and when"*, and that is read here as **a statement about
the bulk review queue** (figure 5's `RECEIVED → EXTRACTED → ACCEPTED / REJECTED`, slice 3.4, deferred
with F4). In bulk, a rejection is a work item somebody comes back to. On the interactive path the
administrator is standing in front of the refusal and can act on it immediately, so a row would be a
second state machine standing beside `calls`' real one with nothing reading it (foundation rule 3).

**What someone tried to file and when is recorded, and not by a column.** Every filing attempt writes
an `audit_log` line — the declared type, the unit, the file hash, the sniffed extension, the verdict
and, on a refusal, the terms that were missing. The fact figure 4 wants is kept; the state machine it
would have cost is not. **No filename and no document text ever reaches that line** (SPEC.md: PII
never in logs). `state` therefore stays off E12, and remains a nullable `ADD COLUMN` on the day 3.4
lands and needs it.

### What the upload binds to

**A place, always: the `UNIT`.** That is the object path's root and the first `document_link`.

**A tenancy, when the administrator names one** — `document_link` with `entity_type = 'TENANCY'` —
chosen from the lettings that unit already has. This is [SPEC-flows.md](SPEC-flows.md) invariant 1's
primary binding, and it stays a link rather than a path root because a tenancy is temporal and
rooting the filing cabinet at it would scatter one flat's papers across its lettings.

### The first write route in this system, and it has no session

Every route before 3.3 was a read. This one accepts bytes from anybody who can reach the service, and
staff auth is week 5's ([SPEC-estate.md](SPEC-estate.md) says the same of the screens beside it, and
[tasks/roadmap.md](tasks/roadmap.md)'s week 5 owns closing it). What stands in for a session until
then is bounds rather than intentions:

- **One file per request, 20 MB, and four kinds** — sniffed from the bytes, so a `.pdf` that is not a
  PDF is `invalid` at the edge rather than an object in the bucket.
- **The application cannot delete what it writes** (slice 3.2), so the worst an anonymous caller
  achieves is a bounded object it cannot remove and a row naming a unit.
- **Nothing personal is on the screen or in the response** — a unit number, a type and a date. The
  tenancy options are dates and a status, never a name, which is the rule every screen keeps until
  week 5.
- **Only tier-1 specimens are filed before week 5.** Real tenant documents are gated behind F6 and
  arrive at the pilot-preparation step of the method; that ordering is what keeps this window empty
  rather than merely supervised.

**Declaring a *new draft* tenancy at upload is week 4's, with flow A2**, and the reason is a
constraint that already exists rather than a preference: a draft is never an empty shell — unit,
dates and at least one tenant — and `upsertParty` requires a ת.ז., because `national_id_key` is
`party`'s natural key and an upsert without one is an insert wearing an upsert's name
(`src/parties/internal/commands.ts`, which assigns the `createParty` this needs to week 4 with its
confirmation step around it). Building it here would mean an **unauthenticated route that accepts a
person's name and identity number**, six weeks before the session that gates it (week 5) and before
the confirmation step invariant 5 requires. A handover protocol precedes every tenancy its flat will
ever have, so a document with no tenancy link is an ordinary case and not a gap.

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
  second state machine standing beside `calls`' real one (foundation rule 3). **Slice 3.3 decided it
  and the answer is still no column**: a refused upload leaves no row at all, and what someone tried
  to file and when is an `audit_log` line — see "A refused upload leaves no row" above.
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
