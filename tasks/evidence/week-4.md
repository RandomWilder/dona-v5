# Evidence — Week 4 close · The machine reads a lease, and shows its work → **M1**

**Closed:** 2026-09-09 · **Planned window:** Sun 27 Sep – Thu 1 Oct 2026 · **Demo kind declared
Sunday 7 Sep: Software, with an Evidence number attached.**

> The week's acceptance bar is the demo: drop in a Hebrew lease. Rent, dates, parties and clauses
> appear as fields. Click any value and the page image scrolls to the pixels it came from, with a
> confidence score. **And then the fields have to land somewhere** — flows A2, A3 and A4 were added
> to this week on 6 Sep, which is why it carries nine slices instead of five.

## What closed

| | |
|---|---|
| Slices planned | 8 — 4.1–4.5, plus 4.6 / 4.7 / 4.8 sized at week 3's close |
| Slices closed | **9** — 4.1, 4.2, 4.3, 4.4, 4.6, **4.6a**, **4.6b**, 4.7, 4.8 |
| Slices cut | **1 — 4.5, cut and travelling**, for a reason known before the week began |
| Evidence files | 9, plus this one |
| Elapsed | 7–9 Sep 2026, three calendar days against four planned build days |
| Tests at close | **450** code + **41** hooks + **47** policy · **0 failed** · **3** grep guards, 0 violations |
| Merged | all to `main`, ten PRs (#50–#59), tip `b5127e0` |

**4.6a and 4.6b were not planned and are not scope creep.** They are 4.6 splitting under contact
with a real document: 4.6a because the building number and the apartment number were being swapped
and dates were not stored as ISO, and 4.6b because *confirm* was inventing a `terms_profile` name
instead of selecting one that exists. Both are corrections to a slice that had already been declared
done, caught before the week closed rather than after.

**The chain ran 4.1 → 4.2 → 4.3, then a fan** — 4.4 and 4.6 off 4.3, 4.6a and 4.6b off 4.6, 4.7 off
4.6, 4.8 off 4.7. Exactly as `todo.md` predicted it on the Sunday.

## The demo, as given

Given off **staging**, never a laptop, on the same URL as the last three weeks —
`https://dona-staging-r44j24yuaa-zf.a.run.app`. Serving revision at close **`dona-staging-00054-4jx`**
at commit **`b5127e0`**; health verified at the close itself:

```
./infra/smoke.sh https://dona-staging-r44j24yuaa-zf.a.run.app
smoke ok — .../health → {"ok":true,"version":"b5127e0","db":"up"}
```

**The demo succeeded.** A Hebrew lease was dropped in; rent, dates, parties and clauses came back as
fields; clicking a value scrolled the page image to the pixels it came from with a confidence score.
The write half was shown too — a confirmed lease established a draft tenancy, an addendum completed
one, and the incomplete-tenancy queue showed a letting with no guarantor and then stopped showing it.

**Said in these words:** the model reads and proposes; it never writes. Every value on a business
record has a named promoter, a source document, and a box on a page. A bounding box in this system
has never come from a language model — an OCR engine measured it — and there is a contract test that
fails if one ever does (4.2).

## The number this week was supposed to attach, and did not

**4.5 — the accuracy number — is CUT, and cut is not the same as silent.**

- **Reason:** it needs ~40 real leases, and the tier-2 corpus waits on **F6**, whose burn time
  belongs to the director and to counsel. Nothing engineering owed it was missing: 1.12 built the
  bucket, the 90-day lifecycle rule, the proved deletion path and the storage audit config, and
  4.1–4.4 built the entire read path it would measure.
- **Declared blocked on the Sunday that opened the week**, in `todo.md`, and named on the cut line
  there — not discovered at Wednesday's freeze. It was never cut to make room; the room existed.
- **It travels to pilot preparation**, the same treatment **2.5** took with F3 and **3.4** took with
  F4. A slice blocked on a burn time we do not control is moved to the step where its fuse lands. It
  is not held open against a closed week and it is not restated weekly as if restating moved it.
- **Bounded by week 12**, the pilot cutover. The accuracy number decides how much human review the
  backfill needs, so it must exist before the backfill and the backfill before the pilot. Waiting
  costs nothing until then and costs the pilot after.

**What this means for the claim we make to the client:** the system reads Hebrew leases and shows its
work, demonstrated. **How well it reads *their* leases is not yet known and must not be implied.**
Tier 1 has the structure and not the scans, the handwriting or the signatures. That sentence goes on
the asks slide as a fact, not as a caveat in small print.

## The staging sweep, discharged after four carries

Raised at 3.3 as *`unverified` is a backlog with no reader*, then carried 4.1 → 4.2 → 4.3 → 4.4,
each time for the same honest reason: no serving revision carried the reader yet. **Discharged 9
Sep**, and by the route slice 1.5 argued for — never from a laptop, never as a human.

| | |
|---|---|
| Job | `dona-staging-ocr-sweep`, execution `dona-staging-ocr-sweep-89njg`, **exit 0** |
| Identity | `app-staging`, the runtime service account — not the deploy account, not a person |
| Image | the **serving image digest** `b5127e04a57c87643ff7cc5d0fd07ea7bc72c1e2`, `--max-retries 0` |
| Reader / docs | `documentai:eu/bd23faa1bd256c46` · `gs://dona-v5-staging-docs` |
| Result | **examined 2 · verified 0 · unchanged 2 · failed 0** |

**Zero failures is the number that says the sweep worked. Zero promotions is a fact about those two
files** — the reader ran on both and their declared terms still did not check out, which leaves
`unverified` by design (4.1) rather than erroring. The backlog was smaller than 4.3 expected because
week 3's director-uploaded staging filings were cleared on 7 Sep. `ocr:sweep` refuses to report zero
from an unconfigured reader, which is what makes this zero readable: an unconfigured reader is not a
measurement of an empty backlog.

## Checkpoint · M1 — five of six

- [x] **A system of record for 1,500 units; every value traces to the paper it came from.** Volume at
      2.6 — 1,500 units into staging, 0 rejected. Provenance at 4.2 → 4.4. **The register is
      generated, not real**: 2.5 travelled to pilot preparation with F3, and volume is what an index
      decision needs, which is a different fact from realness.
- [x] **Policy cases 1, 2 and 3 green, each red first; both grep guards live.** Case 1 at 2.2, case 2
      at 2.1, case 3 at its own slice. Verified 9 Sep at **450 code + 41 hooks + 47 policy, 0
      failed**. The guards are now **three**, not the two this box was written against —
      `no-current-tenant-column` (20 files), `isolation-join-lives-in-src-scope` (161),
      `pii-columns-are-commented` (20), 0 violations. A superset, stated rather than quietly enjoyed.
- [x] **Meta verification landed or its status confirmed on the asks slide** — **confirmed, not
      landed.** F1 is in progress on the correct legal entity and its burn window (18 Sep – 2 Oct)
      **has not opened yet**. The box asks for either; this is the honest one.
- [ ] **The three success numbers agreed with the client, not proposed** — **not reached, and the
      director's.** It does not block week 5. It blocks the **M3 go/no-go**, which is the decision
      those numbers exist to make, and the cost of arriving at week 12 without them is that the
      go/no-go has no agreed yardstick.
- [x] **Weeks 5–8 decomposed to slice level before week 5's Monday** — done 9 Sep, **25 slices**.
      See below.
- [x] **UI-pass decision: whether weeks 2 and 3's interface comments earn a slice** — **decided: no.**
      Parked at week 2, parked again at week 3, raised here as the checkpoint requires, and closed
      rather than parked a third time. Nothing raised was a correctness, isolation or data question,
      and **week 5 puts every one of those screens behind a session and may change what they show** —
      a design pass now would be run against screens about to change shape. Reconsidered at **M2**,
      when the console is the product rather than a proof that queries work.

## The weeks-5–8 decomposition

Done 9 Sep, in `roadmap.md`: **25 slices** — 5.1–5.8 · 6.1–6.6 · 7.1–7.6 · 8.1–8.5 — each with
**Done when · Verify · Deps · Size**. The month-two table was not rewritten; the sections sit beneath
it, because that table is the plan of record and roughly forty citations elsewhere point at its
cells.

**Three conflicts were resolved rather than inherited:**

1. The docs-bucket `legacyObjectOwner` delete and `run.admin` per-service scoping said **week 6** in
   two files and **week 8** in five. Resolved to week 8, **slice 8.4**; `SPEC.md` and
   `infra/bootstrap.sh` corrected.
2. Policy cases 4 and 5 appeared in **both** the week-6 and week-8 rows. Resolved as sequence:
   **written red-first and green at 6.4 / 6.5**, **attacked at 8.5**.
3. `infra/bootstrap.sh` parked prod point-in-time recovery as a "week 6 item" — week 6 is the policy
   module, and prod answers 503 until the first pilot tag, so PITR bought there pays to recover an
   empty database. **Re-homed to week 12**, beside the prod restart.

**One obligation was found that no week carried.** **Redaction at the provider boundary** —
ADR-0004 decision 2, *"untouched and still owed before week 10"* — had been left as "its own slice in
month one or riding with 4.2", and month one is closing without it. Week 10 puts a tenant's own
question and their own lease through a model call. It is now **slice 8.1, first in its week**, sized
L, and named as the only item in month two with a deadline the project does not control.

**And open question 2 moved.** *How many `terms_profile`s are in force* was promised to week 5 and
sizes week 6 — but the answer is in the **real** register, which travelled to pilot preparation with
**F3**, and 4.6b already ruled that an empty profile list on staging is answered by importing the
register and never by seeding a fake annex. **It is F3-blocked, not week-5-blocked.** Recorded on F3,
on week 5's header, and on the question itself in `plan.md`.

## The fuse walk

**Walked 9 Sep 2026 at this close. No fuse changed state during week 4** — the movement was in what
they block.

| Fuse | State | Movement this week |
|---|---|---|
| **F1** Meta verification | In progress, correct entity | Window **18 Sep – 2 Oct has not opened**. Silence is the expected state until 18 Sep. Needed week 9 |
| **F2** WhatsApp number | Unlit | None. Waits on the entity decision, same as F5/F6/F7 |
| **F3** Priority ERP keys | Unlit, off month one | **Widened** — now also gates open question 2 and therefore week 6's *sizing* |
| **F4** Drive access | Unlit, re-scoped to pilot prep | None |
| **F5** / **F7** The organisation | Unlit | Folded into F6's entity question — asking it once answers all three |
| **F6** ADR-0004 legal basis | **Lit**, engineering half discharged | **The ask grew from three acts to four questions.** See below. Blocks 4.5 and nothing else |

**F6's new finding, raised 9 Sep and the most consequential thing in this week that is not code.** A
processor's addendum binds **the account holder**, and today the account holder is not the party the
notice names as controller: the `OPENAI_API_KEY` is a CI-only key on our account (1.6), and the GCP
project is org-less under a `gmail.com` owner (1.5, F7). Two shapes:

- **The accounts move to Dona Dom** → controller → processor, and the three acts stand as written.
- **The accounts stay ours** → Dona Dom is the controller, we are its processor, OpenAI and Google
  Cloud are sub-processors, and **a fourth instrument is owed that appeared in no plan file: a data
  processing agreement between Dona Dom and us.** Not a negotiation, but a document somebody has to
  write, and it is not written.

**So the ask is now: settle the signing entity · execute OpenAI's DPA · confirm Google's is in force
and file the record · review and publish the notice.** The entity comes *first*, because it decides
what goes on the OpenAI form. Handed to the director on 9 Sep in English and in a simplified Hebrew
version for Dona Dom's stakeholders.

**What the walk changes for week 5: nothing. No slice of week 5 depends on any fuse.**

## Asks put to the room

The signing entity (F5 / F6 / F7 — one question, three fuses) · F6's remaining acts · F2 the WhatsApp
number under the company entity · F4 Drive access for bulk and the published forms · F1 status, with
its window opening 18 Sep · **the three success numbers, still owed and now the open M1 box** · and
the accuracy-number caveat: read demonstrated, read-*their*-leases not yet measured.

## Carried into week 5 — every item, with the slice that closes it

1. **4.5 — the accuracy number.** Cut and travelling to pilot preparation with **F6**. Bounded by
   week 12. Not week 5's.
2. **Take delivery of the real corpus**, after F6. The arrival and removal dates go on `fuses.md` the
   day it lands, and the removal is run by hand on the day rather than trusted to the lifecycle rule.
3. **Session, CSRF, and a cap on upload *count*** → **5.2**. Seven routes have been unauthenticated
   since week 1, deliberately and on fixture data. **Nothing may put a real party, contact or
   document behind them before 5.2 closes** — that constraint is now three weeks old and is the
   single most important sentence carried out of month one.
4. **`uploaded_by`, signed URLs, and `superseded_by` re-asked** → **5.4**.
5. **`national_id` never in an agent tool's response shape** → **5.3**, a policy case, red first.
6. **The A9 settings screen** → **5.8**. Clock-driven `TenancyEvent` kinds and Obligation /
   ObligationType → **5.6** and **5.7**.
7. **Cross-tenancy party identity** → **5.5**. `SPEC-flows.md` said "month two" and named no week;
   month two now has named weeks.
8. **Open question 2** → **F3**, not week 5. Week 6's sizing depends on it.
9. **Open question 4 — are the Shoham buildings still inside תקופת הבדק** → **6.3**, and it decides
   whether week 6 demos a live ternary case or a synthetic one. Ask it at week 5's demo.
10. **Redaction at the provider boundary** → **8.1**, hard-bounded by week 10.
11. **The IAM pass** — `run.admin` per service, docs-bucket `legacyObjectOwner` → **8.4**. Node-20
    action bumps and `release.yml`'s size line → **8.3**.
12. **Prod PITR** → week 12, beside the prod restart.
13. **`tenant_visible`** → week 9. **`environment: production` protection rules** and the
    **`party_contact` btree** → week 12.
14. **2.5 (real register) and 3.4 / A10 (Drive ingestion, bulk queue)** — still at pilot preparation
    with F3 and F4.
15. **Director's call, owned by no slice:** whether the published Data Model's `Document` card is
    republished. Changing a client-facing artifact is not a slice's to make.
16. **The three success numbers** — the open M1 box. Blocks M3, not week 5.
17. **The notice-delivery question** — how the notice reaches a tenant. Owed before **week 9**, and
    it is the one item in the draft with an engineering consequence.

## The schedule from here

Week 5 starts **9 Sep 2026**, the day week 4 closed, rather than on the planned 4 Oct. **The dates in
[roadmap.md](../roadmap.md) are not rewritten.** After four weeks the project is running roughly
three and a half calendar weeks ahead of its plan, and that gap is a measurement only because neither
side has moved to meet the other.

**Week 5 is the largest single week in the plan so far**, and knowingly: it discharges five weeks of
*"until week 5"* — the session, the CSRF token, the per-caller bound, `uploaded_by`, signed URLs, and
the rule that says a screen may show a state and a count and never a name. Two L slices in one week
is the price of having deferred the session honestly instead of half-building it. The cut line is
written on the week in `todo.md`: **5.8 first, then 5.7. Never 5.1 or 5.2.**
