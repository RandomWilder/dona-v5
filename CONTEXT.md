# CONTEXT — the glossary

The words this project uses, and the one meaning each of them has. Use these terms verbatim in issue
titles, test names, commit subjects and prose; don't drift to synonyms.

**This file names the nouns. It does not define behaviour.** `SPEC.md` and `SPEC-<module>.md` do, and
they win wherever the two could be read as disagreeing. Decisions are in `docs/decisions/`.

## The system

**Dona Dom** — the operator. ~1,500 long-term rental apartments under **דירה להשכיר** tenders.
**The agent** — the WhatsApp-facing model, on both ends of a service call. It is a client, not a
brain: it acts only through documented module commands. **The office** — the humans who supervise
exceptions.

## Place

| Term | Means |
|---|---|
| **Project** | Optional grouping above Building. `Building.project_id` is nullable. |
| **Building** | A set of **Spaces**. Nothing else. |
| **Space** | One of `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING · STORAGE`. |
| **Unit** | The leasable kind of Space. `Unit.unit_id = Space.space_id` — not a separate thing. |
| **Asset** | Anything that can break. Sits in exactly one Space. |

**Responsibility falls out of location.** `UNIT` is the only Space kind that can ever be the tenant's.

## People

| Term | Means |
|---|---|
| **Party** | A person or company. Never "user", never "customer". |
| **PartyContact** | A phone or email, valid over a date range. The join starts here. |
| **Tenancy** | A contract over a Unit, active over a date range. |
| **TenancyParty** | A Party's role in a Tenancy. |
| **Guarantor** (**ערב**) | A role. Never receives service information — `is_service_contact` is forced false by a database constraint, not a form default. |

## Scope

**The isolation join** — `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active
today) → Unit`. Written in **one file**, `src/scope/`, and nowhere else; a grep guard proves it.

**The scope is a view, never a column.** No `current_tenant` column exists anywhere and a migration
introducing one fails the build. Say "the scope", not "the tenant's permissions".

## Paper

| Term | Means |
|---|---|
| **Document** | A file that arrived. |
| **DocumentType** | A row, not a code path. New types cost no migration. |
| **DocumentTypeField** | A field declared on a type. Also a row. |
| **Passage** | One page of a Document, as text. Written once, when the document is read — at filing, or by the archive sweep for rows that have none. Never re-derived from the bytes after that. Identifiers stay in the text. Masking is a read, not a write. |
| **Stance** | Who is asking a retrieval question. Required on every search; there is no default. The administrator stance returns identifiers as printed. The tenant stance masks them in the returned text and leaves the stored passage unchanged. Distinct from a route's declared permission. |
| **Retrieval bound** | Which Documents' Passages a search may consider — a Unit, a Building, or the whole portfolio. Required on every office search; the current estate screen picks the bound. Distinct from the isolation join and from Stance. |
| **Office retrieval thread** | A persisted question-and-answer history for one staff account on one retrieval bound. Not a Conversation. |
| **ExtractedField** | A value read out of a Document, citable the moment it is extracted. |
| **Capture** | Getting a value into an `ExtractedField`. **Open** — cheap, ungoverned. |
| **Approval** | A person signing a reading. A stamp on the `ExtractedField`. |
| **Promotion** | Copying an approved value onto a **typed column**. **Governed** — costs a migration and a reviewed mapping, and only happens after approval. |
| **FieldPromotion** | The record that a promotion happened. |

**Capture is open; promotion is governed.** Nothing deterministic ever reads an `ExtractedField`
value directly — typed columns are what the isolation join, the responsibility matrix and the state
machine read. A contract test asserts it.

**Verification terms** are the phrases a document must contain to be accepted as its declared type.
One requirement per line, `|` separating the spellings of **one** requirement; every requirement must
be met. Editable at `/settings` without a deploy.

## Work

| Term | Means |
|---|---|
| **ServiceCall** | A request from a tenant. Has a state machine, with no AI in it. |
| **Visit** | A contractor or operator attending. |
| **Responsibility** | **Ternary**: tenant / operator / **contractor**. Never binary. |
| **תקופת הבדק** | The warranty period. With `asset_in_warranty` true, the answer is the contractor. |
| **ObligationType** | An admin-managed catalogue. Deactivated, never deleted; `responsible_party` is copied onto the obligation at creation so editing the catalogue cannot rewrite history. |
| **asset_type** | Guarded, **not** admin-editable — the responsibility matrix keys on it, so editing it edits policy. |
| **policy_version_id** | Snapshotted onto every resolved call. Rules supersede by `effective_from` and never overwrite. |

**The register** — the register file format and the order its rows are written in. Owned by
`src/register/` and nothing else.

**Amount** — a number printed on a document, held as a `NUMBER` field beside a `TEXT` currency field
that is its own. Ordinary data since 15 Sep 2026, when foundation rule 2 was retired
([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)): an amount is read, captured,
approved, promoted, retrieved, quoted and computed on like every other value on a contract. There is
no `MONEY` value type and an amount is never a **balance**.

**Balance** — a running figure for what somebody owes. **Priority's, not this platform's.** Nothing
here writes one, no schema has a column for it, and that is a fact about what is built rather than a
guard that forbids it.

## Shape

**Modular monolith, one deployable.** `src/<module>/`: estate · parties · tenancy · evidence · scope ·
register · policy · calls · channel · staff, over a shared `src/kernel/`. A module imports another's
`contract.ts`, never its `internal/`. The kernel imports from no domain module. Both are proved by
`src/kernel/boundary.test.ts` and a grep guard.

**The two gates** — `test:policy` (everything no model may decide) and `evals` (the agent). Both are
test suites; both block merges.
