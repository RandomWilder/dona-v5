# Evidence — Week 3 close · Documents filed against units

**Closed:** 2026-09-07 · **Planned window:** Sun 20 – Thu 24 Sep 2026 · **Demo kind declared Sunday
7 Sep: Software.**

> The week's acceptance bar is the demo: upload a lease against a unit and a tenancy, then find it
> again in four seconds — hashed, dated, immutable, attached. Nothing is read yet. This is a filing
> cabinet with a search box.

## What closed

Five slices, 3.0 – 3.3 and 3.5 – 3.6, each with its own evidence file under this directory. All
merged to `main`; working tree clean at `34ab3a5`.

| | |
|---|---|
| Slices planned | 6 |
| Slices closed | **5** — 3.4 deferred 6 Sep, before the week started, not cut at the end |
| Evidence files | 6, plus this one (3.0 through 3.3, 3.5, 3.6) |
| Elapsed | 7 Sep 2026, one calendar day against four planned build days |
| Tests on every merge | **396** code + **41** hooks — plus **44** policy cases and 3 grep guards, both gates required |

**The chain was 3.0 → 3.1, then 3.2 / 3.3 / 3.5 off 3.1, then 3.6.** 3.4 stayed deferred with F4.
The cut line at the bottom of [todo.md](todo.md) — the compliance tab's visual treatment — was never
reached; grouping by type in 3.6 shipped anyway.

## The demo, as given

Presented **7 Sep 2026**, thirteen days ahead of the planned Thursday 24 Sep, for the same reason
weeks 1 and 2 were early: the week's slices were closed and holding a finished build adds nothing to
show. Given off **staging**, never a laptop, on the same URL as last week —
`https://dona-staging-r44j24yuaa-zf.a.run.app` — revision `dona-staging-00042-dml` at `6ff6e8f`.

What the room saw: an administrator declared a type, uploaded a Hebrew lease specimen against a unit
and a letting, and found it again from search and the unit panel. A wrong file in the lease slot was
refused and left nothing filed. Search was timed by the owner on staging and met the four-second
bar. The panel showed type, dates, ingest date, verification text, and the storage path as text —
never a download.

**The four-second bar is discharged here**, not in [3.6.md](3.6.md). That file recorded the find path
against the tests and left the stopwatch to the owner; the owner ran it in the room.

**Said in these words:** the paper is authored to the published forms' structure, ours and invented.
What is real is the path — hash, store, guard, search — and that the application cannot delete a
signed contract.

**Stakeholder response:** the demo worked; management gave a blessing to proceed to week 4. Feedback
was positive. Nothing raised was a correctness, isolation or data question. UI comments remain
parked at **M1**, same ruling as week 2 — inventing a design pass to answer applause would displace
reading the lease.

**Pre-demo, the same day:** a real-looking signed-lease PDF (not the authored specimen) was uploaded
on staging against דירה 4 of בניין האלון 12. After about a minute the screen showed
`{"code":"unavailable","message":"unexpected error"}`. The unit was fine; the file was not the
substrate the reader was proved on. The demo used a printed specimen. **4.1 owns the reader** — a
scan or a heavy signed PDF must not become an uncaught 503.

## Asks put to the room

F2 the WhatsApp number under the company entity · F4 Drive access (bulk and published forms, not
this week's intake) · F5 / F7 the organisation · F6's three acts (execute OpenAI's DPA, confirm
Google Cloud's is in force, publish the notice to data subjects) · F1 still burning (window 18 Sep –
2 Oct). Walk recorded in [fuses.md](../fuses.md).

## Carried into week 4

1. **F2, F4, F5 and F7 remain unlit; F3 is off month one's critical path; F6 is lit and half
   discharged.** [fuses.md](../fuses.md) is the register. F6's three acts block the tier-2 corpus and
   therefore **4.5**, and nothing else in week 4.
2. **The notice-delivery question** — how the notice reaches a tenant. Owed before week 9.
3. **2.5 — import the real register.** Pilot-preparation with F3. Still owns the reject count and
   whether Priority's export carries vacant apartments as rows.
4. **3.4 and A10 — Drive ingestion and the bulk review queue.** Deferred with F4. The published
   forms sit beside the authored tier-1 text at that step, and never replace it.
5. **`upsertUnitRow` still writes only a `UNIT` space.** Register-imported buildings have no
   `PARKING` or `STORAGE` rows. Shoham fixture already has 60 bays and 40 rooms. **4.6 (A2) owns
   it.**
6. **`unverified` is a backlog with no reader.** 4.1 sweeps it and records how many verdicts moved.
7. **A real signed-lease PDF stalled and surfaced as `unavailable` / unexpected error.** 4.1 owns
   the bound: pdfjs on a heavy or image-led file must fail as `invalid` or as `unverified`, never as
   an uncaught 503, and must not occupy the request for a minute to get there.
8. **A2 — a lease establishes a draft tenancy**, including 3.3's content cross-check and the draft
   path that upload could not take before extraction. **4.6.**
9. **A3 and A4** — addendum completes a tenancy; incomplete-tenancy queue (at least one guarantor,
   policy case, never NOT NULL). Sized at this close as **4.7** and **4.8**.
10. **E16 versioning is one column, not two** on `ExtractedField`. **4.2.**
11. **The UI comments from weeks 2 and 3.** Parked at **M1**.
12. **Director's call, owned by no slice:** whether the published Data Model's `Document` card is
    republished. Changing a client-facing artifact is not a slice's to make.
13. **`environment: production` has no protection rules** — week 12. Docs-bucket `legacyObjectOwner`
    delete — week 8. `party_contact` btree — week 12. Session, CSRF, and a cap on upload *count* —
    week 5. Signed URLs — week 5.

**Staging demo filings — two acts, both required, proved 7 Sep.** The unit panel lists
`document_link` rows. `docs-delete.sh` removes objects only. After the prefix delete, דירה 4 still
showed both cards. Unfiled on staging by `file_hash` (the object leaf): 2 links, then 2 documents,
asset refs 0. GET of that unit then showed the empty copy and no חוזה שכירות. Specimens on the other
אלון 12 unit were not touched. Soft-delete window untouched; objects restorable seven days.

```
./infra/docs-delete.sh unit/01a07769-777c-72c7-a31d-ae989efe9b47/
# then DELETE document_link / document for those two hashes on staging — not prod, not --all
GET /estate/units/01a07769-777c-72c7-a31d-ae989efe9b47
  → אין מסמכים בתיק זה עדיין
```

## The schedule from here

Week 4 starts **7 Sep 2026**, the day week 3 closed, rather than on the planned 27 Sep. **The dates
in [roadmap.md](../roadmap.md) are not rewritten.** After three weeks the project is running roughly
three calendar weeks ahead of its plan; that gap is a measurement.
