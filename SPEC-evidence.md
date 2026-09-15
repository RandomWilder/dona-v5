# SPEC: evidence

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The tables below are the
workbook's ([docs/model/](docs/model/)) and it is the specification they are measured against; where
this file and the workbook disagree, the workbook is right and this file is a bug.

- **Owns:** the paper, and every value that traces back to it. A **schema-driven ingestion engine, not
  a lease parser**: its inputs are a document, a declared type, and that type's field schema.
- **Entities:** E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField ·
  ExtractedField · FieldPromotion · **Passage** (#103).   Retrieval over that store takes a required
  **Stance** (#104) and a required **retrieval bound** (#112).
- **Depends on:** estate, parties, tenancy.
- **Builds:** week 3 (slices 3.1–3.3, 3.5's confirm screen, 3.6) and week 4 (OCR at 4.1, comprehension
  at 4.2, promotion at 4.3, A2's draft tenancy at 4.6, A3's addendum at 4.7). **The stub gained content at slice 3.1**, which
  is the signal its build started. ExtractedField landed at 4.2; FieldPromotion lands at 4.3.
- **Carries:** **capture is open, promotion is governed** ([archive/tasks-w1-7/plan.md](archive/tasks-w1-7/plan.md) A8). A new
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
  `value_type` has no `MONEY` member, and it does not need one: an amount is a `NUMBER` beside a
  `TEXT` currency, which is how `lease` declares its rent and its deposit from 15 Sep 2026
  ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md) retired foundation rule 2).
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
- **A NUMBER value is a bare number.** `12,500 ₪`, `12.500`, `₪ 12 500` and `12,500.00` are all the
  paper's way of printing twelve and a half thousand; capture stores `12500`. Thousands separators,
  spaces, currency symbols and a trailing `.00` are stripped, a decimal point that carries real
  digits is kept, and a value with nothing numeric left in it is dropped — no row, the same as a
  `DATE` that is not a calendar day. **The currency is a field of its own**, never inferred from the
  symbol that was stripped: `lease` declares `rent_currency` beside `rent_amount` and
  `deposit_currency` beside `deposit_amount`, because a lease may price the deposit in one currency
  and the rent in another ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)).
  Each amount's hint names the amounts it is *not*, the way the two identifier hints do, because a
  lease prints the rent, the deposit and a penalty rate on one page and all three are runs of digits.
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
    `mayReadIdentifiers` stance; false drops the identifier rows and prints **a count**
    instead — a state and a count, never the value, which is the rule this console has kept since
    5.2. Only `party.national_id.read` sets it true, and only ADMIN holds that.
  - **Disclosure writes `evidence.read_identifier`** — actor, role, document and the field keys, never
    the value (SPEC.md: PII never in logs). Withholding is not a read and writes nothing.
  - **The page transcript is withheld too. Slice 6.6, rewritten at #102.** The rule acquired its
    third subject and its sharpest sentence: **captured is governed; printed is the document.** Until
    #102 the overlay drew one `<span class="word-box">` per measured word and carried the word's own
    text in a `title` attribute, so a ת.ז. printed on the lease was readable by an OPERATOR on the
    same page whose captured row was correctly withheld — found by clicking at 6.5, where the
    captured-row gate scored admin **1** / operator **0** and the overlay scored **1** for both.
    **#102 deletes that overlay.** There is no page image, no word box and no field box. The
    transcript is now the per-page text on `/documents/:id/read`, and it is rendered only when
    `mayReadIdentifiers` is true. Withheld **wholesale rather than word by word**: a run split
    across OCR tokens (`312`, `345`, `678`) matches no pattern applied to one token, and the type's
    catalogue declaration is the wrong gate because a declaration governs what is *captured*, not
    what a page happens to print. Each extracted value is labelled with the page it was read from,
    which is how an administrator checks the paper they still hold.
  - **There is no page image to withhold.** The same viewer already holds a fifteen-minute signed
    read of the document's bytes (5.4). OCR runs in imageless mode and returns words, not pictures.
    What the permission governs is this system's own copy — the row, the transcript,
    `party.national_id` — and saying so plainly is worth more than a control that is believed and
    absent.
  **No `field_promotion` target for either field**, deliberately: the identifier becomes
  `party.national_id` when a human confirms a household (A2), which is an act and not a promotion.
  `listExtractedFields` keeps returning every row, because it is this module's internal truth — what
  is gated is the response shape, and that is where the gate is.
- **Re-extract replaces unstamped rows only.** A row with `promoted_at` set is a promotion that
  already became business truth; deleting it would erase the stamp. The database refuses that
  DELETE. **From 7.3 an approved row is spared on the same reasoning** — an approval is a person's
  attestation and re-reading the page does not unsay it — so extract deletes rows where
  `promoted_at IS NULL AND approved_at IS NULL`, then inserts. Adding a field to the
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

**From 6.10 that lookup does one more thing**, and it is the same step rather than a new one: the
path it finds *is* the document's anchor, so the same bytes offered against a second place are
refused there — before the `put` and before the ingest, which is what makes *nothing was written* a
property of the order rather than a promise (*The same bytes are one document, and one anchor*).

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
- **A refusal names every requirement that was checked, not only the ones that failed (slice 7.1).**
  `Verification` carries `matchedTerms` beside `missingTerms`, and the screen prints both with their
  found / not-found state. The rule is auditability rather than helpfulness: a lease declares three
  requirements, and a refusal that printed two of them told the person reading it that two things
  were looked for. They cannot tell a declaration that is wrong from a file that is wrong without
  seeing the whole of what was asked. `missingTerms` keeps its meaning exactly — it is still the
  refusal's cause and still what the audit line records — so nothing downstream moves. Both lists
  are the *form's* own printed words, never anything the document says, which is what makes them
  safe to render at all. The director's comment on `mockups/document-intake.html` is what found
  this, and it found it in the screen rather than in the declaration it was aimed at.
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

### The same bytes are one document, and one anchor — slice 6.10

The same bytes are one document forever: `ingestDocument` conflicts on `file_hash` and returns the
row already holding them. That is 3.1's rule and it stays. **What 6.10 decides is the question 3.1
and A1 left open — which place that one document is *about* when it has been filed against two.**

**A document's anchor is the place it was first filed against, and it is the place its own
`storage_uri` names.** That value is written once and is immutable (`document_is_immutable`, slice
3.1); the first path filed stays authoritative whatever a later caller computes (slice 3.2). So the
anchor already exists, on the row, and is already unique — it was simply never the thing any screen
read.

**Filing bytes that are already on file against a *different* place is refused.** The refusal names
the place the document is already anchored to. No `document` row is updated, no `document_link` is
added, and no object is written — the same statement 3.3 makes about a caught upload, for a
different cause. Filing them against the **same** place is unchanged: a no-op on the document row,
plus whatever link the caller came to add.

**Refused rather than re-anchored, and the ruling is the director's own of 14 Sep read one level
down.** Four reasons, in the order they decided it:

- A `SUBJECT` place link is the sentence *this document is about this flat*. Two of them are two
  contradictory answers, and any rule that picks one — first, last, lowest id — is the system
  guessing. Slice 6.11 settled the standing form of this: **a confident wrong anchor is the
  dangerous failure and a refusal is the safe one**, because a null asks a question and a wrong
  reading files a lease against a flat nobody chose.
- Re-anchoring means the last filing wins, which silently rewrites what an earlier screen said about
  an earlier flat. That is the week-6 demo's own defect with a different winner, not a fix for it.
- The document's bytes live at a path under the first place. A second anchor makes the row claim a
  flat its own `storage_uri` denies, and one of the two has to be wrong.
- A refusal here is actionable, which is 6.8's bar for one: it names the flat, and the operator who
  meant the other flat now knows this paper was already filed — usually the more useful fact than
  the upload they were attempting.

**R13 is untouched at the table.** One document still binds to many entities: a lease is `SUBJECT` of
its unit, `EVIDENCE` of a letting and `SIGNATORY` of two parties, and `src/evidence/schema.test.ts`
still proves it. What is unique is the **place**, and the guard lives in `fileDocument` — the flow —
rather than in the DDL, because the table's generality is R13's and the anchor is A1's.

**Which place a screen is about is read from `storage_uri` and no longer from `document_link`.**
`anchorOf` is that read and both call sites use it — the lease confirm screen (`unitIdOf`) and
`/documents/:id/read`, each of which took an unordered `LIMIT 1` over the links until here and could
return either row. Deriving the anchor from the path is deterministic by construction rather than by
an `ORDER BY`, and it is also **right for the rows already in the wild**: a document that collected
several `SUBJECT` links before this rule existed resolves to the flat its bytes are filed under,
which is the flat it is actually about. The parse takes no bucket, deliberately — *which flat is this
about* does not depend on which bucket holds the copy. Reading the **bytes** still goes through
`parseStorageUri` and still refuses a foreign bucket.

**What this does not give anybody: a way to move an anchor.** A document filed against the wrong flat
stays filed against it, and correcting one is a deliberate act with its own audit line and its own
screen. Nothing needs it yet; the day something does, it is a slice and not an edit to this one.

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

### The documents tab — `GET /documents` (slice 7.1)

The rail's `מסמכים` destination, and the tab's landing. It reads the catalogue and shows **the
declaration a reader will look for before anybody chooses a file**: the type picker
(`listDocumentTypes`), and for the chosen type every current field declaration
(`documentTypeFields`) — key, label, value type, required, extraction hint — under a
`גרסה <effective_from>` chip. Closed declarations (`effective_to IS NOT NULL`) are not shown, which
is the date parameter doing its job and not a filter written here.

**It is read-only and it writes nothing.** The declaration becomes editable at 7.2 (the section
below) and the approval
table arrives at 7.3; this screen exists so that what the system will read off a page is legible
before a page is filed, which is the thing week 6's demo could not see anywhere.

**It carries `documents.write`, the same gate as the rail item that reaches it.** An ungated landing
behind a gated rail is the door that answers `not_allowed` after somebody has already walked through
it — 6.1's refusal-after-typing, which A11 refused to build for its own form. The permission names
the act the tab is for: this is the filing tab's front page, not a reading of what is filed.

### One orchestrator, two doors — ticket #109

The commands that file, extract and approve already exist (`fileDocument`, `extractFiledDocument`,
`approveExtractedField`, `approveUnflagged`). What #109 adds is **the path through them**, not a
second copy of any of them.

`destinationAfterFiling` is that path. Both upload doors — unit-first `POST /documents` and A12
`POST /documents/intake` — call `fileDocument` and then this function, so a verified lease lands on
the approval ledger (`GET /documents/:id/fields`) rather than on the confirm screen that used to
follow it. A protocol still goes to seed; an addendum still goes to its confirm; a refusal still
writes nothing. The unit's document list is a second door into the same destinations, not a second
mechanism: a lease there opens the ledger.

**#110: creating the draft follows the approved reading, with no confirm screen.** After a lease
reading is stamped — every extracted name row, and both dates — `establishApprovedLease` writes the
draft tenancy on the unit the document was filed against and the operator lands on that letting's
page. Roles come from the field family the name was read into; an unstamped name writes no party.
`GET`/`POST /documents/:id/tenancy` remain for an addendum only; a lease hitting them is sent to
the ledger, or to the letting if it already exists.

**The maintenance annex is not read off the lease.** The published forms do not print which
`terms_profile` governs the letting, so it is not a declared field. A new draft takes
`נספח תחזוקה — תקן` when that name exists, otherwise the sole profile in the register, otherwise it
refuses rather than invent a row. Changing the annex later is a tenancy-page write, not this path.

**The attach branch is gone.** A lease defines a letting; a second lease on the same unit and start
date is `conflict` with that reason, not a silent join onto the household that is already there.
Filing a further copy against the existing letting remains the way to add evidence. Identifier
pairing at write is unchanged.

### The approval ledger — `GET /documents/:id/fields` (slice 7.3)

Flow **A15**, and the three routes it is made of — the ledger (`documents.read`), the signature
(`POST …/fields/approve`, `documents.write`) and the reveal (`POST …/fields/reveal`,
`party.national_id.read`, the first route in this system to *declare* that permission rather than
consult it). What the stamp is, why `value` is never overwritten, what the read-quality number
actually measures and why an identifier is never bulk-approved are all in **"Approval — the stamp
that is not a promotion"** below, beside the columns they are about. Two facts belong here with the
other routes: **the ledger reads no bytes** (the page count and reader line the paint drew would
have cost an OCR call or a pdf parse per view; from #103 `/documents/:id/read` paints stored
passages and neither screen re-reads the file), and **the declarations it lists are the ones governing the day the extraction ran**, never
today's — a field declared this morning is not something last month's lease failed to carry. 7.3
also **moved the `קדם` buttons off the read overlay**: two screens writing the same row is how the
two drift into disagreeing about which one is the flow.

**#109 redraws the ledger from the #100 paint.** The table leads. Every value row carries the page
it was read from. The reading's quality verdict sits in the head — `טובה` when at least one field
was measured, `לא נמדדה` when every field arrived with no score, which is also when
`אישור כל מה שלא סומן` is withheld. Explanation is behind a `<details>`. A name row prints the role
the field carries (`tenant_name` is a tenant, `guarantor_name` is a guarantor who is never a service
contact). Amounts are ordinary rows: after #101 they are.

### The declaration becomes editable — `POST /documents/types/:typeKey/fields` (slice 7.2)

Flow **A14**. The tab's landing showed the declaration at 7.1 and wrote nothing; this is the write
behind it, and it is what makes foundation rule 8 true of both halves — a type has been a row since
3.1, and from here a **field** is a row too, with no migration, no seed and no deploy.

**`declareDocumentTypeField` and `retireDocumentTypeField` are the commands, and
`upsertDocumentTypeField` is untouched.** The upsert is the seed's idempotent re-apply — its
`ON CONFLICT … DO UPDATE` is what lets `npm run seed:doctypes` run twice, and it is precisely the
edit R18 forbids at run time. Two functions rather than one widened one: the seed re-states a
declaration it already owns, and an administrator supersedes one.

**A correction closes the live row at the day *before* today and opens the new one today**, both
inside one transaction (`inTransaction`, `src/kernel/db.ts`). The day before, and not today, because
`documentTypeFields` is inclusive at both ends — `effective_from <= on AND (effective_to IS NULL OR
effective_to >= on)` — so closing at today would leave **two live rows for one field**: the screen
would print the field twice and extraction would hand the model the same key twice. The seed has
always used this convention (`2026-09-07` closed, `2026-09-08` opened) and so has
`schema.test.ts`; the route now uses it too. The superseded row is never updated in any other
respect, so a value extracted last month still points at a declaration that still says what it said.

**Declaring the same field twice in one day is a `conflict`, and the refusal is the honest one.**
The natural key is `(document_type_id, field_key, effective_from)`, so a second declaration today
has nowhere to go — and closing today's row at yesterday would invert its own window against
`document_type_field_version_is_ordered`. The command refuses before either constraint fires and
says why: the declaration being superseded has governed no extraction on any other day, so there is
nothing to supersede.

**Retiring closes the row and inserts nothing.** The catalogue's rule is deactivate, never delete,
and a field is no different: `extracted_field` rows point at the closed declaration and stay
explicable by it. It is here rather than in a later slice because corrections key on `field_key` — a
mis-typed key cannot be corrected, only declared again beside its own mistake, and an editor whose
first typo is permanent is a trap.

**There is no money guard on this route, and there was one until 15 Sep 2026.** A declaration whose
`field_key` or `label_he` carried a money word — eight Latin tokens, eight Hebrew substrings, in
`src/evidence/internal/money.ts` — was refused with a sentence naming foundation rule 2. That rule
is retired ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)) and the guard is deleted
with it, along with its re-exports on the module contract and the policy case that read the same
vocabulary. **Nothing replaces it.** A declaration naming an amount is an ordinary declaration:
`settings.write`, a new row at a new `effective_from`, an audit line. The reason the guard is not
kept in a weakened form is in the ADR — it could not tell a rent from a balance, because both are
spelled with the same eight words, so it refused the honest case (`rent_amount`) and admitted the
dishonest one (`extra_1`, labelled anything).

**`settings.write`, and `roles.ts` does not change.** ADMIN only, and already the hand on the
`DocumentType` catalogue since 5.8. A permission with one reader adds vocabulary without adding a
boundary; the matrix stays code.

**The form is on the screen only for a role that may post it**, which is `/settings`'s shape and not
6.1's. `GET /documents` keeps `documents.write` — an OPERATOR reads the declaration and never sees
the form, so the door that answers `not_allowed` after somebody has typed into it does not exist
here. **Refusals are the JSON error body every other form post in this system returns** — the role,
the forged token, the same-day redeclaration: one refusal shape per route, and a refusal screen for
this form is a decision nobody has asked for yet.

**Every declaration writes an `audit_log` line** — `evidence.declare_field`, naming the type, the
key, the value type and the day, and never a document's text. A schema change is the one write in
this module that could not be reconstructed afterwards from the rows it left behind.

### Filing without a unit — flow A12 (slice 6.3)

`GET /documents/new` **with no `unit`** is a screen of its own: the type, the file, and no flat. The
same path **with** a `unit` is 3.3's screen, unchanged, reached from a building page. The post behind
the new screen is `POST /documents/intake`, and everything it does before it knows where the document
goes is the order 3.3 fixed, with one step inserted in front of it: **read the text → read the place →
resolve the place → then `fileDocument`, unchanged.**

**The reader is deterministic, and its anchors are printed here because somebody has to write a lease
that matches them.** It is a pure function over the document's text (`src/evidence/internal/place.ts`),
the exact analogue of A6's protocol reader, and it reads three things:

- **the street and number, in two tiers.** **Tier one is the property's own label** —
  `כתובת המושכר:`, `כתובת הנכס:`, `כתובת הדירה:` — and it is trusted wherever in the document it
  stands, because a qualified label names the property and nothing else. **Tier two is an address
  written into a sentence** — a bare `כתובת:`, or a `רחוב` / `ברחוב` that starts the address — and it
  is read only when tier one found nothing and only when the line it stands on does not name a party.
  `רקפת 12` and `רחוב רקפת 12` are the same address to it. **The tier decides, never the position:**
  on a standard form the parties are printed above the property clause, so leftmost-wins reads the
  wrong one.
- **the city** — whatever follows the address's comma, up to the next comma, full stop, semicolon
  **or line end**. So `כתובת המושכר: רקפת 12, שוהם.` reads as street `רקפת 12` and city `שוהם`. The
  city is read from whichever address was accepted, so an address that was rejected takes its city
  with it.
- **the apartment number** — `דירה 12`, `דירה מס׳ 12`, `דירה מספר 12A`, `דירה מס ' 206-7`. The same
  shape 3.5's reader uses, because it is the same sentence on a different form — widened at 6.11 for
  a **hyphenated** number and for the space a scanner leaves before the apostrophe. The hyphen is not
  a separator: `206-7` is one flat's number, and `foldPlace` drops it anyway when the number is
  matched against a unit.

Anything it cannot find is null, and null is not an error: it is the refusal below, which is a screen.

**A party's address is not the property's, and telling them apart is the whole of slice 6.11.** Tier
two's needle used to be a bare `רחוב`, which matches inside `מרחוב` — the word that introduces a
person's residence on a standard form and never a property. On the week-6 demo's own paper the reader
returned `דם המכבים 38`, which is the landlord's street. **A null reading asks a question; a wrong one
files a lease against a flat nobody chose**, and this reading was one ordinary lease away from doing
it: a party line with a town after its comma yields an exact `building.address_key`, one unit comes
back, and nothing between the read and the filing asks anybody. So the needle is anchored against a
Hebrew letter to its left — which keeps `ברחוב` and drops `מרחוב` — and a tier-two match whose own
line carries an identity marker before it (`ת.ז`, `ת"ז`, `תעודת זהות`, `ח.פ`, `המתגורר`) is skipped
for the next match; where there is no other, **the reading is null**.

**A12 does not read an annex, and from slice 6.9 it can say which document deferred to one.** 6.11
ruled the annex out and left the screen unable to tell an operator that it had: a lease that named its
property perfectly well, in a נספח, produced the same `לא נקראה כתובת` as a blank page. So the reader
returns a fourth value beside the three above — **a deferral marker**, true when the body says
`כמפורט בנספח` or identifies the property by `גוש` and `חלקה` where no address was read. It is
literal and narrow for `PARTY_LINE`'s reason, and it is **a display fact and never a resolution
input**: `resolvePlace` does not read it, so a marker that is wrong changes a sentence and never a
filing. The ruling it reports is unchanged, and is this:

**A12 does not read an annex, and says so rather than guessing.** The real project lease describes the
flat as `כמפורט בנספח א'` and identifies the property in the body by `גוש`, `חלקה` and `מגרש`; the
published standard form defers the same way (`docs/corpus/lease-standard.md`), so this is the shape of
the form and not one specimen's defect. Three reasons the annex is not chased: it sits past the pages
the online OCR call reads, and because the byte bound is on the request carrying the whole file (6.8)
**no selection of the front of a document can ever contain it**; a parcel identification has nothing
to resolve against, the estate being keyed on `building.address_key` and holding no `גוש`; and the way
through already exists — the candidate list, the search box, and A12's offer to create. **A document
that says its address is somewhere else is one A12 cannot place, and saying so is a correct answer.**

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

**The resolution says which building it matched, not only which units. Slice 6.9.** An address whose
key matches a building holding no flats used to fall through to the street search, so the screen could
not tell *the building is here and the flat is not* from *nothing here at all* — and those are the two
cases the create offer has to choose between. `findBuildingAtAddress` answers it with the same keys and
the same `=` the unit lookup uses, and the answer reaches the screen and never the filing: resolution
is still exactly-one-unit-or-a-question.

**What the screen does with a refusal is [SPEC-flows.md](SPEC-flows.md) A12's** — four causes, four
sentences, and the create offer to a role holding `estate.write`. What belongs here is the one bound
that offer does not relax: **an exact key match is still the only thing that files without a human.**
Creating a building from the refusal is a second request, posted by an admin, through A11's own
validation; the document is filed on a third. Nothing in the create path shortens the read → resolve →
file order, and nothing holds the bytes across any of it.

**The receipt names what was read and where it landed.** `renderFiledPage` was written for A1, where a
human had already chosen the flat and the only interesting fact was the verdict. On A12 nobody chose:
so the receipt leads with the address, the town and the apartment number the reader read, and the flat
the document is now anchored to. On the candidate branch there is no reading — the operator picked —
and it says that instead, because printing a reading there would be printing one that was never taken.

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
  same file against a second entity adds a link and never a document — **and against a second
  *place* is refused from 6.10**, which is the one entity a document has exactly one of (*The same
  bytes are one document, and one anchor*, above).
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

**Amended 15 Sep 2026: role comes from the field family, and the ledger stamp is the confirmation.**
The director ruled that a select asking a person to name the role of `שם הערב` is a second way to say
what the field name already says. The role is not a value read off the page; it is carried by
**which declared field the name was read into**, so `tenant_name` is a tenant and `guarantor_name` is
a `GUARANTOR`. What a human must still do — and invariant 5 is unchanged — is affirm the *reading*,
which they already do on A15's ledger, one row and one edit box at a time. So the rule above becomes:
**a captured name row with no approval stamp writes no party**, on exactly the standing a missing
role had, and an approved one writes its family's role. The confirm screen this paragraph was written
for is deleted; #110 wires the write. The `is_service_contact = false` on `GUARANTOR` is still the
database's CHECK and not the caller's promise, which is why this is safe to move: the one distinction
with an isolation consequence is enforced where a wrong answer is rejected rather than accepted
politely.

**Cross-check.** Extracted `apartment_number` and `address` are asserted against the unit. A mismatch
is `invalid`: no tenancy, no party, no new link. This is the content check 3.3 deferred.

**And the screen says which of its four facts failed. Slice 6.9.** The cross-check is a conjunction of
four — the address was read, the apartment number was read, the address matches the unit, the number
matches it — and until 6.9 all four printed *the address or the apartment number in the document do not
match the flat it was filed against*, which is true of a scan that read nothing and of a lease filed
against the wrong flat, and asks the operator for two different things. The proposal returns the four
facts; `matchesUnit` stays their conjunction, so what *writes* is unchanged and only what is *said*
is four sentences instead of one. **A field that was not read is not a mismatch** — that distinction
is the whole point, and it is the same one A12's refusal screen draws.

**Idempotent confirm.** A lease that already has a `TENANCY` / `EVIDENCE` link returns
`alreadyEstablished` and creates no second household.

**Which letting. Slice 6.5's attach branch is deleted at #110.** A lease **defines** a letting. A
second lease on the same unit and start date is `conflict — that unit already has a lease starting
on this date`. There is no prompt and no silent attach. A further copy of the paper is filed against
the letting that already exists. `proposeLeaseTenancy` no longer ranks candidate lettings; an
addendum is already bound and never was.

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
guarantors is success. A missing role for a captured name is `invalid` and writes nothing — read
under A2's amendment of 15 Sep 2026, which makes the role the field family's and the approval stamp
the confirmation, so on this flow it is an unstamped `guarantor_name` row that writes nothing. There
is no address/apartment cross-check: those fields are not on this type, and the letting was chosen at
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
scan, a photograph, or a PDF whose pages came back empty is Document AI (confidence set, boxes used
only while extracting so a field knows its page). Images skip pdfjs. More than 15 pages is not sent
whole: on the sweep the row stays `unverified`, and **on the upload path, from 6.8, the first fifteen
pages are selected and read** rather than the file being filed as though it had been read. **#102
deleted the overlay.** `GET /documents/:id/read` shows the per-page text, the quality verdict, and
the page number beside each extracted value — never a page image, never a word box, never a field
box. The OCR request runs in imageless mode. **From 6.6 the transcript is shown only to a viewer
holding `party.national_id.read`.** **Which page** is a query (`?page=`, 1-based, matching the stored
field). Clicking a promoted value is 4.4's.

**#103 keeps the reading.** `readForVerdict` remains the only decision point that chooses native text
versus OCR. Its output fans out to three destinations: the verdict, the extracted fields, and one
**passage** per page — document, page number, ordinal, the text as printed (identifiers included,
unmasked), and an embedding at the welded dimension. Masking is a later read, never a write: masking
here would both hide a tenant's own identifier from them and corrupt the vector. **No vector index**
([ADR-0009](docs/decisions/ADR-0009-passage-embeddings-have-no-index-yet.md)). An unconfigured
embedder is the same shape as an unconfigured extractor: the document is still filed and no passages
are written — documents without passages, including the pre-#103 archive, are #105's sweep.
**Viewing a reading that has passages does not re-read the bytes.** `GET /documents/:id/read` paints
stored passages when they exist; without them it still reads the file, which is the archive path.

**#104 searches the passage store.** `searchPassages` takes a question, an embedder, a required
**stance** — administrator or tenant, never defaulted — and a required **retrieval bound** — a Unit,
a Building, or the whole portfolio, never defaulted, so no caller searches the whole store by
omitting a filter (#112). Each hit carries the document, the page, the text, the document type, the
flat the document is anchored to (the `UNIT` link, or the tenancy's unit when that is the only
place-binding), and a distance. Distance orders the results and is never asserted on. A Unit bound
returns only Passages of Documents linked to that Unit (a `UNIT` link, or a `TENANCY` link whose
tenancy's unit is that Unit). A Building bound is the same command with a wider filter: Documents
linked to that Building, or to a Unit in it, or to a tenancy of a Unit in it. A portfolio bound is
the whole store, named. The administrator stance returns identifiers as printed. The tenant stance
masks identifier-shaped runs in the returned text and does not rewrite the stored passage. A
Building or portfolio bound asked with tenant stance is refused at the command. Masking is not a
reveal: a reveal of a withheld identifier remains `POST /documents/:id/fields/reveal` and still
writes `evidence.read_identifier`. There is no tenant-facing surface on this command yet. The
page-sized chunk and this search are retrieval configuration, so rent and deposit questions enter
the golden set against an explicit portfolio bound, and a Unit-bound case asserts that a neighbour
Unit's answering Passage is absent, ranked against the corpus fixtures and ratcheted to the rank
the day they land.

**#105 backfills the archive.** Documents holding no passages — filed before #103, or filed with an
unconfigured embedder — are walked by `sweepMissingPassages` the way `sweepUnverified` walks
`unverified` rows: one at a time, optional id filter, a report of examined / written / unchanged /
failed, allowed to be zero. Each document is read through `readForVerdict` and written through
`writeDocumentPassages`, so a backfilled document is searchable on the same terms as one filed today,
and a second run over a swept corpus examines nothing. The write is already idempotent on a document
that has passages, so re-running never duplicates a page. The entry point is `npm run passages:sweep`,
wired into no workflow, the same standing as `ocr:sweep`: an unconfigured embedder prints NOT RUN
rather than a measured zero.

`sweepUnverified` walks already-filed `unverified` rows the same way. It is how week 3's backlog is
discharged; the count of verdicts that moved is recorded in the slice evidence, from the audit
lines, and is allowed to be zero.

## What E12 deliberately does not carry

The published [Data Model](docs/data-model.html)'s `Document` card lists four columns the workbook's
E12 does not, and the Data Model is the authority on what the system is — so each omission is a
decision with a reason, made at slice 3.1 and recorded in [archive/tasks-w1-7/evidence/3.1.md](archive/tasks-w1-7/evidence/3.1.md).
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
  document, a non-empty promoter, and **from 7.4 an approval stamp on the row**. It asks tenancy to
  apply the typed value (dates only, and 7.4 ruled that it stays dates only), then stamps. An
  unmapped field (`apartment_number`, `address`, `tenant_name`, `guarantor_name`) is capturable,
  listed, searchable, and **incapable** of becoming business truth: the command returns `invalid`
  and the tenancy row does not move. **From 7.3 those fields are attestable even though they are not
  promotable** — the approval stamp is the verb that reaches them — and from 7.4 a promotion copies
  `approved_value`, which by then is the only value a promotable row can have.
- **R9.** Nothing in `src/policy/`, `src/scope/` or `src/calls/` may mention `extracted_field`.
  Isolation, responsibility and the state machine read typed columns. A contract test scans those
  trees.

### Which declared fields are copies — the ruling, slice 7.4

7.4 was scoped to widen the CHECK *target by target*. It widened it by nothing, and the reason is
worth more than the default it happens to agree with: **promotion is the verb for a value the
document is the source of, and most of the lease's declared fields are not that.**

| Declared field | Copy? | Why |
|---|---|---|
| `lease.start_date` · `lease.end_date` | **Yes** | The lease *is* the source of the letting's term. Mapped since 4.3. |
| `lease_amendment.new_end_date` | **Yes** | Same column, later paper. Later document wins; earlier provenance stays (A3). |
| `lease_amendment.effective_date` | No | No tenancy column to land on. The annex's own date is a fact about the annex. |
| `address` · `apartment_number` | **No — this is the third verb** | Facts about the *unit*, and A11 says only an ADMIN shapes those. Promoting one would not write a new fact, it would assert the document against the flat it was filed under, where disagreement is a defect to surface and a value to argue with — not a value to copy. That is `verify`, and it is named below, not built. |
| `tenant_name` · `guarantor_name` | No | Party provenance is a `PARTY` / `SIGNATORY` link, written by the confirm (A2, 6.5). A name has never had a promotion target and does not acquire one here. |
| `tenant_id_number` · `guarantor_id_number` | No | Already ruled, above: the identifier becomes `party.national_id` when a human confirms a household, **which is an act and not a promotion**. |
| `handover_protocol.handover_date` | Not here | It dates the *flat* (`unit.warranty_end_date`, R14) — a second table, a second module's ADMIN-shaped fact, and a different argument from this one. It gets its own slice or it stays unpromoted. |

**`verify`, the third verb — named and not built.** A cross-check answers *does this document agree
with the record it was filed against*, and its result is a disagreement to show rather than a column
to move. It is what `address` and `apartment_number` want, and it is the same shape as the question
7.1 left open about a lease refusing its own annex. Nothing in the schema anticipates it: there is no
mapping table for it and there should not be one until the flow exists.

### An approval is required before a promotion (slice 7.4, `0029_promotion_requires_approval.sql`)

7.3 left this open and made the cheap half true: a promotion *preferred* `approved_value`. 7.4 makes
it a requirement, because the half that was missing is the one that matters — **an unsigned reading
could still become a typed column, with a person's name on the stamp.** `promoted_by` records who
signed the copy; if nobody had affirmed the reading, what that name signed was a button, not a value.
The columns the copy lands on are read by the isolation join and the obligation state machine, which
SPEC.md says are never decided by a model.

- **Three places say it, and that is deliberate.** The command refuses (`conflict`, *that reading has
  not been approved*); `extracted_field_promotion_needs_approval()` refuses the stamp in the database
  even with the command bypassed; and the ledger draws no `קדם` button on an unsigned row. The
  database is the one that makes it true for every caller this module ever grows — 0018's own
  argument, applied to the rule 0018 could not yet state.
- **A third trigger, not a rewrite of the first two.** 0028 stated the reason when it added the
  second: keeping them apart means each carries its own argument, and a `CREATE OR REPLACE` of 0018's
  function would have restated 4.3's body to add one line to it.
- **The confirm signs what it promotes.** A2's and A3's confirm screens show the dates they are about
  to promote (`תחילת השכירות` / `סיום השכירות` / `מועד סיום מעודכן`), so pressing the button *is* a
  person affirming those readings. The confirm therefore writes the approval stamp for each date row
  it is about to promote, as read, with `confirmed_by` as the approver — and leaves alone any row a
  person already signed on the ledger. **The alternative was an exemption for the confirm path, and
  it was refused:** almost every promotion this system performs goes through that path, so a rule
  that excused it would be a rule about nothing.
- **A row promoted before 7.4 is not re-examined.** The command's idempotent return (already promoted
  to this target) happens before the new refusal, and the trigger only fires on a row that is
  *gaining* the stamp. The rule is about new promotions, which is the only thing a rule can honestly
  be about.
- **The confirm proposes the approved value, too.** `firstValue` read `value` alone, so a date a
  person corrected on the ledger was ignored by the proposal, by the overlap arithmetic that picks
  the letting, and by `upsertTenancy` — which writes `tenancy.start_date` directly, *before* any
  promotion runs. 7.3 closed this door for `promoteExtractedField` and could not see the second one.
  Both now read what a person signed.

## Approval — the stamp that is not a promotion (slice 7.3, `0028_extracted_field_approval.sql`)

A promotion says *this value is now business truth on a typed column*. It reaches two targets and it
moves another module's row. **An approval says something smaller and more useful: a person looked at
what the reader produced and it is correct.** Every captured row can carry one, including the rows
that will never have anywhere to be promoted to — `address`, `apartment_number`, `tenant_name`,
`guarantor_name` — which until this slice were capturable, listed, searchable and unattestable.

- **Three columns on `extracted_field`**: `approved_value` (`-- pii`), `approved_by` (`-- pii`, a
  snapshot of the operator's email and never a staff FK, exactly as `promoted_by`), and
  `approved_at`. A CHECK — `num_nonnulls(...) IN (0, 3)` — says a half-written stamp is not a state
  this table has.
- **`value` is never overwritten, and that is the whole point of the slice.** What the reader
  produced and what a person affirmed are two columns, and the difference between them *is* the
  per-field accuracy dataset. One column would destroy the measurement on the first correction, and
  the correction is the interesting event.
- **`approved_value` is always written**, equal to `value` when the reader was right. A stamped row
  then says what was affirmed without a join, and the delta is `approved_value <> value` rather than
  a null-aware expression nobody will get right at a glance.
- **The database is what refuses a stamp outside the command.** `extracted_field_approval_guard()`
  is a second trigger beside 4.3's, not a rewrite of it: it rejects INSERT or UPDATE of the three
  columns unless `dona.approving` is `on` for the transaction, and rejects DELETE of an approved row
  — `restrict_violation`, the same class 0018 and `document_is_immutable` already use.
- **Re-extract spares an approved row.** 4.2's rule was *replace unstamped rows only* and the stamp
  it meant was the promotion. An approval is a person's attestation and deleting it would erase who
  said so; the DELETE is now `promoted_at IS NULL AND approved_at IS NULL` and the trigger enforces
  what the query intends.
- **A promotion copies the approved value, and from 7.4 there is always one.** 7.3 wrote
  `COALESCE(approved_value, value)` and left the question open; 7.4 closed it by requiring the
  approval, so the copy is `approved_value` and the fallback is gone. See *An approval is required
  before a promotion* above for what enforces it and why the confirm path signs rather than is
  excused.

### Read quality, and what the number actually is

- **`extracted_field.confidence` is not the model's confidence in the field.** It is the **minimum
  OCR word confidence** of the words the reader pointed at — `min()` over `MeasuredWord.confidence`
  in `internal/extract.ts` — and the extraction schema deliberately refuses a model-supplied
  `confidence` (`extract.test.ts` asserts the reply carries no such key). 90% means *Document AI read
  these characters well*; it never means *this is the tenant's name rather than the landlord's*. A
  crisp page misread with total legibility scores 99%. **The screen therefore calls it
  `איכות הקריאה` and never `ביטחון`**, because a word that promises the second thing while measuring
  the first is how a number gets trusted for what it cannot say.
- **`READ_QUALITY_THRESHOLD` is 0.8**, ruled 15 Sep 2026 and roughly where Document AI's own guidance
  puts human review. It is a constant in `internal/approve.ts` and not a `config_settings` row: a row
  with no editor is a row somebody inserts by hand, and 5.8's open half already owns that debt.
  The policy case reads the constant and never a copy of the number.
- **`null` is not "confident".** `src/kernel/pdf.ts` gives every native-text word `confidence: null`
  and the `min()` above turns any null into a null field, so **every field of every
  digitally-produced lease has no confidence at all**. A threshold treating null as passing would let
  one press of `אישור כל מה שלא סומן` approve an entire document on no signal whatsoever. Null is
  flagged, sorts up with the low scores, and the row says *נקרא מטקסט, לא נמדד* rather than showing
  a number it does not have.
- **The primary control is `אישור כל מה שלא סומן`, never approve-all.** Eleven rows on a fourteen-page
  lease, most of them above 90%: approve-all would become a reflex and the measurement would die the
  day it shipped.
- **A second signal is not this slice's.** The honest one — whether the words the model pointed at
  sit under the declared field's label on the page — is geometry extraction already holds while it
  reads. Named, not built.

### Approving an identifier

**Approving is an attestation, so a viewer who may not read the value may not approve it.** 6.4
withholds `tenant_id_number` and `guarantor_id_number` from anybody without
`party.national_id.read`; a stamp from such a viewer would record that a person checked a value they
were never shown, which is a false record in the one dataset this slice exists to produce. The ledger
shows such a viewer a count and no row, and `approveExtractedField` refuses the stamp — in the
command and not only at the route, so the rule holds for every caller this module ever grows.

**An identifier is never in the bulk set, at any stance.** A ת.ז. does not reach the screen until
somebody asks for it by name, so `אישור כל מה שלא סומן` would otherwise sign a value the signer has
not been shown — the same objection as approving a withheld row, at scale and without anyone
noticing. It is flagged for everybody, and it is revealed and signed one at a time. **90% read
quality is not an argument against this**: the number measures how legibly the characters were
scanned, which is exactly the thing that says nothing about whether those digits are the tenant's.

**The reveal is one row and one request.** `POST /documents/:id/fields/reveal`, gated on
`party.national_id.read` — the first route in this system to declare that permission rather than
consult it — writes `evidence.read_identifier` for that row and renders the page with it shown. It
**renders rather than redirects**: a redirect would put the revealed row's id in a URL, in history
and in a referrer, and a refresh would re-log a disclosure that did not happen twice.

## Provenance viewer (slice 4.4)

A promoted value on the unit screen is a link to the page it was read from. Capture stays a row;
the click is an `href`, not a script.

- **No client JavaScript.** The screens have never had any ([SPEC-estate.md](SPEC-estate.md)). The
  link is `/documents/:id/read?page=N`. **#102 deleted the overlay**, so there is no field box and
  no hash to scroll to: the page number is the whole pointer. A query string is sent to the server,
  which is why the page cannot live only in a fragment.
- **The page is the field's, not a box on an image.** Confidence is shown next to the value (a percent
  when Document AI scored the words; omitted when pdfjs stored `null`). Extraction still unions the
  words a field was read from so household pairing keeps document order; that box is stored and is
  never drawn.
- **Estate does not query `extracted_field`.** `listPromotedFieldsForUnit` lives here and is
  injected the same way `listLinkedDocuments` already is, so the estate ↔ evidence cycle stays
  broken. The list is every stamped field on paper linked to that unit (the unit itself, or a
  tenancy of that unit). Unmapped capture does not appear: it never became a value on the unit.
- **Still no names.** The only mappings this week are dates. A name that extraction captured stays
  on the read page and off the unit screen — 5.2 chose not to change that, and 5.4 did not either.

## Later in this module, and not here yet

A lease establishing a draft tenancy is 4.6. The accuracy number is 4.5 and waits on the corpus.
