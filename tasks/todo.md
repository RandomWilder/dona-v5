# Week 3 · Sun 20 – Thu 24 Sep 2026 — Documents filed against units

> **Started 7 Sep 2026**, the day week 2 closed, rather than on the planned 20 Sep. The dates in
> [roadmap.md](roadmap.md) are never rewritten; the gap between them and the evidence files is the
> measurement of how the project ran. After two weeks the project is running roughly ten calendar
> days ahead of its plan.
>
> **Demo kind, declared Sunday 7 Sep: SOFTWARE.** Nothing in this week depends on an unlit fuse.
> Week 3 was written against F4 (Google Drive access) and **was amended on 6 Sep so that it is not**:
> intake is an administrator declaring a type and uploading a file ([SPEC-flows.md](../SPEC-flows.md)
> flow A1), not a crawl of someone else's Drive. The demo is given on **tier-1 specimens** — Hebrew
> text authored to the published forms' structure, committed at 1.12, ours and invented.
>
> **Week demo (Thu):** upload a lease against a unit and a tenancy, then find it again in four
> seconds — hashed, dated, immutable, attached. Nothing is read yet: this is a filing cabinet with a
> search box, and it is already a business win over the status quo.
> **Freeze:** Wednesday. The last merge that reaches staging lands Wednesday.
>
> One slice = one focused session, half a day or less. **Done when** is the acceptance bar; **Verify**
> is the check that proves it — no self-certification. The standing bar every slice also clears is
> the Definition of Done in [plan.md](plan.md).

**Six slices, and the shape of the week is a chain with one fan.** 3.0 → 3.1, and then 3.2, 3.3 and
3.5 all hang off 3.1, with 3.6 last. 3.4 is **deferred, not deleted** — see below. The fan is real
slack: if the week runs short, the cut line at the bottom is where it comes out of, and 3.5 is the
one with an owed item on it that nothing else can discharge.

**The week's structural risk is 3.0, and it is first for that reason.** A migration written ahead of
the workbook is the anti-pattern this project has already named once.

---

## Carried in from week 2 — every item, with the slice that closes it

- [ ] **The register-derived handover dates are placeholders, and they are on screen.** Every
      building card on `/estate` shows a מסירה date that is one of its leases' start dates, because
      the last row of a building wins the upsert and the register format carries no handover date.
      תקופת הבדק starts at handover, not at a letting, so `warranty_end_date` is currently a guess and
      responsibility is ternary on a guess. **Owned by 3.5**, which brings the real fact off the
      handover protocol — and says in its evidence **how many buildings had one**.
- [x] **The demo-day discrepancy — discharged at 3.0, and the carry was describing something that had
      already been fixed.** 3.0 edits `docs/model/`, so it inherited this. The claim was that
      [pipeline.md](../docs/pipeline.md) §7 says the demo kind is declared **Monday**. It does not,
      and §7 never has — §7 is the golden set. The line was in **§8**, and **2.1 corrected it on
      2026-09-06**: it now reads that the Cadence's "Monday" means the first working day of the week,
      that the working week here is Sun–Thu, and that the day is therefore Sunday. Week 1's evidence
      raised it, 2.1 closed it, and weeks 1 and 2 both re-carried it afterwards from a note rather
      than from the file — which is the carry rule's own failure mode: an item can outlive its fix if
      nobody re-reads the thing it points at. **Nothing owed in this repository.**
      What is still literally true is that two **published** documents say the kind is declared on
      Monday — `rollout-cadence.html` ("Declare the demo type on Monday") and `platform-brief.html`.
      2.1's ruling covers them: the Cadence is the authority on the schedule and is never renegotiated
      here, so "Monday" reads as its first working day and the correction is a reading recorded rather
      than a schedule changed — no republish. **Changing the client-facing wording is the director's
      call**, not a slice's, and it is not owed by anything.
- [ ] **The UI comments from week 2's demo.** Stakeholders were positive on progress and their
      comments were about the interface. Nothing raised was a correctness, isolation or data question
      and nothing blocks this week. **Parked deliberately and owned by the M1 checkpoint**, where the
      decision is whether a design pass earns a slice of its own — month two's obligations strip and
      compliance tab are the first work with a genuine design surface. Not silently absorbed into
      week 3's screens.
- [~] **2.5 — import the real register.** Moved to the pilot-preparation step of the method with F3.
      Not cut, and it still owns two facts only a real file can produce: the reject count, and
      whether Priority's export carries vacant apartments as rows at all.
- [~] **3.4 and A10 — Drive ingestion and the bulk review queue.** Deferred 6 Sep with F4, to the same
      step. Two consequences that must not be lost with it: **3.6 is re-pointed to 3.3**, and
      **the published forms themselves** — the actual דירה להשכיר lease, פרוטוקול מסירה, ערבות בנקאית,
      ארנונה and אישור קיום ביטוחים — are still owed, now at the step where F4 is lit. They sit
      *beside* the authored tier-1 text and never replace it: the authored clauses are what the
      ranking ratchet is set against, and swapping the substrate under a ratchet re-baselines it
      silently.

## Also this week

- [ ] **Walk [fuses.md](fuses.md).** F2, F4, F5 and F7 are unlit; F6 is lit and half discharged; F3
      is off month one's critical path. Everything unlit goes on Thursday's asks slide. That file is
      the register and this one does not duplicate it.
- [ ] **F6's other half — three named acts**, blocking the tier-2 corpus and nothing in week 3:
      execute OpenAI's DPA, confirm Google Cloud's is in force, publish the notice to data subjects
      ([../docs/data-subject-notice.draft.md](../docs/data-subject-notice.draft.md)).
- [ ] **Answer one question out of the notice draft: how it reaches a tenant.** "On first contact
      through the agent channel" means week 9 builds a step for it, so the answer is owed before
      week 9 rather than during it (notice draft, item 4).
- [ ] **Director's call, raised at 3.1 and owned by no slice: the published Data Model's `Document`
      card is now out of step with the schema.** It lists `state`, `superseded_by`, `tenant_visible`
      and `uploaded_by`, and the entity it calls `DocumentSchema` is `DocumentType` (E15). Every one
      of those differences is a decision made with a reason and recorded
      ([evidence/3.1.md](evidence/3.1.md), [SPEC-evidence.md](../SPEC-evidence.md)); the repository is
      not out of step with itself. What is open is whether the **published** artifact gets
      republished, and that is a promise to the client and therefore not a slice's to make — the same
      treatment 3.0 gave the "Monday" wording. Flagged, not owned, and it changes nothing that ships.

- [ ] **Take delivery of the real document corpus.** The controls have existed since 2026-09-06 and
      the data does not, which is the order **R4** asks for. Owed after F6's other half. Record the
      arrival and removal dates on [fuses.md](fuses.md) the day it lands.

**Carried in and already owned elsewhere, named here so nothing is unowned:** `environment:
production` has no protection rules — a `v*` tag is the only thing between a commit and prod, correct
while prod is stopped and wrong from week 12, where [roadmap.md](roadmap.md) owns it. And the
`party_contact (channel, value)` btree, rejected at 2.6 because the planner never chose it over the
exclusion constraint's GiST index, is reopened at week 12 at a different row count. And **raised at
3.2**: the docs buckets' legacy `projectEditor` / `projectOwner` bindings carry `legacyObjectOwner`,
which includes delete — 3.2 proved the *application* cannot destroy a signed contract, and a human
with project editor still can. [roadmap.md](roadmap.md) owns it at **week 8**, in the same IAM pass
as 1.5's `run.admin` scoping and in the week whose demo is *try to break isolation*.

---

## Slices

- [x] **3.0 — Workbook pass: the document-schema catalogue.** **Spec before code**, and it is first in
      the week for that reason. The workbook is the specification for month one's tables and it
      currently has `Document` at eight fields with no catalogue behind it. Add **E15 `DocumentType`**
      and **E16 `DocumentTypeField`** with **R17** and **R18** — **appended, never inserted**, because
      R1–R16 are cited in the frozen Hebrew file and renumbering them would silently invalidate every
      citation in this repository. Edit `build_model.py` and re-run it; the `.xlsx` is a build output,
      not a source. The Hebrew workbook stays frozen unless asked.
      **Done when:** the FIELDS sheet specifies every column of both new entities, and the DECISIONS
      sheet carries **A8** as the rule it creates and why that rule holds.
      **Verify:** re-run the generator; assert R1–R16 are unchanged; open the workbook.
      **Closed 2026-09-07** ([evidence](evidence/3.0.md)). E15 · E16 · R17 · R18 · A8, appended, with
      R1–R16, E1–E14 and D1–D6 proved identical **cell for cell against the committed `.xlsx`**
      rather than against a re-run of my own — the committed workbook regenerates exactly from
      `build_model.py`, so the diff is against the artifact. Exactly three FIELDS rows changed, all on
      E12: `type_key` → `document_type_id` (R17) and `sha256` → **`file_hash`**. Two calls the
      catalogue forced — `DocumentType.verification_terms`, so 3.3's guard reads the type row instead
      of a map in code, and **no `promotes_to` column anywhere**, because promotion as a row gives
      away A8's governed half. A8 keeps its own number rather than becoming a D7. Raised and owned:
      the seed is nine and not eight (3.1) · E12 versus the published Data Model (3.1) · one column
      and not two on `ExtractedField` (4.2). · **M**

- [x] **3.1 — Document, DocumentLink, and the type catalogue.** E12, E13, E15, E16. One document,
      several bindings, because a signed lease is evidence about the tenancy *and* the unit *and*
      both signatories — six nullable foreign keys works until the seventh entity needs documents.
      `file_hash` at ingest; immutable thereafter. `DocumentType` seeded with the eight from the Data
      Model and **deactivated, never deleted**; `DocumentTypeField` versioned by `effective_from`.
      **Done when:** adding a ninth document type with four fields of its own is a seed row and a
      re-deploy of data — **no migration**.
      **Verify:** add one in a test, extract nothing, confirm no DDL was needed; contract tests on
      R13, R17 and R18; the same file ingested twice is one document with two links.
      **Owed by 3.0 — the seed is nine types and the bar above is therefore the tenth.** The Data
      Model names eight; the workbook has carried `inspection_certificate` as a ninth since 3 Sep
      because SAFETY assets and the compliance tab need it, and **3.5 needs it this week**. Keeping a
      type the system already requires out of the seed so that a demonstration lands on the number
      nine is a knowingly incomplete seed. Seed nine, prove the mechanism on a tenth, say so.
      **Owed by 3.0 — two column names are settled and are not to be re-decided.** There is no
      `type_key` on `Document`: it is `document_type_id` (R17). The hash column is **`file_hash`**,
      not `sha256`, matching [SPEC-flows.md](../SPEC-flows.md) A1.
      **Owed by 3.0 — E12 is narrower than the published Data Model, and this slice decides whether
      that stands.** `docs/data-model.html`'s `Document` carries `state`, `superseded_by`,
      `tenant_visible` and `uploaded_by`; E12 carries none of them. A column is either in the first
      DDL or it costs a migration later. With 3.4 deferred and type declared rather than detected,
      the review-queue states collapse to nearly nothing — but supersession is real the moment an
      addendum lands (flow A3, week 4) and `tenant_visible` is real the moment a tenant can see a
      document (week 9). Decide each in the evidence, with a reason.
      **Owed by week 2 — the guard-three habit holds.** A document row is not person-shaped, but
      `DocumentTypeField` will describe fields that are (a tenant's name on a lease), and
      `scripts/guards.ts` fires on the column, not the intent. Expect to write `-- pii` or the
      one-sentence `-- not-pii:` escape, and say which in the evidence.
      **Owed by 2.6 — the isolation rule does not bend for documents.** Nothing here reaches a person
      except through `src/scope/`; a document panel shows what is filed, not who signed it, until
      week 5 puts a session behind the screens. **Deps:** 3.0, 2.2 · **M**
      **Closed 2026-09-07** ([evidence](evidence/3.1.md)). `0011_evidence.sql` — E15, E16, E12, E13,
      every column the FIELDS sheet specifies and no others — plus `src/evidence/` and a **nine**-type
      seed that is **data and not a migration**, because nine types in a backfill would have made the
      tenth a migration and the acceptance bar false the day it was written. The bar is proved on the
      **tenth**: a ועד בית agreement with four fields, added through the same function
      `npm run seed:doctypes` calls, with `information_schema.columns` snapshotted either side and
      asserted identical. 19 new tests, **325 code + 41 hooks green**, and **nine constraints proved
      red first** with their SQLSTATEs in the evidence. **E12's four missing columns are decided, not
      deferred: all four omitted**, each with a reason and each carried — `state` → 3.3,
      `superseded_by` and `uploaded_by` → week 5, `tenant_visible` → week 9. Two calls beyond the
      bar: **the first trigger in this repository** (`document_is_immutable`, because "immutable
      thereafter" is otherwise a comment), and `UNIQUE (file_hash)` carrying "the same file twice is
      one document with two links" in the database rather than in the caller. Guard three fired zero
      times and **three `-- not-pii:` sentences were written anyway**, on the catalogue columns that
      name personal data without holding it.

- [x] **3.2 — Object storage and the path convention.** The docs bucket with uniform access,
      public-access prevention and versioning, **re-applied on every bootstrap run** so the control is
      a script and not a memory. The runtime account gets `objectViewer` + `objectCreator` and
      deliberately **not** `objectAdmin`, so the application cannot destroy a signed contract. Object
      paths carry **the place and never the people**, keyed by id rather than a transliterated
      address — two streets that transliterate alike would file one flat's lease under another's, a
      correctness failure with isolation flavour that arrives quietly.
      **Done when:** the app can write and read a contract and cannot delete one.
      **Verify:** attempt the delete as the runtime account and get denied, with the error recorded.
      **Deps:** 3.1, 1.5, 1.12 · **S**
      **Closed 2026-09-07** ([evidence](evidence/3.2.md)). The path is
      `gs://<bucket>/<place kind>/<place id>/<type key>/<file hash>.<ext>`, and *the place and never
      the people* is **enforced by type**: `PlaceKind` is four of `DocumentLink`'s eight kinds, so a
      lease cannot be filed under a signatory's id, and the rule holds on the way back out too
      because a hand-edited `storage_uri` is the case that matters. Every input validated, none
      sanitised. The leaf is the `file_hash`, which makes the object write idempotent on the column
      `ingestDocument` already is. A read **refuses a bucket that is not the configured one**.
      **The delete refusal holds twice**: `ObjectStore` has no `delete`, and `src/docs-probe.ts`
      goes around the missing method with a raw `DELETE` as `app-staging` and records the 403, with
      the write and the read as its positive control. 20 new tests, **345 code + 41 hooks green**;
      the policy case was **red first**. Three things found while reading and fixed: `DOCS_BUCKET`
      was injected by the deploy and read by no code, so "reported at boot" was a claim — `serve.ts`
      now prints it; `objects.ts` cited a v3 filename; and the bucket's **soft-delete window was a
      vendor default nobody had chosen**, now 7 days explicitly, which is the opposite call from the
      corpus bucket's cleared window and for the opposite reason. **A fourth, in the same file:**
      `bootstrap.sh prod` had stopped working entirely — a STOPPED Cloud SQL instance answers
      *Invalid request since instance is not running* to both `databases describe` and `databases
      create`, so the pair failed and `set -e` killed the run before the service accounts, the bucket
      and the WIF binding, none of which need the instance. That is 1.5's cost lever biting 1.5's
      script: stopping `dona-prod` until week 12 quietly made *idempotent, safe to re-run* false for
      prod. The state is now checked rather than inferred from an error, and a stopped instance skips
      the database step **loudly**. Both buckets carry the four controls now, prod included. Raised
      and owned: the ingest
      ordering rule (3.3) · signed URLs are not 3.6's (3.6) · the bucket's legacy `projectEditor`
      delete (week 8).

- [ ] **3.3 — Declared-type upload, with a verification guard.** This slice implements **flow A1**.
      The flow already knows what it asked for ("upload the lease for unit 14"), so **type is
      declared, not detected**, and classification — the riskiest ingestion step — simply does not
      exist. What remains is the cheap guard for the real error: right slot, wrong file. The upload
      binds to a **tenancy**: an existing one, or a new draft. A draft is never an empty shell — it
      needs unit, dates and at least one tenant, all three of which come out of the lease — so here
      the draft path is **declared by the administrator**, and week 4's extraction takes it over.
      **Done when:** uploading an ארנונה bill into the lease slot is caught before it is filed.
      **Verify:** the wrong-file case, both directions, against tier-1 specimens.
      **Not in this slice:** the content cross-check — does the address on the document match the unit
      it was filed against — needs extraction and is **week 4's**. Say so in the evidence rather than
      letting it look like an oversight.
      **Owed by 3.0 — the guard reads the catalogue, never a map in TypeScript.**
      `DocumentType.verification_terms` was added at 3.0 for this guard alone: the marker terms a
      document of a given type is expected to contain live on the type row, so a type added as a seed
      row arrives with its own guard. A `Record<TypeKey, string[]>` in code means every new type ships
      unguarded until the next release — A8 true of the catalogue and false of the first thing that
      consumes it. **Landed at 3.1**: `document_type.verification_terms` is a column, nullable,
      seeded on all nine types, and `listDocumentTypes` on `src/evidence/contract.ts` is what reads
      it. Nothing is owed here; the input exists.
      **Owed by 3.1 — does a wrong file caught at the door leave a row behind it?** 3.1 decided E12
      carries **no `state` column**: figure 5's `RECEIVED → EXTRACTED → ACCEPTED / REJECTED` is the
      review queue's state machine and the queue is 3.4, deferred with F4. But the published Data
      Model's figure 4 says **"REJECTED is a state, not a deletion — the wrong file is evidence too,
      of what someone tried to file and when"**, while this slice's own bar says the ארנונה bill is
      *caught before it is filed*. Those two disagree, and this is the slice that meets the
      disagreement. Decide it here, with a reason: either a caught upload is refused and unrecorded —
      and figure 4's caption is a statement about the bulk queue that does not bind the interactive
      path — or it is filed as evidence of an attempt, which costs `state` and therefore a migration,
      and is worth taking deliberately rather than by drift.
      **Owed by 3.2 — the ingest order, and it is not the obvious one.** Hash the bytes → look the
      hash up → `put` the object **only when no document already holds it** → `ingestDocument`.
      Hashing first is what makes the path computable before anything is written, and looking up
      before putting is what stops the same bytes filed against a second place writing a second copy
      of one file. `ingestDocument` excludes `storage_uri` from its update path, so the first path
      filed stays authoritative whatever a later caller computes. The path is built by
      `documentObjectPath` from `src/evidence/contract.ts` and **never by string concatenation**, and
      the file types the screen accepts are `documentExtensions` from the same module rather than a
      second list in the upload handler. **Deps:** 3.1, 3.2 · **M**

- [~] **3.4 — Drive ingestion and the bulk review queue. DEFERRED 6 Sep 2026, not deleted.** See the
      carried-in section above. Nothing about the design is withdrawn: convention **proposes** a type
      and a binding, the guard checks the file matches the slot, and a **confidence-ranked review
      queue** puts a human between the proposal and the filing. Bulk becomes meaningful at step 4,
      when volume arrives.

- [ ] **3.5 — Assets, seeded from handover protocols.** E11 — 14 columns, the widest entity in the
      workbook. `Asset.space_id` as a single non-null FK, `warranty_end_date` and
      `warranty_provider_id` for תקופת הבדק, `source_document_id` so each asset remembers the page it
      came from, `compliance_regime` for the inspection tab. **`asset_type` is guarded, not
      admin-editable** — the responsibility matrix keys on it, so editing it edits policy.
      **Done when:** Q3 (what is overdue for inspection in this building) and Q7 (which bay is
      assigned to unit 12, and who serviced its gate motor) are each **one query**.
      **Verify:** both queries against the fixture; R3, R11, R12 and R14 as contract tests.
      **Owed by 2.4 and made visible by 2.6 — the placeholder handover dates.** Correct them here from
      the handover protocol, and **record in the evidence how many buildings had a placeholder**. The
      same applies to `PARKING` and `STORAGE` spaces: a register row implies exactly one `UNIT` space,
      and bays and storage rooms (workbook D3) arrive with this document. **Both dependencies from
      3.1 exist**: `document` is a table `Asset.source_document_id` can point at, and
      `handover_protocol` is one of the nine seeded types, declaring `handover_date` and
      `apartment_number` — `handover_date` being the field that turns the placeholder מסירה dates
      into a fact. **Deps:** 3.1, 1.9 · **M**

- [ ] **3.6 — Find it in four seconds.** Document search and the documents panels on the building and
      unit screens, grouped by type.
      **Done when:** a named lease is on screen within four seconds of deciding to look for it.
      **Verify:** timed, by the owner, **on staging** — not locally, and not by me.
      **Owed by 2.6 — search already exists and this extends it rather than forking it.**
      `searchEstate` escapes LIKE metacharacters at the edge and carries a `LIMIT`; a second search
      that forgets either is the defect 2.6 wrote a test for. Every new screen goes into the `SCREENS`
      registry in `tests/ui/tokens.test.ts` in the same change — that registry is what catches a
      physical CSS property or a name on a screen that must not carry one.
      **Owed by 3.2 — the panel shows a path, never a link to the bytes.** `document.storage_uri` is
      a `gs://` uri and nothing in this system mints a signed URL. A signed URL is a bearer token for
      one object: whoever holds the string reads the document, isolation join or not, so issuing one
      is a decision that belongs behind a session, and sessions are week 5's. Until then the panel
      renders what is filed — type, dates, ingest date — which is the shape the tokens test already
      enforces.
      **Deps:** ~~3.4~~ **3.3**, re-pointed 6 Sep 2026 · **S**

---

**Cut line, in order:** the compliance tab's visual treatment (the *query* is what matters this
week) · the documents panel's grouping in 3.6 (a flat list still finds the lease in four seconds).
**Do not cut 3.0**, and do not cut 3.5's handover-date correction — it is the only thing that
discharges a carried item, and a carry that survives two weeks stops being a carry and becomes a
thing nobody owns.
