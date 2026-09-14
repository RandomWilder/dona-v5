# SPEC: evidence

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The tables below are the
workbook's ([docs/model/](docs/model/)) and it is the specification they are measured against; where
this file and the workbook disagree, the workbook is right and this file is a bug.

- **Owns:** the paper, and every value that traces back to it. A **schema-driven ingestion engine, not
  a lease parser**: its inputs are a document, a declared type, and that type's field schema.
- **Entities:** E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField ·
  ExtractedField · FieldPromotion.
- **Depends on:** estate, parties, tenancy.
- **Builds:** week 3 (slices 3.1–3.3, 3.5's confirm screen, 3.6) and week 4 (OCR at 4.1, comprehension
  at 4.2, promotion at 4.3, A2's draft tenancy at 4.6, A3's addendum at 4.7). **The stub gained content at slice 3.1**, which
  is the signal its build started. ExtractedField landed at 4.2; FieldPromotion lands at 4.3.
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
  **Slice 5.8** is the hand on this catalogue: the composition-root settings screen lists every
  type (inactive included) and posts through `upsertDocumentType`. Field declarations stay a seed;
  this screen does not version `DocumentTypeField`.
- **`document_type_field`** — E16. What a type declares, in one version. Unique on
  `(document_type_id, field_key, effective_from)`: redeclaring a field is a **new row**, never an
  edit, and closing a declaration sets `effective_to` without touching what the old row said.
  `value_type` has no `MONEY` member and no money field is ever seeded (foundation rule 2).
- **`document`** — E12. One file, hashed at ingest. From 5.4 it also carries **`uploaded_by`**, a
  nullable FK to `staff_account`. `file_hash` is **unique**, which is what makes
  *the same file filed twice is one document with two links* a property of the database rather than a
  habit of the caller. `file_hash` and `storage_uri` are **immutable after insert**, enforced by the
  `document_is_immutable` trigger — the first trigger in this repository, and it is here because
  "immutable thereafter" is otherwise a comment. **`verification_verdict`** is the 3.3 guard's
  result, stored so a list can show it without re-reading the bytes (`verified` · `unverified` ·
  `unguarded`). It is not figure 5's `state` and is not on the immutability trigger: slice 4.1 may
  later move `unverified` to `verified` once OCR gives the file a text layer. `refused` still writes
  no row.
- **`document_link`** — E13. R13: one document binds to many entities, so the binding is its own row.
  `entity_id` carries **no foreign key**, which is the price of not having six nullable ones on
  `document`; `entity_type` is checked against the workbook's eight kinds and the pair is half the
  primary key.

## ExtractedField (slice 4.2, `src/kernel/migrations/0017_extracted_field.sql`)

One row per value read off the paper. Slice 4.3 adds the promotion stamp (`promoted_to`,
`promoted_by`, `promoted_at`) on this table; the mapping that *permits* a stamp is `field_promotion`,
not these columns. The workbook FIELDS sheet does not yet list this table, so this section is the
specification the migration is measured against — the same standing 3.1 used for E12–E16 once the
sheet existed.

- **`extracted_field`** — generic capture. Points at `document_type_field_id` and at `document_id`.
  **There is no `schema_version_id` and no `field_key` column.** E16 is versioned by `effective_from`
  on the field row itself, so the row *is* the version; carrying both names is a pair that can
  disagree. Two values for the same declaration (two tenants on one lease) are two rows: there is
  no unique on `(document_id, document_type_field_id)`.
- **Two engines.** Document AI or pdfjs **measures** `(page, bbox, confidence)`. The language model
  **maps** meaning: it is handed numbered words `{id, page, text}` and the live field list from
  `documentTypeFields`, and it returns `{field_key, value, word_ids}`. Geometry is the union of
  those words' boxes. A bbox, page or confidence in the model reply is ignored. Empty or unknown
  `word_ids` drop the finding — no invented box. Native pdfjs may store `confidence` null; a scan
  stores Document AI's score. The mapping model id is stored on the row so a dispute can name which
  comprehension pass produced the value.
- **Building number is not the flat.** On a Hebrew lease `בניין מספר` belongs in `address` (street,
  building number, city). `apartment_number` is `דירה מספר` only. A parking bay (`חניה`) is neither.
  From 2026-09-08 the mapping instructions say that, and the lease field hints do too — a new
  `effective_from` row, not an edit of 2026-09-07 (R18). The 4.6 cross-check still refuses a swap;
  this is what stops the swap being the usual result.
- **A DATE value is ISO `YYYY-MM-DD`.** That is what `tenancy.start_date` / `end_date` and
  FieldPromotion already accept. Hebrew month names and `dd/mm/yyyy` are the paper, not capture.
  The mapping instructions ask for ISO; a DATE finding that is not a real calendar day is dropped —
  no row, same as any other missing required field. Screens may later print dd/mm/yyyy; they do not
  store it.
- **`value` is `-- pii`.** Names and addresses land here. Guard three matches a qualified name
  (`extracted_field.value`) because a bare `value` would fire on `config_settings`.
- **A missing required field is a result, not an error.** No row. The same for an unconfigured
  extractor or a timed-out call: the file stays, HTTP stays 200, zero extracted rows.
- **A declared identifier is withheld by default. Slice 6.4.** The `lease` type declares
  `tenant_id_number` and `guarantor_id_number`, so `extracted_field.value` now also holds a ת.ז.
  Three rules hold that, and they are the module's and not a screen's:
  - **`IDENTIFIER_FIELD_KEYS` is the named set**, in `internal/extract.ts`. A field key is an
    identifier because it is on that list, never because a value looked like nine digits — a shape
    test would fire on a contract number and miss a hyphenated ת.ז., and week 5's `/05\d/` incident is
    what a shape test costs when it is wrong: a duplicated one read the CSRF token's own hex and
    failed 4 runs in 20.
  - **Withheld by default on every read path.** `renderReadPage` takes a required
    `mayReadIdentifiers` stance; false drops the rows and their page outlines and prints **a count**
    instead — a state and a count, never the value, which is the rule this console has kept since
    5.2. Only `party.national_id.read` sets it true, and only ADMIN holds that.
  - **Disclosure writes `evidence.read_identifier`** — actor, role, document and the field keys, never
    the value (SPEC.md: PII never in logs). Withholding is not a read and writes nothing.
  - **The word-box transcript is withheld too. Slice 6.6**, which is where the rule acquired its
    third subject and its sharpest sentence: **captured is governed; printed is the document.** The
    overlay draws one `<span class="word-box">` per measured word and carried the word's own text in
    a `title` attribute for every viewer, so a ת.ז. printed on the lease was readable by an OPERATOR
    on the same page whose captured row was correctly withheld — found by clicking at 6.5, where the
    captured-row gate scored admin **1** / operator **0** and the overlay scored **1** for both. The
    `title` is our transcription of the paper, in text, in our own response, and it is rendered only
    when `mayReadIdentifiers` is true. Withheld **wholesale rather than word by word**: a run split
    across OCR tokens (`312`, `345`, `678`) matches no pattern applied to one token, and the type's
    catalogue declaration is the wrong gate because a declaration governs what is *captured*, not
    what a page happens to print. The geometry stays at both stances — the boxes still show where
    words were found, which is what `מילים על הדף` is for.
  - **The page image is not withheld, and that is the boundary.** The same viewer already holds a
    fifteen-minute signed read of the document's bytes (5.4), so withholding a picture of the page
    would claim a control this system does not have. Whoever may open a document may read what is
    printed on it. What the permission governs is this system's own copy — the row, the transcript,
    `party.national_id` — and saying so plainly is worth more than a control that is believed and
    absent.
  **No `field_promotion` target for either field**, deliberately: the identifier becomes
  `party.national_id` when a human confirms a household (A2), which is an act and not a promotion.
  `listExtractedFields` keeps returning every row, because it is this module's internal truth — what
  is gated is the response shape, and that is where the gate is.
- **Re-extract replaces unstamped rows only.** A row with `promoted_at` set is a promotion that
  already became business truth; deleting it would erase the stamp. The database refuses that
  DELETE. Extract deletes rows where `promoted_at IS NULL`, then inserts. Adding a field to the
  type and re-running is still A8's open half: no migration, no code change.

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
- **Every declared requirement must be met**, and the rule is that strict because the terms are the
  fixed printed language of the form rather than anything a particular household's copy says. One
  matching term is not enough and the corpus shows why: the standard lease says ארנונה in the clause
  about utilities, so *any-term* filing would accept a lease into the ארנונה slot. The comparison is
  over whitespace-collapsed text, because a PDF breaks a term across two runs whenever the line wraps.
- **A requirement may have more than one spelling, and `|` separates them (slice 6.8).** One element
  of `verification_terms` is one requirement; `חוזה שכירות|הסכם שכירות` is satisfied by either. This
  is not a loosening of the rule above — every requirement must still be met — it is the admission
  that a standard Israeli lease is headed either way and calls the flat either המושכר or הדירה. The
  week-6 demo's paper said `הסכם שכירות` and `הדירה` throughout and was refused for it: correct
  behaviour, wrong calibration. The encoding is a delimiter inside the existing `text[]` element and
  not a new column, so a type is still added as a seed row and the settings editor — one line per
  requirement — is unchanged. **The guard against widening a type too far is
  `tests/policy/document-verification.test.ts`**, which requires every tier-1 specimen to be refused
  in every slot that is not its own.
- **Three verdicts, not two.** `verified` · `refused` · `unverified`, plus `unguarded` for a type with
  no terms. **`unverified` is a file this system could get no text out of** — a photograph, a scan
  with no processor configured, a PDF whose text reader hit its bound — and it is **filed**, because
  refusing it would refuse most real leases. Slice 4.1 then reads it. A verdict of `unverified` filed
  silently would make `verified` mean nothing, so the verdict is on the audit line either way.
- **The verdict is taken on the best reading available, and the reading happens once, before anything
  is written (slice 6.8).** Until 6.8 OCR ran only when a PDF had *no* text layer, so a phone
  scanner's own text layer permanently outranked Document AI — the demo's scan was refused in under a
  second while the one file with no text layer took seven. Now the native layer is read first, and
  **OCR is spent whenever the native reading does not satisfy the declared type**, not only when the
  page is empty. When it is spent, its pages win: OCR is only ever reached because the native reading
  failed the type's own guard. **The consequence is deliberate** — a scan whose OCR text does not
  carry the type's vocabulary is now *refused* rather than filed as `unverified`. `unverified` means
  nobody could read it; it does not mean nobody has checked.
- **A long document is read in part, and a large one is refused (slice 6.8).** `onlineOcrPageLimit`
  is 15 and real leases exceed it — the week-6 demo's is 38 pages — and until 6.8 a longer scan was
  simply not sent, then filed as though it had been read. It is read in part now: the call carries
  `individualPageSelector` for the first fifteen pages, which is where a lease says what it is and
  where it belongs. **`pagesRead` goes on the audit line beside the page count**, because *verified*
  on a partial reading is a different claim from *verified* and the difference has to be somewhere a
  person can count. *(Measured before it was written: the demo's own file, pages 1–15 selected, came
  back `200` with fifteen pages in 36.4 seconds.)*
- **`too_large` is a refusal and never a stored verdict (slice 6.8).** The bound Document AI sets is
  on the **request**, and the whole file rides in every request base64-encoded, so a file above
  `onlineOcrByteLimit` cannot be read at any page count. Selecting fewer pages does not make it fit.
  An upload above that ceiling is refused with a sentence saying so, rather than filed on a reading
  that never happened. The upload route's own `LIMITS.fileSize` is larger, so there is a band where a
  file is storable and unreadable, and that band is the refusal. The
  `document.verification_verdict` CHECK still holds three values: nothing carrying this outcome
  reaches a row.

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

### The first write route in this system, and what bounds it

Every route before 3.3 was a read. From 3.3 to 5.2 this one accepted bytes from anybody who could
reach the service, and what stood in for a session was bounds rather than intentions. **Slice 5.2
gave it the session, a CSRF token and a bound on the caller**; the 3.3 bounds are kept, because they
bound a different quantity and an authenticated operator can still post a 200 MB file by accident.

- **One file per request, 20 MB, and four kinds** — sniffed from the bytes, so a `.pdf` that is not a
  PDF is `invalid` at the edge rather than an object in the bucket.
- **Fifty filed documents per operator per rolling 24 hours** (slice 5.2). This is the bound none of
  the others is: they bound a *request*, and nothing bounded a *caller*, so one poster could fill a
  versioned bucket the application is built to be unable to empty. It is counted from `audit_log` —
  `evidence.file_document` rows carrying the operator's `actor_id` — rather than from a new column,
  because the log already records exactly the event being bounded, and **a refused attempt counts**:
  the bound is on what reached intake, not on what survived it. Over it, the answer is `too_many`
  and 429, which is a different sentence from `not_allowed` and says the true thing — not today,
  rather than not you. Bulk arrives through the register importer and 3.4's Drive ingestion, never
  through this route.
- **A CSRF token on the POST** (slice 5.2), derived from the session cookie and checked **inside the
  handler** rather than in the `preHandler` hook that covers every other write route: this body is a
  multipart stream, and a hook that read the field would consume the stream the handler needs. The
  comparison is `verifyCsrf` from `src/staff/contract.ts` either way — one function, a second call
  site, not a second implementation.
- **The application cannot delete what it writes** (slice 3.2), so the worst a caller
  achieves is a bounded object it cannot remove and a row naming a unit.
- **Nothing personal is on the screen or in the response** — a unit number, a type and a date. The
  tenancy options are dates and a status, never a name, which is the rule every screen still keeps
  after 5.2 chose to keep it and 5.4 kept it again.
- **No private nav** (slices 5.2b, 5.2c and 5.2d). Document screens receive the same signed-in ops
  rail the composition root injects everywhere else — buildings, expiring, incomplete, search,
  staff, sign-out — mark the estate destination as current, and write none of their own. The phone
  drawer is the kernel shell's, not a second menu on the document screens.
- **Only tier-1 specimens are filed before the corpus arrives.** Real tenant documents are gated
  behind F6 and arrive at the pilot-preparation step of the method; that ordering is what keeps this
  window empty rather than merely supervised.

**Declaring a *new draft* tenancy at upload is slice 4.6, flow A2.** A draft is never an empty shell —
unit, dates and at least one tenant — and `upsertParty` requires a ת.ז., which at 4.6 a lease had no
way to carry, so A2 called `createParty` instead (name only, no identity match). **Amended at 6.5:**
6.4 gave the lease a declared identifier, so A2 calls `upsertParty` where one was captured and
`createParty` where none was — a name is still never matched, and an identifier now is. Filing a
`lease` with no tenancy link redirects to `/documents/:id/tenancy`. Upload to an existing letting stays 3.3 plus 4.3's per-field promote. A
handover protocol precedes every tenancy its flat will ever have, so a document with no tenancy link
is an ordinary case and not a gap.

### Filing without a unit — flow A12 (slice 6.3)

`GET /documents/new` **with no `unit`** is a screen of its own: the type, the file, and no flat. The
same path **with** a `unit` is 3.3's screen, unchanged, reached from a building page. The post behind
the new screen is `POST /documents/intake`, and everything it does before it knows where the document
goes is the order 3.3 fixed, with one step inserted in front of it: **read the text → read the place →
resolve the place → then `fileDocument`, unchanged.**

**The reader is deterministic, and its anchors are printed here because somebody has to write a lease
that matches them.** It is a pure function over the document's text (`src/evidence/internal/place.ts`),
the exact analogue of A6's protocol reader, and it reads three things:

- **the street and number** — after `כתובת המושכר:`, `כתובת הנכס:`, `כתובת הדירה:`, a bare `כתובת:`,
  or a `רחוב` that starts the address. `רקפת 12` and `רחוב רקפת 12` are the same address to it.
- **the city** — whatever follows the address's comma, up to the next comma, full stop, semicolon
  **or line end**. So `כתובת המושכר: רקפת 12, שוהם.` reads as street `רקפת 12` and city `שוהם`.
- **the apartment number** — `דירה 12`, `דירה מס׳ 12`, `דירה מספר 12A`. The same shape 3.5's reader
  uses, because it is the same sentence on a different form.

Anything it cannot find is null, and null is not an error: it is the refusal below, which is a screen.

**On a form a line break is where a field ends, and from slice 6.8 the line break actually arrives.**
The reader was written against that clause from the day it shipped, and `documentText` could not
produce it: it joined a page's words with a space and emitted a newline only *between* pages. What
saved it was punctuation — the worked example above is `רקפת 12, שוהם.` and the full stop is what
stops the city — so the first scan that printed its address without one read the city as
`כפר סבא דירה מספר 3 המשכיר` (the week-6 demo, and the refusal that followed was correct and wrote
nothing). Both readers already know where a line ends: pdfjs sets `endsLine`, and Document AI returns
`lines` beside `tokens`. `src/kernel/pdf.ts` and `src/kernel/ocr.ts` carry that through and
`documentText` joins by line. **The line structure comes from the reader and is never inferred from
geometry** — a y-clustering line detector standing beside two real ones is the thing that drifts.

**Resolution is exact, and a near miss is a question rather than a guess.** The reader's city and
street are folded into `building.address_key`'s own normalisation — `addressKeyOf` in
`src/estate/`, beside the generated column that defines it — and looked up. Because a building's
`address_line` may or may not carry the word `רחוב`, the lookup carries the two or three spellings of
one address as **keys**, matched with `=`; it never falls back to a `LIKE`. The apartment number then
narrows that building's units through `apartmentMatches`, which A2 already trusts for its cross-check.

- **Exactly one unit** → `fileDocument` runs against `{ kind: 'UNIT', id }`, unchanged, and the
  redirects into A6 and A2 fire exactly as they do from the unit-first screen.
- **Zero or several** → **422, and nothing is written**: no `document` row, no `document_link`, no
  object in the bucket. The form comes back with what the reader read, the candidates a
  `searchEstate` over the street found, a search box for the operator's own term, and the file input
  re-armed. A candidate re-posted with the file is an ordinary filing against a unit a human chose.

**A candidate list is cut at twelve, and says how long it was.** A lease naming an address this
system holds and an apartment number it does not — `רקפת 12, דירה 999` — matches a building and no
flat in it, and every flat in that building is then a correct candidate. On the demo estate that is
seventy-two radio buttons, which is a correct answer nobody can use. So the list is `CANDIDATE_LIMIT`
long and the screen prints the real count beside it, the same sentence the estate search makes at
`SEARCH_LIMIT` — and the way past it is the search box already on the page. The number is a reading
aid and never a filter: the cap is applied to what is offered, never to what is looked up, so it
cannot turn "several candidates" into "exactly one".

**The flat is the anchor of the filing and not the end of it.** A12 files a document against a place
and never against a letting: `tenancyId` is null on this path, because *which* tenancy a lease
belongs to is a fact the lease itself states, and the screen that reads it is A2's confirm page —
which this route redirects a verified lease to. Invariant 1 is kept where it always was, and the
screen says as much above the button rather than leaving an operator to discover it.

**Why nothing is held.** The bytes are not stashed between the refusal and the second post, and there
is no staging store, no `UNFILED` place kind and no fifth `PlaceKind` value. The object path names a
real place (slice 3.2) and A6 settled the principle for the deterministic case: the cost is that the
operator re-attaches the file, which is what 3.3's wrong-file refusal has always cost.

**The second `csrf: 'in-body'` route, and the reason it is exactly two.** That flag is an exemption
from the composition root's CSRF `preHandler`, and the exemption is one sentence: *this body is a
multipart stream and a hook that read the token would consume the stream the handler must parse*.
That is true of `POST /documents/intake` for the same reason it is true of `POST /documents` and of
nothing else in this system. `src/guard.test.ts` names both routes, so a third exemption fails the
suite rather than passing quietly.

**A refused resolution is on the audit log and counts against the cap.** `evidence.intake_unresolved`
carries the declared type, the sniffed extension, the byte count, the file hash and how many
candidates were offered — and no filename, no city, no street and no document text, which is the
same line 3.3 draws. The per-operator bound counts it beside `evidence.file_document`, because 5.2's
argument is that the bound is on what reached intake and not on what survived it: an unresolved
intake has already cost a read and possibly an OCR call.

**OCR runs on this path when the native text layer does not satisfy the declared type**, and only
when a processor is configured — a scan whose address nobody can read resolves to zero candidates
rather than to a 503. Until 6.8 the condition was *no text layer at all*, which is why the demo's
CamScanner layer was never overruled. A document longer than the online call takes has its first
pages read; a file larger than the call carries is refused with the size sentence rather than offered
a candidate list it could never have narrowed.

**It runs once, from slice 6.4.** Until then the same scan was read twice — once here for the place
reader and once inside `fileDocument`, whose own verdict comes back `unverified` on a page with no
text layer — because 6.3 promised to leave that function alone. The fix is not a wider `fileDocument`
but a request that carries what has already been paid for: `IntakeRequest.reading` hands over what
this route already read off these same bytes, and `fileDocument` uses it in place of its own read. A
caller that passes nothing gets the behaviour that was always there, which is what the seeding and
importer paths do.

**From 6.8 it carries the verdict as well as the pages**, because there is now one function that
decides whether OCR is spent, reads, and takes the verdict on whichever reading won
(`readForVerdict`). Handing over only the pages would have left this route and `fileDocument` each
taking the same verdict on the same words by the same rule, which is how the two copies of the wrong
OCR condition came to exist in the first place.

## What this module exports, and what it refuses

`src/evidence/contract.ts` is the whole public surface; nothing outside the module imports
`internal/` ([AGENTS.md](AGENTS.md), proved by `src/kernel/boundary.test.ts`).

- **No query here returns a person.** Documents link to parties, and who those parties are is
  `src/scope/`'s answer and nobody else's — the same rule `src/tenancy/` and `src/parties/` state.
  A document panel shows what is filed, not who signed it (slice 3.6; `tests/ui/tokens.test.ts`
  asserts it from outside, and still does after 5.2 put a session behind the screens and kept the
  rule, and after 5.4 kept it a second time).
- **The catalogue is read at run time, never compiled in.** `listDocumentTypes` and
  `documentTypeFields` are what slice 3.3's guard and slice 4.2's extraction read. A
  `Record<TypeKey, …>` in TypeScript would make A8 true of the catalogue and false of everything that
  consumes it, because a type added as a row would ship unguarded until the next release.
- **Ingest is idempotent on `file_hash`**, and linking is idempotent on the primary key. Filing the
  same file against a second entity adds a link and never a document.
- **`ingested_at` comes from the injected clock**, never `DEFAULT now()`.
- **A list of what is filed never mints a signed URL.** `listLinkedDocuments` and `searchDocuments`
  return the `gs://` path as text. The **documents panel** (unit page, building page) is where
  slice 5.4 mints a fifteen-minute V4 URL, at the composition root, so estate still does not import
  the object store's internals. Search does not mint. A signed URL is a bearer token for one object:
  whoever holds the string reads the document, isolation join or not.

## Finding a document — slice 3.6

The week's demo is a named lease on screen within four seconds of deciding to look for it. Two
reads, both here, because the paper is this module's.

**`listLinkedDocuments(entityType, entityId)`** is the panel's query. It uses the
`document_link_entity` index 3.1 wrote for this access path. Distinct on `document_id`, so a lease
bound to the unit *and* the tenancy is one row, not two. Ordered by type then ingest date, which is
how the panel groups without a second query. Unit A's paper does not appear on unit B.

**`searchDocuments(term)`** is the documents half of `/estate/search`. It extends that screen rather
than forking a second one: same `LIMIT` (60, fetching one past so the list can say it was cut off),
same LIKE-escape at the edge (`%` and `_` are text). It matches type labels, a unit number, a
building name or address — **never a city** (same asymmetry as estate's unit search), **never a
party**, **never a filename** (none is stored), **never the file's text** (that is week 4's
retrieval). Estate composes the two searches at the route; this module does not import estate's
search, and estate does not import this one — `app.ts` injects both.

**The panel shows type, dates, ingest date, a short-lived signed read of the bytes, and the verdict.** A scan
nobody has read yet (`unverified`) must not look identical to a lease whose marker terms were all
found (`verified`). The confirmation screen already said this in words; the panel is where it
becomes a property of a list, which is why `verification_verdict` is a column rather than a scrape
of `audit_log`. Audit is who-did-what JSON and is the wrong read model for a card.

**The card is a door, not a dead end.** `מילים על הדף` is `/documents/:id/read`. A lease also offers
`אישור חוזה` (`/documents/:id/tenancy`). The overlay says when no fields were extracted, rather than
rendering an empty card as if nothing was due. Promote buttons appear only for mapped fields that
are not yet stamped, and only after extraction has written rows.

Building-level paper (`entity_type = BUILDING`, the handover protocol) lists on the building page.
Unit paper lists on the unit page. Grouping is by type heading; a flat list still finds the lease,
and that is the week's cut line.

## Seeding the catalogue — data, not a migration

The seed types live in `src/evidence/fixtures/document-types.ts` and are applied by
`npm run seed:doctypes`, which is **wired into no workflow**, for `src/seed.ts`'s reason: a fixture
that seeds itself on every deploy puts rows into production the next time a `v*` tag is cut.

They are data and not a backfill migration **because the acceptance bar says so**: a new document
type must cost a seed row and a re-deploy of data. If the catalogue arrived in a migration, every
later type would too, and A8's open half would be false the day it was written.

The nine at 3.1: `lease · lease_amendment · termination_notice · arnona · insurance · id ·
bank_guarantee · handover_protocol · inspection_certificate`. The first eight are the published Data
Model's; the ninth has been in the workbook since 3 Sep because SAFETY assets and the compliance tab
need it. **Slice 3.5 added the tenth, `building_handover_protocol`**, because the unit-level protocol
is operator-to-tenant and `building.handover_date` is developer-to-operator — two acts, two forms,
and A8's open half means the second is a seed row rather than a migration. The 3.1 acceptance bar
(a type with four fields of its own costs no DDL) still holds and is still proved on a type that is
not in the seed.

## Flow A6 — seeding from a handover protocol (slice 3.5)

After A1 files a `handover_protocol` or `building_handover_protocol` that the guard verified, the
next screen is a proposal, not a done page. A deterministic reader runs over the same
`documentText` the guard already produced and proposes a handover date, an apartment number
(unit-level) and the appliances whose Hebrew names appear in the file.

**The confirm page recomputes the proposal from the stored bytes.** There is no staging table: the
document is immutable and the reader is a pure function, so holding a copy between GET and POST
would be a second fact that can disagree with the first. A2's equivalent for a model-based proposal
is the same idea over capture: recompute from `extracted_field` plus the unit the document was filed
against.

**Estate writes, evidence does not.** `applyProtocolSeed` on estate's contract is what inserts the
asset rows and updates the dates. Evidence calls it after the administrator confirms, and never
issues SQL against `asset`, `unit` or `building`. A `building_handover_protocol` is filed under the
building (`PlaceKind = BUILDING`), not under the unit the administrator happened to be looking at.

A file with no text layer (`unverified`) has nothing to propose and skips the confirm screen —
OCR at 4.1 is what gives that file a text layer to read.

## Flow A2 — a lease establishes a draft tenancy (slice 4.6)

After A1 files a `lease` that is **verified** and not already bound to a tenancy, the next screen is a
proposal, not a done page. An `unverified` file has nothing to propose and stays on the filed page,
the same skip A6 uses. Extraction has already written `extracted_field` rows on a verified file. The
confirm page **recomputes from those rows plus `getUnit`**. There is no staging table.

**Evidence orchestrates; it does not write estate, party or tenancy SQL.** After the administrator
confirms each proposed person's role and selects an existing `terms_profile` from the list tenancy
already holds, evidence calls `createParty` or `upsertParty`, `upsertTenancy`, `upsertTenancyParty`
and `promoteExtractedField`. The name is never typed and never invented: an empty list shows that fact
and withholds the write. Dates become truth through FieldPromotion (the CHECK is still dates only).
Names do not get a promotion target: party provenance is a `PARTY` / `SIGNATORY` link and the
`evidence.confirm_lease` audit line.

**Role is a POST field.** A missing role for any captured `tenant_name` or `guarantor_name` is
`invalid` and writes nothing. Zero `guarantor_name` rows is success. Two `tenant_name` rows are two
parties. No name is matched against the global party register.

**Cross-check.** Extracted `apartment_number` and `address` are asserted against the unit. A mismatch
is `invalid`: no tenancy, no party, no new link. This is the content check 3.3 deferred.

**Idempotent confirm.** A lease that already has a `TENANCY` / `EVIDENCE` link returns
`alreadyEstablished` and creates no second household.

**Which letting, and the attach branch. Slice 6.5.** Until 6.5 this flow could only *create*: a
second lease on a unit and a start date it already held died on `conflict — that unit already has a
lease starting on this date`, with nothing an operator could do from the screen. `proposeLeaseTenancy`
now carries the unit's lettings from `listUnitTenancies` as **candidates**, and `confirmLeaseTenancy`
has a second branch.

- **Ranking.** Identifier overlap first — `countIdentifierOverlap` returns `tenancy_id` → **a count**
  of how many people already on that letting carry an identifier this lease declares — then the
  number of days the lease's term overlaps the letting's, computed **in TypeScript over the dates
  the list already returns**, because the SQL that would express it is guard two's predicate and
  belongs to `src/scope/`.
- **What is proposed.** A **new draft** by default. An existing letting is pre-selected only when
  this lease's `start_date` equals that letting's — the case that used to be a dead end. Overlap
  ranks the list and never decides it: the same household renewing on new dates is a new letting.
  **A human picks either way**, which is invariant 5 and is unchanged.
- **What attach writes.** The `TENANCY` / `EVIDENCE` link and the confirmed `tenancy_party` rows.
  **Not `upsertTenancy`**, so `start_date`, `end_date`, `status` and `terms_profile_id` are untouched
  and no `terms_profile` is asked for. A lease attached to the wrong letting must not be able to
  rewrite that letting's term; moving a captured date onto a column stays per-field promotion from
  the read screen, one field and one operator at a time. The audit line is `evidence.attach_lease`.
  A second attach of the same document is a no-op, the same `alreadyEstablished` the create branch
  returns.
- **The letting must be on this unit.** A `tenancy_id` posted from the form is checked against the
  unit the document is filed on before anything is written; anything else is `invalid` and writes
  nothing, on the same standing as the address cross-check above.

**How a name gets its identifier, and why it is all-or-nothing. Slice 6.5.** The *i*-th `tenant_name`
pairs with the *i*-th `tenant_id_number` in the order `proposeLeaseTenancy` already sorts people by
(page, then box, then id), **and only when those two counts are equal**. Equal counts → each party in
that family is written with `upsertParty` and its identifier. Unequal → **nobody in that family is
paired**, each of its people is written with `createParty` and no identifier, and the screen says per
person which of the two happened. **`tenant_*` and `guarantor_*` are counted independently**: a
guarantor is frequently absent and frequently printed without a ת.ז. when present (A2 step 3), so one
unpaired ערב must not discard two correctly paired tenants — there was no pairing in that family to
get wrong.
The reason the rule cannot half-succeed is directly below: the operator is not shown the value, so a
ת.ז. bound to the wrong name is an error nobody can see. **Two people on one lease resolving to the
same party is `invalid`** — it would otherwise be one party silently overwriting its own role through
`tenancy_party`'s `(tenancy_id, party_id)` key. **The refusal happens before anything is written**,
through `countDistinctIdentifiers`, so it holds whoever owns the transaction — including a caller
that already had one open, where `inTransaction` passes the client through and there is no savepoint
to roll back to.

**Captured identifiers are not on that screen, and not in its shape. Slice 6.4.** A lease now
declares `tenant_id_number` and `guarantor_id_number`, and `proposeLeaseTenancy` is a screen shape:
it carries the names it always carried and no identifier, so the confirm page cannot leak one whoever
is looking at it. The value is in `extracted_field` and reachable by an ADMIN on the read screen with
an audit line. **Slice 6.5 read it and kept it off the screen.** The resolution above compares
identifiers **inside one SQL statement** and returns a count, so no value and no key reaches this
module's memory, let alone its HTML. What the screen gained is two facts and no digits: per person,
*whether* an identifier was read; per candidate letting, *how many* people it matched. The comparison
is still a read of `national_id_key` and writes **`evidence.match_identifier`** — actor, role,
document, probe count and match count, never a value. It is deliberately **not**
`evidence.read_identifier`: that line means a person saw a ת.ז., and this one means a machine
compared one. A count that conflated the two would be useless for the only question anybody asks it.

**The confirm screen may show captured names.** That is the exception the confirmation step exists
for. It still does not query `party`. Every other screen still shows no tenant's name — 5.2 was
entitled to lift that rule behind its session and **kept it**, and 5.4 kept it again, so this
exception is still the only one. Confirm writes `confirmed_by` from the signed-in operator.

## Flow A3 — an addendum completes a tenancy (slice 4.7)

After A1 files a verified `lease_amendment` **already bound to a letting**, the next screen is the
same confirm path A2 uses (`/documents/:id/tenancy`). There is no second mechanism. An addendum
without a tenancy stays on the filed page: it does not invent a household. An unverified file skips
confirm, the same skip A2 and A6 use.

**The addendum contributes to the existing tenancy.** Evidence does not call `upsertTenancy` and does
not ask for a `terms_profile`. It calls `createParty` and `upsertTenancyParty` for each confirmed
`guarantor_name`, and `promoteExtractedField` for `new_end_date` when capture has one. Zero
guarantors is success. A missing role for a captured name is `invalid` and writes nothing. There is
no address/apartment cross-check: those fields are not on this type, and the letting was chosen at
upload.

**Later document wins; earlier provenance stays.** Promoting `new_end_date` copies onto
`tenancy.end_date` and appends `tenancy_event`. The lease's stamped `end_date` row is not un-stamped.
The unit page lists every stamped capture on the unit, so both values remain clickable.

**Idempotent confirm.** Upload already wrote the `TENANCY` / `EVIDENCE` link, so that link is the
target, not the done flag. A second confirm of the same addendum returns `alreadyEstablished` when
an `evidence.confirm_amendment` audit line for that document already exists, and writes no second
party. Completeness (at least one guarantor) is A4: a query over the rows this confirm writes,
  not a check on this screen. An addendum that adds a `GUARANTOR` clears the incomplete queue.

## Reading a filed document — slice 4.1

The door guard of 3.3 still runs on whatever text the native PDF reader yields. What 4.1 adds is
the second reader, after the row exists, for everything that reader could not see.

**Order, and it is this order on purpose.** Hash → sniff → native-text verify → refuse or file →
**if the filed verdict is `unverified`, OCR the stored bytes** → re-run `verifyDeclaredType` on the
OCR text. The OCR step is after the write because a refused upload still writes nothing, and because
a scan that OCR cannot finish must not become a 503 on the upload: the bound is 20 seconds, a miss
leaves the row `unverified`, and the HTTP response is the filed page.

**Slice 6.8 moved the upload's own OCR in front of the write, and this section is now about rows that
are already on file.** The order above was written when the *only* OCR on the upload path ran after
the row existed, and its reason — a refused upload writes nothing — is what made a second reader
after the write look necessary. It is not: a reading taken before the write is still a reading taken
before anything is written, and the refusal is then made on it. So `fileDocument` reads once, up
front, and the after-the-fact promotion is `readFiledDocument` and `sweepUnverified` — the backlog
path, for the documents filed before a processor existed. A miss on the upload still leaves the row
`unverified` and still never becomes a 503; the bound is still 20 seconds.

**The sweep only promotes `unverified` → `verified`.** The CHECK on `document.verification_verdict`
is `verified | unverified | unguarded`. Terms found after OCR update the column and write a second
audit line (`evidence.read_document`). Terms still missing leave `unverified` — the file is already
filed, and 3.3's refused-writes-nothing still holds at the door. `refused` is not a stored verdict
and 4.1 does not invent one.

**Two readers, one page shape.** A native PDF with a text layer is pdfjs (confidence `null`). A
scan, a photograph, or a PDF whose pages came back empty is Document AI (confidence set, boxes from
the OCR engine). Images skip pdfjs. More than 15 pages is not sent whole: on the sweep the row stays
`unverified`, and **on the upload path, from 6.8, the first fifteen pages are selected and read**
rather than the file being filed as though it had been read. The overlay (`GET /documents/:id/read`) draws those boxes on the page image the
processor already returned — logical CSS, specimens. **From 6.6 a word box carries its word only
for a viewer holding `party.national_id.read`**; below it the boxes are geometry and nothing
else. **Which page** is a query
(`?page=`, 1-based, matching the stored field). Clicking a promoted value is 4.4's.

`sweepUnverified` walks already-filed `unverified` rows the same way. It is how week 3's backlog is
discharged; the count of verdicts that moved is recorded in the slice evidence, from the audit
lines, and is allowed to be zero.

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
  **`verification_verdict` is a different column**, added at 3.6: the three filed outcomes of the
  door guard, not the review-queue vocabulary, and `refused` is still not a row.
- **`superseded_by`** — [SPEC-flows.md](SPEC-flows.md) invariant 2 already moved this: an addendum is
  not patching a document, it is contributing a value to a tenancy, so supersession is a fact about
  **values** and lives with their provenance (4.2, 4.3). A genuinely re-issued document — a corrected
  ארנונה bill, a renewed certificate — is answered by `valid_from`/`valid_to`, which E12 has: the
  current one is the one whose window covers today, which is a fact rather than a pointer somebody
  has to remember to set. **Re-asked at 5.4 and again at 5.5, still omitted.** Two promotion
  targets (`tenancy.start_date`, `tenancy.end_date`), six mapping rows, and the stamped-row count
  in `tasks/evidence/5.5.md` still found no case the ruling does not cover.
- **`tenant_visible`** — a per-row boolean deciding what a tenant may see is a **second access
  control standing beside the isolation join**, and foundation rule 1 is that the scope is a view and
  never a column. A model that misbehaves cannot widen a scope it never held, but it can be handed a
  row whose boolean someone flipped. What a tenant may see is derived from `document_link` through
  `src/scope/`. If week 9 needs a class of document that is admin-only even inside its own tenancy,
  that belongs on the **type** — one row, one rule, readable — and not on each document.
- **`uploaded_by`** — **slice 5.4 added it** (`0024_document_uploaded_by.sql`): nullable
  `uuid REFERENCES staff_account`. Not `-- pii` — it is a staff id, like the other FKs to that
  table. Rows filed through `POST /documents` name the signed-in operator. Rows ingested before 5.4,
  and callers with no session (seed, importer), stay null. A re-ingest of the same hash keeps the
  first uploader (`COALESCE`). The `evidence.file_document` audit line still names the actor for the
  per-caller cap; the column is the fact other code may join on.

## FieldPromotion (slice 4.3, `src/kernel/migrations/0018_field_promotion.sql`)

The governed half of A8. Capture stays a row. Becoming a typed column costs a reviewed mapping, and
the CHECK on `target` is that cost: a new business column the isolation join or the responsibility
matrix could read cannot be added by seeding a catalogue field.

- **There is no `promotes_to` column anywhere in E15 or E16** (slice 3.0). A promotion target as a
  catalogue row would make promotion a row, which is the half A8 governs.
- **`field_promotion`** — one mapping per declaration. `document_type_field_id` is unique: a field
  promotes to at most one column. `target` is `tenancy.start_date` or `tenancy.end_date` this slice.
  Extending that CHECK is a migration. Mapping *rows* are seed data, applied by the same function as
  the catalogue, because they point at ids that only exist after `seed:doctypes`.
- **Stamp on `extracted_field`.** `promoted_to`, `promoted_by`, `promoted_at` — nullable until a
  promotion succeeds. `promoted_by` is `-- pii`: it names the operator who signed the copy. It stays
  a snapshot string, not a staff FK, because what it records is who signed the copy at that moment,
  not a row that can later be disabled. From 5.4 the HTTP path fills it from the session's email;
  there is no typed name field. Empty is `invalid`. Confirm (`confirmed_by`) is the same snapshot,
  filled the same way.
- **The database is what refuses a stamp outside the command.** A trigger rejects UPDATE/INSERT of
  the stamp columns unless `dona.promoting` is `on` for the transaction (`restrict_violation`, the
  same class as `document_is_immutable`). A DELETE of a stamped row is the same rejection. Direct
  writes to `tenancy.start_date` stay legal — the register importer writes those columns without a
  document, and locking them would break week 2.
- **`promoteExtractedField`** is the command. It requires a mapping row, a `TENANCY` link on the
  document, and a non-empty promoter. It asks tenancy to apply the typed value (dates only, this
  slice), then stamps. An unmapped field (`apartment_number`, `address`, `tenant_name`,
  `guarantor_name`) is capturable, listed, searchable, and **incapable** of becoming business truth:
  the command returns `invalid` and the tenancy row does not move.
- **R9.** Nothing in `src/policy/`, `src/scope/` or `src/calls/` may mention `extracted_field`.
  Isolation, responsibility and the state machine read typed columns. A contract test scans those
  trees.

## Provenance viewer (slice 4.4)

A promoted value on the unit screen is a link to the pixels it came from. Capture stays a row;
the click is an `href`, not a script.

- **No client JavaScript.** The screens have never had any ([SPEC-estate.md](SPEC-estate.md)). The
  link is `/documents/:id/read?page=N#f-<extracted_field_id>`. The overlay draws the field's stored
  union box with that `id`; the browser's `:target` and `scroll-margin` do the rest. A hash is not
  sent to the server, so the page number cannot live only in the fragment.
- **The box is the field's, not every word.** Word boxes stay as 4.1's overlay. The highlighted
  rectangle is `extracted_field.bbox` on that page. Confidence is shown next to the value (a percent
  when Document AI scored the words; omitted when pdfjs stored `null`).
- **Estate does not query `extracted_field`.** `listPromotedFieldsForUnit` lives here and is
  injected the same way `listLinkedDocuments` already is, so the estate ↔ evidence cycle stays
  broken. The list is every stamped field on paper linked to that unit (the unit itself, or a
  tenancy of that unit). Unmapped capture does not appear: it never became a value on the unit.
- **Still no names.** The only mappings this week are dates. A name that extraction captured stays
  on the read page and off the unit screen — 5.2 chose not to change that, and 5.4 did not either.

## Later in this module, and not here yet

A lease establishing a draft tenancy is 4.6. The accuracy number is 4.5 and waits on the corpus.
