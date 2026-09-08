# Week 4 · Sun 27 Sep – Thu 1 Oct 2026 — The machine reads a lease, and shows its work → **M1**

> **Started 7 Sep 2026**, the day week 3 closed, rather than on the planned 27 Sep. The dates in
> [roadmap.md](roadmap.md) are never rewritten; the gap between them and the evidence files is the
> measurement of how the project ran. After three weeks the project is running roughly three
> calendar weeks ahead of its plan.
>
> **Demo kind, declared Sunday 7 Sep: SOFTWARE, with an Evidence number attached.** Nothing in 4.1–
> 4.4 or 4.6–4.8 depends on an unlit fuse. **4.5 does** — it needs the tier-2 corpus, which waits on
> F6's three acts. Week 4 runs on tier-1 specimens until that lands.
>
> **Week demo (Thu):** drop in a Hebrew lease. Rent, dates, parties and clauses appear as fields.
> Click any value and the page image scrolls to the pixels it came from, with a confidence score.
> **Freeze:** Wednesday. The last merge that reaches staging lands Wednesday.
>
> **Plan mode is mandatory** for 4.1 (kernel reader + evidence), 4.3 (promotion across evidence and
> tenancy), and 4.6 (estate, parties, tenancy, evidence). A new session starts at 4.1, in plan mode,
> after reading [SPEC-evidence.md](../SPEC-evidence.md) and [SPEC-flows.md](../SPEC-flows.md) A2–A4.
>
> One slice = one focused session, half a day or less. **Done when** is the acceptance bar; **Verify**
> is the check that proves it — no self-certification. The standing bar every slice also clears is
> the Definition of Done in [plan.md](plan.md).

**The chain is 4.1 → 4.2 → 4.3, then a fan: 4.4 and 4.6 hang off 4.3.** 4.7 hangs off 4.6, 4.8 off
4.7. 4.5 is last and is the one that may not start.

A2, A3 and A4 were named on 6 Sep and **sized at week 3's close on 7 Sep** as 4.6, 4.7 and 4.8.

---

## Carried in from week 3 — every item, with the slice that closes it

- [x] **`unverified` is a backlog with no reader.** Discharged at 4.1: sweep already-filed documents
      and record how many verdicts moved. Count is on `evidence.file_document` audit lines whose
      `inputs.verdict` is `unverified`. Local: examined 1, verified 1. Staging sweep waits on the
      revision that carries the reader — owned at 4.3.
- [x] **A real signed-lease PDF on staging became `unavailable` / unexpected error after ~1 minute.**
      Discharged at 4.1: the reader must bound itself. A file it cannot finish is `invalid` or
      `unverified`, never an uncaught 503, and must not hold the request for a minute to get there.
      The demo used a printed specimen; that was the right call, not a workaround to keep.
      pdfjs **8s**; OCR **20s**. HTTP of a miss is 200 unverified.
- [x] **E16 versioning is one column, not two.** Discharged at 4.2: `ExtractedField` points at
      `document_type_field_id`. No separate schema-version entity.
- [ ] **`upsertUnitRow` still writes only a `UNIT` space.** Discharged at 4.6: register-imported
      buildings still have no `PARKING` or `STORAGE` rows. The Shoham fixture already has 60 bays and
      40 rooms; a protocol cannot fill a bay that does not exist.
- [ ] **A2 — a lease establishes a draft tenancy**, including 3.3's content cross-check and the
      draft path upload could not take. **4.6.**
- [ ] **A3 — an addendum completes a tenancy.** Same path as A2. **4.7.**
- [ ] **A4 — incomplete-tenancy queue** (at least one guarantor; policy case, never NOT NULL). **4.8.**
- [ ] **The UI comments from weeks 2 and 3.** Parked at **M1**. Nothing raised was a correctness,
      isolation or data question.
- [~] **2.5 — import the real register.** Pilot-preparation with F3.
- [~] **3.4 and A10 — Drive ingestion and the bulk review queue.** Deferred with F4. Published forms
      sit beside tier-1 text at that step.

## Also this week

- [ ] **Walk [fuses.md](fuses.md).** Walked at week 3 close, 7 Sep. Walk again before the Thursday
      demo. F2, F4, F5, F7 unlit; F3 off month one; F6 three acts still owed; F1 burning (18 Sep –
      2 Oct).
- [ ] **F6's other half — three named acts**, blocking **4.5** and nothing else this week: execute
      OpenAI's DPA, confirm Google Cloud's is in force, publish the notice to data subjects
      ([../docs/data-subject-notice.draft.md](../docs/data-subject-notice.draft.md)).
- [ ] **Answer one question out of the notice draft: how it reaches a tenant.** Owed before week 9.
- [ ] **Director's call:** whether the published Data Model's `Document` card is republished. Flagged,
      not owned.
- [ ] **Take delivery of the real document corpus** — after F6's other half. Dates on [fuses.md](fuses.md)
      the day it lands. **4.5 cannot start without it.**
- [x] **Clear week 3's director-uploaded staging filings** — 7 Sep. Bucket prefix
      `unit/01a07769-777c-72c7-a31d-ae989efe9b47/` then unfile those two `file_hash` rows on staging
      (2 links, 2 documents). Unit page then empty. Specimens on the other אלון 12 unit left.
      `docs-delete.sh` alone does not clear the panel.

**Carried in and already owned elsewhere:** `environment: production` has no protection rules —
[roadmap.md](roadmap.md) week 12. Docs-bucket `legacyObjectOwner` delete — week 8. `party_contact`
btree — week 12. Session, CSRF, and a cap on upload *count* — week 5. Signed URLs — week 5.
`uploaded_by` and `superseded_by` — week 5. `tenant_visible` — week 9.

---

## Slices

- [x] **4.1 — Document AI OCR adapter.** The **general OCR processor, not Form Parser** — the schema
      is already declared, so Google needn't infer structure. Hebrew print and handwriting, word
      boxes, per-word confidence.
      **Done when:** a scanned Hebrew lease yields word-level boxes and confidences, and the
      residency position is recorded in the evidence file rather than assumed.
      **Verify:** boxes rendered over the page image for one document; a scan and a native PDF both
      handled.
      **Owed by 3.3 — `unverified` is a backlog with no reader.** Verify the declared type against
      the OCR text at extraction time, and say in the evidence **how many already-filed documents
      the sweep changed the verdict of**.
      **Owed by the week-3 demo — a heavy signed-lease PDF must not become an uncaught 503.** Bound
      the reader (time and memory). Fail closed as `invalid` or file as `unverified`. Record the
      bound in the evidence.
      **Closed 7 Sep** — [evidence/4.1.md](evidence/4.1.md). Processor `eu` /
      `bd23faa1bd256c46`. Staging backlog sweep owned at 4.3.
      **Deps:** 3.3 · **M** · **plan mode first** (kernel + evidence)

- [ ] **Staging sweep of already-filed `unverified` rows.** 4.1 built `ocr:sweep` and measured it
      locally (examined 1, verified 1). Not run at 4.2–4.4: laptop cannot impersonate
      `app-staging`. After the 4.4 revision serves, run `npm run ocr:sweep` as `app-staging` and
      write the count (zero is a count). **Director.**

- [x] **4.2 — Comprehension into the declared schema — the open half of A8.** **Closed 7 Sep** —
      [evidence/4.2.md](evidence/4.2.md). Pointer-only `extracted_field`; geometry from the
      measuring engine; extra field mid-test with no DDL. Staging sweep carried to 4.3.
      **Deps:** 4.1, 3.1 · **M**

- [x] **4.3 — Promotion, with provenance — the governed half of A8.** **Closed 7 Sep** —
      [evidence/4.3.md](evidence/4.3.md). FieldPromotion CHECK; stamp `23001` off-path; unmapped
      field cannot promote; TenancyEvent `amended`; R9 scan red first. Staging sweep carried to 4.4.
      **Deps:** 4.2 · **M** · **plan mode first** (evidence + tenancy)

- [ ] **4.6 — A2: a lease establishes a draft tenancy.** Extract → propose → **confirm** → write.
      Unit, dates, and every tenant named on the lease (two signatories per household is normal).
      **Role is confirmed by a human before any `tenancy_party` row is written.** Parties are created
      **under the tenancy the document was uploaded to**; no cross-tenancy identity matching.
      Guarantors frequently absent: returning zero of them is a correct result.
      **Done when:** a confirmed proposal writes a `DRAFT` tenancy with per-field provenance; the
      address and apartment on the document are asserted against the unit; a mismatch is refused
      and writes no party.
      **Verify:** two-signatory specimen writes two tenants; guarantor-absent specimen writes none
      and does not error; wrong-address case refused.
      **Owed by 3.3 — the content cross-check and the draft-tenancy path.**
      **Owed by 3.5 — `upsertUnitRow` still writes only a `UNIT` space**, so register-imported
      buildings have no `PARKING` or `STORAGE` rows. Close it here so A6 can land on a bay.
      **Owed by 3.5 — A2's staging shape**, recorded rather than invented in the slice.
      **Deps:** 4.3, 3.3, 3.5 · **M** · **plan mode first** (estate · parties · tenancy · evidence)

- [ ] **4.7 — A3: an addendum completes a tenancy.** No special case: fields live on the tenancy and
      documents are provenance. Later document wins; earlier value retained and visible.
      **Done when:** a guarantor named in an addendum becomes a `tenancy_party` under the existing
      tenancy, and a later date overwrites an earlier one without deleting the earlier provenance.
      **Verify:** addendum after a lease, same path as 4.6; both provenances on screen.
      **Deps:** 4.6 · **S**

- [x] **4.4 — Click a value, see the pixels.** The provenance viewer: the page image scrolls to the
      box the value came from.
      **Done when:** every promoted field on the unit screen is clickable through to its pixels.
      **Verify:** demonstrated live on three different documents.
      **Owed by 4.1 / 4.2 / 4.3 — staging sweep of `unverified`.** After the reader serves,
      `ocr:sweep` as `app-staging`; write the count (zero is a count).
      **Closed 8 Sep** — [evidence/4.4.md](evidence/4.4.md). Href + `:target`, no script.
      Three-document hrefs in the token suite. Staging sweep still director after this revision
      serves.
      **Deps:** 4.3 · **M**

- [ ] **4.8 — A4: the incomplete-tenancy queue.** The rule: *a tenancy must have at least one
      guarantor*. A **policy case over saved rows, written red first — never a NOT NULL**.
      **Done when:** a tenancy that extraction returned with zero guarantors appears in the queue
      showing what is missing; an addendum (4.7) or a recorded exception clears it.
      **Verify:** policy case red first; lease with zero guarantors in the queue; A3 removes it.
      **Deps:** 4.7 · **M**

- [ ] **4.5 — The accuracy number.** Per-field accuracy across ~40 real leases. **Cannot start
      until the director has taken delivery of the corpus**, after F6's three acts. Arrival and
      removal dates go on [fuses.md](fuses.md) the day it happens.
      **Done when:** a per-field accuracy table exists with its sample size, its failure modes named,
      and a stated removal date for the source documents.
      **Verify:** the run is reproducible from a script; numbers in `tasks/evidence/`, never as an
      assertion in a document.
      **Deps:** 4.4, 3.2 · **M**

### **Checkpoint · M1** (end of this week)

- [ ] A system of record for 1,500 units; every value traces to the paper it came from
- [ ] Policy cases 1, 2 and 3 green, each having been red first; both grep guards live
- [ ] Meta verification landed or its status confirmed on the asks slide
- [ ] The three success numbers agreed with the client, not proposed
- [ ] Weeks 5–8 decomposed to slice level in [roadmap.md](roadmap.md) before week 5 starts
- [ ] UI-pass decision: whether week 2 and 3 interface comments earn a slice of their own

---

**Cut line, in order:** 4.5 (blocked on the corpus — say so at freeze rather than stretching the
week); then 4.8's queue chrome (the policy case is what matters); then 4.7 if A2 already travels the
addendum path. **Do not cut 4.1, 4.2, 4.3, 4.6 or 4.4** — those are the demo.
