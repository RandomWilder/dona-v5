# SPEC — Dona Dom tenant service platform (shared conventions)

Living document. Every `SPEC-<module>.md` inherits these conventions and does not repeat them.
Governing documents, in their own hierarchy: [docs/README.md](docs/README.md) — the Data Model is the
authority on what the system is, the Rollout Cadence on schedule. Process: [docs/pipeline.md](docs/pipeline.md).
Decisions: [docs/decisions/](docs/decisions/). Month one's tables: [docs/model/](docs/model/), which is a
specification and not a description.

## Objective

An operations system of record for ~1,500 long-term rental apartments under דירה להשכיר tenders,
with a WhatsApp agent on **both ends** of a service call. Routine calls complete with no human in
them; the office supervises exceptions. North star: share of calls closed with no human involvement.

## Foundation rules

Invariants. Cut features, never these. The first five came from the client and are not designed
around; the rest are what makes them enforceable.

1. **Tenant isolation is absolute.** A tenant receives only information derived from their own
   documents and the global knowledge base — never anything about or for another tenant. Enforced as
   a temporal join in SQL **before any model call**:
   `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`.
   **The scope is a view, never a column.** No `current_tenant` column exists anywhere; a migration
   introducing one fails the build. A model that misbehaves cannot widen a scope it never held.
2. **Money never touches the agent.** No tenant-facing price and no balance — ever, not just v1.
   Financials stay in the Priority ERP behind read-only keys. A question about money is answered by
   refusal and handoff, never by an estimate.
3. **No AI in the responsibility decision or the state machine.** Both are inspectable, versioned and
   defensible in a dispute a year later, and a dispute only ever asks about the past. Every resolved
   call snapshots the `policy_version_id` that decided it; rules supersede by `effective_from` and
   never overwrite. Neither may be tested through the agent — see *Testing*.
4. **Responsibility is ternary** — tenant / operator / **contractor** — because of תקופת הבדק. A
   binary model of it is wrong. With `asset_in_warranty` true the answer is the contractor.
5. **Emergency calls never reach the agent.** An 02:00 burst pipe bypasses triage and reaches the duty
   phone with no model call in between: a policy row plus a routing rule, live before the first real
   message.
6. **A building is a set of Spaces**, one of `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING ·
   STORAGE`. Anything that can break is an **Asset** in exactly one Space; a Unit is the leasable kind
   of Space (`Unit.unit_id = Space.space_id`). **Responsibility falls out of location**, and `UNIT` is
   the only kind that can ever be the tenant's.
7. **A guarantor (ערב) never receives service information.** `is_service_contact` is *forced* false
   when `role = GUARANTOR` — a database constraint, not a form default. No toggle exists.
8. **Capture is open; promotion is governed** ([tasks/plan.md](tasks/plan.md) A8). A document type is a row and a field is a
   row — new ones cost no migration and no deploy, and the value is citable the moment it is
   extracted. An extracted value becoming a *typed column* costs a migration and a reviewed mapping,
   because those columns are what the isolation join, the responsibility matrix and the state machine
   read. Nothing deterministic reads an `ExtractedField` value directly; a contract test asserts it.
   Two instances of the same split are already settled in the workbook and bind the schema:
   **`ObligationType` is an admin-managed catalogue** — deactivated, never deleted, with
   `responsible_party` copied onto the obligation at creation so editing the catalogue cannot rewrite
   history — and **`asset_type` is guarded, not admin-editable**, because the responsibility matrix
   keys on it, so editing it edits policy.
9. **Modular monolith, one deployable.** Modules are bounded contexts exposing commands and events;
   nothing imports another module's internals, only its `contract.ts`. The kernel imports from no
   domain module, and a grep proves it.
10. **The agent is a client, not a brain.** It acts solely through documented module commands, and
    every call is audited. Model, prompt and channel changes never touch business logic.
11. **Specs gate code.** The module spec is updated before the code, in the same change. Contract
    tests, the policy suite and the golden set run in CI and block merges.

## Module map

Follows the workbook's entities, not v3's ([docs/from-v3.md](docs/from-v3.md) Tier 3 says why).

| Module | Entities | Depends on |
|---|---|---|
| `kernel` | — | — |
| `staff` | — | kernel |
| `estate` | E1–E4, E11, E14 — Project · Building · Space · Unit · Asset · Provider (stub) | kernel |
| `parties` | E5, E6 — Party · PartyContact | kernel |
| `tenancy` | E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType | estate, parties |
| `evidence` | E12, E13, E15, E16 — Document · DocumentLink · DocumentType · DocumentTypeField · ExtractedField · FieldPromotion | estate, parties, tenancy |
| `scope` | — the isolation join and nothing else | parties, tenancy, estate |
| `register` | — the register file and nothing else | estate, parties, tenancy, scope |
| `policy` | responsibility matrix · SLA · escalation | estate, tenancy |
| `calls` | ServiceCall · Visit · the state machine | scope, policy |
| `channel` | Conversation · Message · the WhatsApp adapter | scope, calls |

No cycles. `Project` sits above `Building` and is optional (`Building.project_id` nullable).

Two modules own no entity and are not anomalies: `scope` owns the isolation join, and `register`
(slice 2.4) owns the register file format and the order its rows are written in. `register` sits
above `scope` because it calls `normalisePhone`, and an importer inside `tenancy` or `parties` would
have been the cycle `tenancy → scope → tenancy`. **`src/kernel/boundary.test.ts` now proves two
things rather than one**: the kernel imports from no domain module, and no module reaches another
module's `internal/`. `AGENTS.md` claimed a guard for the second since week 1 and there was none;
2.4 is the first slice where a module imports three others' contracts, so the claim became
load-bearing and was made real — the move guard three made at 1.12.

## Code conventions

`AGENTS.md` carries the commands, the directory map and the standing instructions, and is capped at
30 lines ([docs/pipeline.md](docs/pipeline.md) §3). Everything else it would otherwise repeat lives
here:

- **Migrations are append-only.** DDL and backfill in separate files, never one. No migration
  introduces a `current_tenant` column — rule 1, enforced by a grep.
- **PII columns are commented `-- pii`, and a grep enforces it** (guard three, slice 1.12). A column
  whose name is person-shaped — `national_id`, `phone`, `email`, a name, a birth date, a bank
  detail — must carry `-- pii` on its own line or in the comment block directly above it. The one
  escape is `-- not-pii: <why>`, which is a sentence someone has to write and a reviewer can read;
  silence is not an option the guard offers. `space.access_note` is the convention's first use and
  says why it is marked before it has acquired the data rather than after.
- **Time comes from the injected clock.** No `Date.now()` in logic and no `DEFAULT now()` in SQL: a
  timestamp the tests cannot control is a test that fails on a Tuesday.
- **UI is self-contained HTML plus `/ui/tokens.css`, and nothing else.** No bundler, no framework.
  Hebrew is RTL through logical properties (`margin-inline-start`, never `margin-left`), so one
  stylesheet serves both directions. **From slice 5.2c, every signed-in screen carries the same
  ops sidebar** — buildings, expiring, incomplete, search, staff, and sign-out — built once at the
  composition root and injected, because the kernel may not learn a route and a module may not own
  another module's. The current destination is marked on the rail. The login screen has none of
  those links and no sidebar.

## Error shape

One shape everywhere: `{ code, message, details? }`. Codes: `not_found` · `not_allowed` · `conflict`
· `invalid` · `unavailable`. Never return null for an error; never leak internals. The refusal says
`not_allowed` and nothing more — an operator learns what they may do from the board, not by probing.

## Testing

- **`tests/policy/` is the gate for everything no model may decide** — isolation, responsibility, the
  state machine. Required from commit one, before there is an agent. **Every case is proved red
  before it passes**; a case that was green before and after the change it was written for tested
  nothing.
- **A policy case written before its schema is *pending*, never skipped and never `todo`.** The case
  runs the real query; if a relation it needs does not exist yet, it asserts the error is exactly
  Postgres `42P01` on a relation the query *declares* it reads, names that relation in a diagnostic,
  and returns. Any other failure fails the build. The branch disarms itself the moment the last table
  lands, so the case starts asserting for real with no edit and nothing to remember — which a skip and
  a `todo` do not (slice 1.7).
- **`evals/golden/` is the gate for the agent** — trajectory, not final-text matching. `rankAtMost`
  is a ratchet set to what retrieval achieves today, so the gate blocks regression while staying
  green. **No assertion is ever on a distance**: provider embeddings are not bit-identical between
  runs, and a committed distance is a gate that fails for weather. Distances live in `tasks/evidence/`.
- **The golden set's subject and corpus are placeholders, and say so in the file.** There is no agent
  and no ingestion path yet, so `evals/subject.ts` answers from a stub and `evals/corpus.ts` indexes
  nine authored Hebrew passages into a **TEMP** `vector(n)` table — through the real config rows, the
  real embedder and pgvector's own ordering, because a corpus that needed neither a database nor a
  key would make both `REQUIRE_*` switches decorative. What is real from commit one is the *grading*.
  `runCases` takes a `Subject` and a `Retriever`, so the real agent and the real search replace them
  one at a time, and the harness never has to be introduced late (slice 1.8).
- **A skip is a failure wherever a gate runs.** `REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1` are
  set on the jobs that must not pass by grading nothing; locally, absent either, the cases that need
  them skip and say so in the count.
- **Never test a deterministic constraint through the agent.** An eval that fails to reach another
  tenant's data proves the model behaved, not that the join is sound.
- Contract tests per module, through public commands only. Race, timeout and restart tests for
  durable work. Clock and ids injected — no sleeps.

## Security defaults

- Fail-closed verification: no personal data before server-side possession proof.
- Isolation enforced at the query layer, in `src/scope/` and nowhere else, proven by tests that
  attempt to cross it.
- `national_id` (ת.ז. / ח.פ.) is **admin-only, unreachable by any agent tool, and access-logged**. It
  never appears in the response shape of an agent tool; the policy suite asserts this.
- **The staff credential is Google's; the session is ours** (slice 5.1, amended at 5.1b —
  `SPEC-staff.md`, ADR-0005). No password hash and no second-factor secret exist in this schema.
  **What this system asserts is an allowlist and not a factor**: only an email that already has a
  `staff_account` row may sign in at all, and that row is bound to the first Google `sub` that uses
  it. Whatever second factor Google enforces on the account is Google's to enforce and ours to
  inherit rather than to prove. Sessions store
  `token_hash` and never the token — 32 CSPRNG bytes, SHA-256, no pepper, because a pepper defends a
  secret whose preimage space can be searched. **The refusal says `not_allowed` and nothing more**,
  byte-identically for an unknown account, an account with no role and a disabled one, because the
  alternative is an account-enumeration oracle on the login screen. The role matrix is code and not
  a config row — a deliberate exception to rule 8, argued in `SPEC-staff.md`.
- **Every route declares its stance, and the default is deny** (slice 5.2). A route carries
  `config: { staff: <permission> }` or `config: { staff: 'public' }`; one `onRequest` hook in the
  composition root calls `requireStaff`, and an `onRoute` hook **refuses to start the process** if a
  route declares neither. Openness is a written word, never what happened when nobody said
  otherwise.
- **Every write route carries a CSRF token, and the token is derived rather than stored** (slice
  5.2): `sha256('csrf:' + <session token>)`, computed from the `HttpOnly` cookie the request already
  carries, held in no column and defended by the same policy case that forbids a stored token.
  `SameSite=Lax` on the session cookie is now the second of two defences rather than the only one.
  The `GET /staff/auth/*` routes are outside the scope on purpose — they change no row, and `state`
  is the anti-forgery value that flow already carries.
- **A caller is bounded as well as a request** (slice 5.2): fifty filed documents per operator per
  rolling 24 hours, counted from `audit_log` rather than from a new column, refused attempts
  included. 3.3's twenty megabytes bound one upload and nothing bounded a poster.
- **Every scoped read of tenant data is logged**, not only every command.
- PII columns are commented `-- pii`. PII never in logs. Parameterised queries. Validate at the edge.
- Secrets live in Secret Manager and enter through `infra/set-secret.sh` — never in the repo, a log, a
  prompt or an argv (ADR-0003). IAM is bound per secret and per bucket, never at project level.
- **Third parties that see tenant text are named here before they are called**, not discovered later
  (ADR-0004). Personal data reaching a model provider is a decision with a legal basis owed, not a
  side effect. The list, as of slice 1.12, and it is exhaustive by intent rather than by survey:

  | Third party | What it sees | From |
  |---|---|---|
  | **OpenAI** | Passage text sent for embedding, and document text sent for comprehension | Today, through the CI-only `OPENAI_API_KEY` — authored fixture text with no personal data in it. Tenant text from week 4. |
  | **Google Cloud** | Whole page images (Document AI OCR, ADR-0002, processor location **`eu`** — Document AI does not serve `me-west1`); every stored document and row (Cloud Storage, Cloud SQL) as processor | Week 4 for OCR (slice 4.1); today for storage |
  | **Meta — WhatsApp Cloud API** | Every message either end of a conversation sends | Week 9 |
  | **Twilio** | The OTP message and the mobile number it goes to, as the SMS fallback | Week 9 |
  | **Anthropic** | This repository, read by Claude Code as it is built | Today, **development-time only**. It never sees tenant text, and the mechanism that makes that true is that tier 2 never enters the repo — `.gitignore`, the bucket, and this rule, not an assurance. |

  Naming them is the engineering half of ADR-0004. The other half is the owner's, is tracked as **F6**
  on [tasks/fuses.md](tasks/fuses.md), and is owed **before the tier-2 corpus lands**. As of
  2026-09-06 it is three named acts and not an open question: execute OpenAI's DPA, confirm Google
  Cloud's is in force, and publish the notice to data subjects drafted at
  [docs/data-subject-notice.draft.md](docs/data-subject-notice.draft.md). Meta's and Twilio's terms
  arrive with week 9's channel work; **Anthropic needs no instrument**, because this repository never
  holds a tenant document — which is a mechanism with tests behind it, and the day it stops being one
  that row changes before the data moves.

## The corpus, in three tiers

Only one of them is ours, and it is the one no gate runs against.

1. **Specimen documents** — the דירה להשכיר standard lease, פרוטוקול מסירה, ערבות בנקאית, ארנונה and
   insurance forms, plus the operator's own service procedure. They live in
   [docs/corpus/](docs/corpus/) as Hebrew **text authored to the published forms' structure** —
   clause numbering, headings, legal register — and **not** as copies of the published PDFs; each
   file names the form it follows and where that form is published. Two reasons, and the second
   decided it: the gate needs text it can chunk, embed and rank, and the path that turns a PDF into
   text is week 3's; and A7's real worry — no gate green because it was measured against a document
   we wrote to pass it — binds at the **week-4 accuracy number**, which A7 already assigns to tier 2.
   **Committed to the repo; the substrate every gate runs against.** What a tier-1 file may never
   contain is asserted by a test rather than promised in a comment: no sum of money (rule 2), no
   identifier-shaped run, no real person. The published PDFs themselves arrive with the Drive fuse at
   week 3 and do not change what tier 1 is for (slice 1.12).
2. **Real documents from Dona Dom** — they measure accuracy against scans, handwriting and
   signatures, and they do nothing else. They live in a dated bucket of their own with a lifecycle
   rule, a tested deletion path and a removal date recorded on `tasks/fuses.md` the day they land.
   **Never in this repo.**
3. **Synthetic register rows** — the tenant / unit / phone table, designed for coverage of the cases
   that break things. The data request sent to Dona Dom is *derived from* it rather than dictating it.

No slice ever stalls on someone else's inbox, and no gate is ever green because it was measured
against a document we authored to pass it.

## Status

Kernel live at slice 1.4, on 1.3's toolchain: Node 24 type stripping, Biome, `node --test`, Postgres
16 + pgvector on `docker compose`, and a `/health` skeleton that asserts `db:up`. `src/kernel/` is
lifted from v3 and holds ids, clock, errors, validate, config, db, the migration runner, audit,
durable work, object storage, pdf, embeddings, extraction and the RTL token layer (idempotency and
the outbox were lifted too, and removed unused at slice 5.0-cut); `src/app.ts`, `src/serve.ts`, `src/migrate.ts` and `src/seed.ts` are the composition
root above it. `src/kernel/boundary.test.ts` proves the kernel imports from no domain module.

**Migrations live in `src/kernel/migrations/`**, one ordered sequence for the whole system, applied
by `kernel/migrate.ts` under an advisory lock. Seven exist: `0001`–`0003` are the kernel's own —
`vector`, the durability tables, their settings seed — `0004_estate.sql` is the first domain
migration, the E1–E4 spine landed at slice 1.9, `0005_estate_natural_keys.sql` gives that spine the
keys an importer needs to be run twice (1.11), `0006_parties.sql` is E5–E6, the first tables in
this system with a person in them (2.1), `0007_tenancy.sql` is E7–E8 plus the `terms_profile`
its NOT NULL foreign key needs a target for (2.2), `0008_occupancy_view.sql` is R6's current-occupancy
view (2.3), `0009_import_natural_keys.sql` gives `party`, `party_contact` and `terms_profile`
the keys the register importer needs to be run twice (2.4), `0010_scale_indexes.sql` carries the
one index 2.6 measured its way to, `0011_evidence.sql` is the evidence plane — E15, E16, E12 and
E13, the type catalogue before the document that points at it (3.1), `0012_assets.sql` is E14's
three-column Provider stub plus E11 Asset (3.5), so R11 has a table to point at and Q3 and Q7 have
a row to read, and `0013_asset_natural_key.sql` is the unique index `(space_id, asset_type)` that
makes a re-import and a second A6 confirm the same fact stated twice. `0021_staff.sql` is the admin edge's own three
tables — `staff_account`, `staff_session`, `staff_invite` — which are the mechanism by which
somebody is allowed to look at the entities and are themselves none of E1–E16 (5.1). It carries
**the first trigger in this repository**, `document_is_immutable`, because "`file_hash` at ingest, immutable thereafter"
is otherwise a comment and 2.1's principle is that the claim is what the database refuses.
`src/estate/`, `src/scope/`, `src/parties/`, `src/tenancy/`, `src/register/` and `src/evidence/` are
the module directories: estate holds the schema, the importer,
the read model and the five screens 2.6 left behind it, scope the isolation join and its contract, landed early at
1.7 with no tables underneath it, parties and tenancy their schemas plus the write commands the
register calls, register the register file format, its parser and its reject contract (2.4), and
evidence the four document tables, its catalogue commands and the seed that fills them (3.1).
Parties and tenancy gained a `contract.ts` at 2.4 with the caller 2.1 and 2.2 both predicted; parties
still exports no query, and tenancy's first one arrived at 3.3 — `listUnitTenancies`, the lettings of
one flat as dates and a status, no person and no isolation predicate, because who is in a unit today
is `src/scope/`'s answer and nobody else's — and
**evidence's contract carries no query that returns a person either**, which is that rule not bending
for documents.

**The document-type catalogue is data and not a migration**, which is A8's open half made literal:
adding a type with four fields of its own costs a seed row and a re-deploy of data, proved at 3.1 by
adding a tenth through the same function `npm run seed:doctypes` calls and asserting
`information_schema.columns` did not move. Nine types were seeded at 3.1 — the published Data Model's eight
plus `inspection_certificate`, which the workbook has carried since 3 Sep — and slice 3.5 added
`building_handover_protocol` as the tenth, a seed row and not a migration, which is A8's open half
used for real rather than demonstrated in a test. Slice 3.3's verification guard reads its marker terms off the type row rather than out of TypeScript, so a
type added as a row arrives with its own guard. **E12 deliberately omits four columns the published
Data Model's `Document` card carries** — `state`, `superseded_by`, `tenant_visible` and
`uploaded_by` — each for a reason recorded in [SPEC-evidence.md](SPEC-evidence.md) and
`tasks/evidence/3.1.md`; the sharpest is `tenant_visible`, because a per-row boolean deciding what a
tenant may see is a second access control standing beside the isolation join, and foundation rule 1
is that the scope is a view and never a column.
**A document's bytes live under a path that carries the place and never the people** (3.2):
`gs://<bucket>/<place kind>/<place id>/<type key>/<file hash>.<ext>`, built by
`src/evidence/internal/storage-path.ts` because the kernel's object store stores the path it is
handed and never invents one. The rule is enforced by type — `PlaceKind` is `PROJECT · BUILDING ·
SPACE · UNIT`, four of `DocumentLink`'s eight kinds, so a lease cannot be filed under a signatory's
id — and every input is validated rather than sanitised, because a builder that cleans a street name
into a path segment *is* the transliteration collision the convention exists to prevent. **The
application cannot destroy a signed contract, and that holds twice**: `ObjectStore` has no `delete`
and the runtime account has `objectViewer` + `objectCreator` and not `objectAdmin`. A human with
project editor still can, which is 1.5's observation and is now **slice 8.4** — the IAM pass in the
week whose demo is trying to break isolation. 3.2 measured the window that stands between such a
human and a loss: versioning plus an explicit seven-day soft-delete leaves a recoverable noncurrent
version, so the true sentence is *removed with seven days to undo it*, not *destroyed*.
**The seven policy cases stopped reporting pending at 2.2 and now assert**: the last two relations
`src/scope/`'s join reads landed with that migration, and `tests/policy/relations.test.ts` fails the
build if any case takes the pending branch again, because a case that stopped reporting pending and
also stopped running looks identical in a green summary. Every other module spec is a stub until its
build week ([tasks/roadmap.md](tasks/roadmap.md)), and a stub gaining content is the signal its build
started.

**The application serves screens from 1.11 and six estate routes from 3.6**: an index at `/`, the buildings
list, one building, one unit, `/estate/search` and `/estate/expiring` — server-rendered Hebrew RTL off
`/ui/tokens.css`, with no client JavaScript and, **from slice 5.2, behind the session 5.1 built**.
Every route in this application declares its own stance — a permission, or the word `public` — and
an `onRoute` hook refuses to start the process if one declares neither, so the default is deny and
an open route is open because somebody wrote it down. The root index moved from `src/estate/` to the
composition root in the same slice, because an index of screens stopped being one module's fact the
week a second module had one. **Slice 5.2b put one chrome on every signed-in screen**, and **5.2c
gave that chrome v3's ops sidebar** rather than a top bar, still with only the live destinations —
unbuilt tabs stay 5.9. The login screen stays without that rail. `tests/ui/tokens.test.ts` renders every screen and fails on a hex colour, a face, a
physical side or a `<script>`, and from 2.6 also on a phone number or an E.164 prefix: what a screen
may say about a household is **a state and a count, never a tenant's name**, so the
occupancy chip is derived on every load and search never reaches `party`.

**5.2 was the slice entitled to lift that rule, and kept it — which is the decision, not the
absence of one.** A session says who is asking; it does not by itself make a household's name
lawful to show. The two things that would are not yet true: `national_id` is not unreachable until
5.3, and SPEC.md's "every scoped read of tenant data is logged" has no screen-level reader. The
wording was tightened rather than relaxed — *a tenant's* name, because the staff home page has shown
the **operator's own** email since 5.1 and that was never the rule's subject. **Reconsidered at
5.4**, which is already deciding what a session unlocks. Slice 3.6 lets the same
screens show what is filed — type, dates, path as text, verdict — and still not who signed it, and
never a link to the bytes. The fixtures that fill the
screens are ours and designed for coverage — the Shoham plan from 1.11 and, from 2.6, a **generated
register at 1,500 units** loaded through the real importer (`npm run seed:register`), which is where
the week-2 query timings come from. Real data arrives through the same importer at the pilot-
preparation step of the method.

**3.3 added the first write route**: `GET /documents/new` and
`POST /documents`, flow A1, reached from a unit on the building page. The bounds it carries are
stated in [SPEC-evidence.md](SPEC-evidence.md) and applied in
`src/evidence/internal/routes.ts` — one file, 20 MB, four kinds **sniffed from the bytes and never
from the name**, the filename discarded, and nothing personal in the response. Those bound a
*request*; **slice 5.2 added the bound on a *caller***, which is a different quantity — fifty filed
documents per operator per rolling day, counted off the audit log, because nothing else stopped one
poster filling a versioned bucket this application is built to be unable to empty. `@fastify/multipart` is
the one runtime dependency the slice added, because an HTML file input posts `multipart/form-data`
and hand-parsing a boundary-delimited stream of untrusted bytes is the work a maintained plugin
exists to save. The page shell every screen shares moved to `src/kernel/ui/page.ts` in the same
change, so `noindex`, the RTL direction and the token stylesheet are written once rather than per
module. **The type a caller declares is checked against the file before anything is written**:
`verifyDeclaredType` looks for the type row's `verification_terms` in the document's text, all of
them, over text normalised for niqqud, bidi controls and whitespace. A miss is a refusal that leaves
no row and no object and one audit line; a file with no text layer is filed `unverified` rather than
refused, because refusing every scan would refuse most real leases, and OCR closes that gap at 4.1.
`tests/policy/document-verification.test.ts` is the constraint over every corpus specimen against
every seeded type, and it was red before the terms were tuned.

**5.1 gave this system its first session, and `src/staff/` is the admin edge that holds it.** It owns
none of E1–E16: what it answers is who is asking and what they may do, never which rows a person may
see about a tenant, which is `src/scope/`'s and nobody else's. **Google holds the credential and this
schema holds none of it** — no password hash, no second-factor secret. Sign-in is the standard OIDC
authorization-code flow, server-side: one link, one redirect, one code exchange, one verified ID
token, and **not one line of client JavaScript**, which is the UI rule holding on the screens that
guard everything else. `state` and `nonce` ride a short-lived `HttpOnly` cookie and never reach the
database.

**5.1 built this on Identity Platform with a password form, a TOTP form and an invite flow, and 5.1b
deleted all three** (ADR-0005). What was lost is the *assertable* second factor: 5.1 refused any ID
token with no `firebase.sign_in_second_factor`, and no equivalent claim survives delegation. What
replaces it is narrower on the other axis — **only an email that already has a `staff_account` row
may sign in at all**, where the old fence was public sign-up being disabled in someone else's
console. The session is ours rather than the provider's, because an ID token is an hour of authority
this application cannot revoke. **`staff_session` stores `token_hash` and never the token**, and
`tests/policy/staff-session.test.ts` is the standing form of that: no column in this database whose
name contains `token` may be anything but a `_hash`, proved by a case that builds the violating
column itself and was red against a deliberately wrong `0021_` before it was green. **An operator is
a row an admin wrote** — an email and a role, with `idp_local_id` filled by the first sign-in — and
the first one comes from `npm run staff:add`, which is **1.5's argument honoured rather than
reversed**: `bootstrap.sh` creates no seeded operator, and after 5.1b there is no secret in that row
to seed. The urlencoded form parser moved from
`src/estate/` to `src/kernel/ui/forms.ts` in the same change, the move the page shell made at 3.3,
because staff is the second module with a form.

**Two decisions were held for a row count and 2.6 settled both, one in each direction.**
`tenancy (end_date) WHERE status = 'ACTIVE'` was added, because Q5's scan grows with every lease ever
signed while the index grows with the answer. A btree on `party_contact (channel, value)` was **not**
added: it is three times faster than the exclusion constraint's GiST index at plain equality, and
with both present the planner chose GiST every time — an index the planner will not choose is a write
cost with a comment. Both numbers are in `tasks/evidence/2.6.md`; neither is asserted anywhere,
because a timing is weather. `npm run measure:scale` is the instrument, beside `npm run measure`.

**The tier-1 corpus is in [docs/corpus/](docs/corpus/) from 1.12** — six Hebrew specimens, 71
clauses, and the golden set is graded against them rather than against a parallel copy:
`evals/fixtures/specimen-clauses.ts` is a loader over that directory, so a clause renamed there
breaks the import instead of the gate. **Tier 2 has not landed and its controls have**, which is the
order `tasks/plan.md` R4 asks for: `gs://dona-v5-corpus-2026-09-06` with versioning off, a
soft-delete window of zero, a 90-day lifecycle rule and no service account granted anything on it
(`infra/corpus-bucket.sh`), a deletion path that verifies against the soft-deleted listing before it
reports success (`infra/corpus-delete.sh`), and Cloud Audit Logs `DATA_READ`/`DATA_WRITE` on storage.
The application-level audit line over every scoped read **landed at 2.3**, in `src/scope/`, and it
records what was reached and never what was asked: a subject, an action and a row count, because an
Israeli mobile number has too little entropy for a hash of one to be one-way and PII never in logs is
the other half of the same sentence (SPEC-scope.md). **Three grep guards now**, not two: `-- pii` on a person-shaped column joined them at 1.12,
against zero violations, to fire on `0006_parties.sql` at 2.1. It did not fire, because the markers
were written — but it could not have seen the column that most needed one. `party_contact.value`
holds a phone number or an email address, and a bare `value` on the guard's list would fire on
`config_settings.value`; the guard learned **table-qualified names** at 2.1 rather than the list
learning a name it cannot qualify. Guard two fired in the same slice, on `0006_`'s
`validity_is_ordered` CHECK, which was its first firing on work that was not a violation: it could
not tell a null-guarded comparison of `valid_to` against the *other column of the same row* from one
against the *day being asked about*. Resolved by making the pattern say which it means — never by
rephrasing the CHECK to slip past it — and the exception is safe by construction, because a
comparison that is true of every well-formed row cannot express "valid on day D". Guard two fired
again at 2.3, and in the direction that matters most: moving the join onto a view with renamed
columns left the **canonical** join matching neither pattern, so every later copy of it would have
passed. `tests/policy/guards.test.ts` builds its violating fixture out of the real join and went red,
and the view now keeps the base tables' column names because the guard's patterns are written
against them.

**Where the build is: kernel 1.4 · GCP 1.5 · CI and staging 1.6 · the policy suite and the first two
grep guards 1.7 · the evals harness 1.8 · the estate schema 1.9 · the proved release path 1.10 · the
estate importer, the fixture and the first screens 1.11 · the corpus and its controls 1.12 · Party and
PartyContact 2.1 · Tenancy, TenancyParty and the guarantor constraint 2.2 · the isolation join
finished, on a view, with its audit line and E.164 at the edge 2.3 · the register importer, its three
natural keys and its per-row rejects 2.4 · the portfolio-scale surface, the generated register and
the two index decisions 2.6 · the document-type catalogue in the workbook 3.0 · the evidence schema,
its catalogue commands and the nine-type seed 3.1 · the object path convention, the docs bucket's
four controls and the proved delete refusal 3.2 · the declared-type upload, its verification guard
and the first write route 3.3 · Asset, the Provider stub, Q3 and Q7, and flow A6 3.5 · document
search and the documents panels, with the guard verdict stored on the row 3.6 · the staff session,
Google-held credential and the role matrix in code 5.1 · **every route behind that session, every
write route behind a derived CSRF token, and a per-caller upload cap 5.2.**
Production exists and has been released to — `v0.1.0`–`v0.1.2`, rolled back and rolled forward on
purpose — and is then **parked until week 12**: the Cloud SQL instance is stopped and the service
scaled to zero, so `dona-prod` answers 503 by design and staging is the delivered artifact every
week. The project is still org-less (fuse F7). Both gates are wired
from week 1 and both are required contexts on `main`: `tests/policy/` runs inside the `gate` job with
the guards, and `evals/` runs in an `evals` job of its own — a job rather than a step because it is
the only thing in this repository that calls a paid third party. This paragraph is the single status
line; `AGENTS.md` points here rather than repeating it.
