# Week 2 · Sun 13 – Thu 17 Sep 2026 — All 1,500 units, from the register

> **Demo kind, declared Sunday 6 Sep: REAL DATA — and it is the one line in this file that is not
> ours to keep.** See *The declared demo kind and F3* below: slices 2.1–2.4 do not need the Priority
> ERP keys, **2.5 and 2.6 do**, and the keys are the client's to issue. Unlit, this week ends with
> the schema and the importer proved against a fixture we designed and the register still outside
> the system — which is an **evidence** week, honestly declared, not a real-data one quietly missed.
>
> **Week demo (Thu):** the same URL as week 1, now with every building across Shoham, Beit Shemesh,
> Ashdod, Lod and Ashkelon — units, tenancies, parties, searchable.
> **Freeze:** Wednesday. The last merge that reaches staging lands Wednesday.
>
> Week 2 starts **6 Sep 2026**, the day week 1 closed, rather than on the planned 13 Sep. The dates
> in [roadmap.md](roadmap.md) are never rewritten; the gap between them and the evidence files is the
> measurement of how the project ran.
>
> One slice = one focused session, half a day or less. **Done when** is the acceptance bar; **Verify**
> is the check that proves it — no self-certification. The standing bar every slice also clears is
> the Definition of Done in [plan.md](plan.md).

**Six slices, and the shape of the week is a chain, not a fan.** 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6,
each depending on the one before it. There is no parallel track to fall back on, which is why the cut
line at the bottom is at the *end* of the chain and not in the middle of it.

---

## The declared demo kind and F3 — the director's call, stated here rather than on Thursday

The roadmap declares week 2 **Real data**. That promise is only ours to keep for four of the six
slices:

| | Needs F3 (Priority read-only keys)? |
|---|---|
| 2.1 Party · PartyContact | no |
| 2.2 Tenancy · TenancyParty | no |
| 2.3 `src/scope/` | no |
| 2.4 The importer | no — it is proved against a designed file |
| **2.5 Import the real register** | **yes** |
| **2.6 Browse at portfolio scale** | **yes** — 1,500 units is what makes it *scale* |

**F3 is unlit** ([fuses.md](fuses.md)). It was on week 1's asks slide and it is the ask with a date
on it. For the declared kind to hold, the keys have to be in hand by **Tuesday**, leaving 2.5 and 2.6
inside the Wednesday freeze. Later than that and the honest move is to re-declare the week as
**Evidence** on Wednesday rather than demo a fixture and call it the register: a demo kind changed in
advance is a plan, and one changed on Thursday is an excuse
([rollout-cadence.html](../docs/rollout-cadence.html)).

- [ ] **Confirm F3 by Tuesday, or re-declare the week.** The director's, and the only item in this
      file that is.

## Also this week

- [ ] **Walk [fuses.md](fuses.md).** F2, F3, F4, F5 and F7 are unlit; F6 is lit and half discharged.
      Everything unlit goes on Thursday's asks slide. The register is that file and this one does not
      duplicate it.
- [ ] **F6's other half — three named acts**, blocking the tier-2 corpus and nothing in week 2:
      execute OpenAI's DPA, confirm Google Cloud's is in force, publish the notice to data subjects
      ([../docs/data-subject-notice.draft.md](../docs/data-subject-notice.draft.md)).
- [ ] **Answer one question out of the notice draft: how it reaches a tenant.** "On first contact
      through the agent channel" means week 9 builds a step for it, so the answer is owed before
      week 9 rather than during it (notice draft, item 4).
- [ ] **Open question 6 — what document types the Drive folders actually contain.** Blocked on F4.
- [ ] **Take delivery of the real document corpus** — the controls have existed since 2026-09-06 and
      the data does not, which is the order **R4** asks for. Owed after F6's other half. Record the
      arrival and removal dates on [fuses.md](fuses.md) the day it lands.

**Carried in and already owned elsewhere, named here so nothing is unowned:** `environment:
production` has no protection rules — a `v*` tag is the only thing between a commit and prod, which
is correct while prod is stopped and wrong from week 12, where [roadmap.md](roadmap.md) owns it.

---

## Slices

- [x] **2.1 — Party and PartyContact, temporally dated.** E5 and E6, 13 columns. `PartyContact`
      carries `valid_from` / `valid_to` because Israeli mobile numbers get recycled, and
      `preferred_language` is a locked field on Party.
      **Done when:** the same phone number can belong to two parties over two non-overlapping
      periods, and to only one on any given day.
      **Verify:** contract tests in `src/parties/schema.test.ts`, every rejection proved red first
      against the same DDL without its constraint, with the SQLSTATE recorded. · **M**
      **The roadmap's Verify for this slice is wrong, in exactly the way 1.9's was.** It says
      *"policy case 2 goes green — it was red in 1.7"*. **No policy case goes green here.** All seven
      reach `party` through `seedOccupancy`, which also writes `tenancy` and `tenancy_party`, so they
      clear at **2.2**. What this slice changes is visible and is the whole signal: **the pending
      diagnostic moves from `party` to `tenancy`**. Recorded in [roadmap.md](roadmap.md) beside 1.9's
      correction rather than only here.
      **Owed by 1.12 — the first migration guard three was built for.** `0006_` is the first DDL in
      this repository with a person in it. `scripts/guards.ts` fails the build if `phone`, `email`,
      `national_id`, a name or a birth date arrives without `-- pii` on its line or in the comment
      block above it; the escape is `-- not-pii: <why>` and it costs a sentence. The guard has been
      green against five migrations since 1.12 and has never fired — this is the slice where it
      either fires or the marker was written, and either outcome is the control working.
      **Owed by 1.7 — three cases, not one, and the sharpest is the third.** `tests/policy/` holds
      *"resolves to nobody once the tenancy and the contact have both closed"*, *"resolves to the new
      holder's own unit and never to the previous one"*, and *"stops a stranger reaching a unit whose
      tenancy is still running"*. Only the third makes the contact dating load-bearing: in the other
      two the ended tenancy does the work, which mutation testing at 1.7 found the hard way. Extend
      `tests/policy/fixtures.ts` for `party` and `party_contact`; do not edit the cases.
      **Closed 2026-09-06** ([evidence](evidence/2.1.md)). `0006_parties.sql` — 13 columns, an
      **exclusion constraint** rather than application code for the acceptance bar, and two CHECKs
      beside it. **`tests/policy/fixtures.ts` needed no edit**, which is the workbook being a
      specification rather than a description. The pending diagnostic moved `party` → `tenancy` on
      all seven cases. Seven rejections proved red against the same DDL with only their own
      constraint removed — six accepted outright, and `validity_is_ordered` rejected anyway as an
      unnamed **22000** instead of the named **23514** the case asserts, which is the whole of that
      CHECK's value and was found by the probe rather than claimed. **Both remaining guards fired
      and neither was worked around:** guard three learned table-qualified names so it could see
      `party_contact.value`, and guard two fired for the first time on work that was not a
      violation and was made to say what it means. 259 tests on every merge, up from 238.

- [x] **2.2 — Tenancy, TenancyParty, and the guarantor constraint.** E7 and E8. `TenancyParty.role`
      ∈ tenant · co_tenant · guarantor · occupant, and **`is_service_contact` is forced false for
      `GUARANTOR` by a database constraint** — no toggle, no import path, no agent override.
      **Done when:** the insert is *rejected*, not defaulted politely.
      **Verify:** **policy case 3 goes green**, asserting the rejection; write it red first. · **M**
      **Owed by 1.7 — two things this slice has to supply.** The isolation join already carries
      `tp.is_service_contact`, so the constraint built here is *spent* at the front door rather than
      merely stored: 1.7's case *"never resolves a guarantor to the unit they guarantee"* asserts it
      from the other side and goes green with the table. And **`Tenancy.terms_profile_id` is a NOT
      NULL foreign key in the workbook and is deliberately absent from `tests/policy/fixtures.ts`**,
      because `TermsProfile` is modelled nowhere yet — add it to the builder here, in one place.
      **Owed by 2.1 — this is where the seven policy cases actually clear.** `tenancy_party` is the
      last relation `seedOccupancy` writes, so the pending branch in `tests/policy/support.ts`
      becomes unreachable the moment this migration lands. **Confirm it by the diagnostic lines
      disappearing and the case count staying the same** — a case that stopped reporting pending and
      also stopped running looks identical in a green summary.
      **Closed 2026-09-06** ([evidence](evidence/2.2.md)). `0007_tenancy.sql` — E7 and E8's 12
      columns, plus a minimal `terms_profile` because a NOT NULL foreign key needs a target, which is
      E1 `project`'s move at 1.9. **All seven policy cases now assert**: zero pending diagnostics,
      and the count still the same 26 as the day before, measured before this slice added its own four
      cases. `tests/policy/relations.test.ts` now fails the build if one ever takes the pending branch
      again, rather than a human having to read diagnostics. Policy case
      3 written red first against the real constraint dropped from the database — the insert was
      **accepted and stored**. Eleven rejections proved red against the same DDL with only their own
      constraint removed. Two beyond the guarantor rule were decided here rather than deferred: the
      workbook's *"no overlap allowed on one unit"* as an **exclusion constraint partial on
      `ACTIVE`** (a `TERMINATED_EARLY` lease keeps its contractual `end_date`, so a blanket one would
      reject correct history), and the natural key `(unit_id, start_date)`, moved up from 2.4 because
      1.11 measured what shipping a spine without one costs. **Two guards fired on this slice's own
      comments and neither was worked around** — guard one on the forbidden column name written in
      prose, guard two on a comment quoting the tenancy-active predicate, which is the identical
      mistake 2.1's evidence recorded, caught again one slice later. **The pending branch was masking
      a broken fixture**: `seedUnit` created a second building at the same address, which 1.11's
      `building_address_unique` has rejected since week 1 — invisible while the first `seedOccupancy`
      aborted the transaction on 42P01. 279 tests on every merge, up from 259.

- [x] **2.3 — `src/scope/` — the isolation join, written once.** The five hops, in SQL, before any
      model call. The current-occupancy VIEW (R6) alongside it: `today ∈ [start_date, end_date]`,
      computed on every load.
      **Done when:** Q1 and Q2 from the workbook's ADMIN VIEWS sheet are each one query, and no other
      module contains the join's temporal predicate.
      **Verify:** **policy case 1 goes green**; grep guard 2 stays green with the join in exactly one
      file; guard 1 confirms no `current_tenant` column was introduced. · **M**
      **Owed by 1.7 — the join already exists; this slice finishes the module around it.** Three
      things 1.7 deliberately did not build, all recorded in `SPEC-scope.md`: the **current-occupancy
      VIEW** in a migration, with the resolver reading it instead of the base tables; the
      **scoped-read audit line**, which `SPEC.md`'s security defaults require and `kernel/audit.ts`
      already supports — re-confirmed as this slice's at 1.12, which delivered access logging for the
      tier-2 corpus as a Cloud Audit Logs config on the bucket and could not deliver the application
      half, because a scoped read returns nothing until `party` and `tenancy_party` exist; and
      **E.164 normalisation at the edge**, because a number stored in one format and asked in another
      resolves to nobody, which looks exactly like correct isolation. Guard 2 matches the join's
      *predicates*, not its table names, so moving the join text into a view is a change it notices.
      **Owed by 2.1 — the storage half of E.164 is already enforced and the conversion half is not.**
      `0006_` carries a CHECK that a `PHONE` row's value is E.164-shaped, so a badly-formatted number
      is rejected at the database rather than resolving to nobody. That is a backstop and not a
      normaliser: the edge still has to *convert* `052-123-4567` into `+972521234567`, and until it
      does the CHECK turns a silent miss into a loud rejection, which is the trade this slice
      completes.
      **Closed 2026-09-06** ([evidence](evidence/2.3.md)). **This entry's Verify was wrong in the way
      1.9's and 2.1's were** — *"policy case 1 goes green"* happened at **2.2**, with the other six.
      What this slice proves is stronger and is the whole signal: the join moved off the five base
      tables and onto `occupancy`, and **all thirty policy cases stayed green with no file in
      `tests/policy/` edited**. `0008_occupancy_view.sql` carries **no temporal predicate, no status
      filter and no `CURRENT_DATE`** — the view is the shape and the resolver is the rule — because a
      view cannot take `today` as a parameter, because `src/kernel/migrations/` is not `src/scope/`
      and guard two scans it, and because the decision the guard protects is *when* a tenancy counts
      rather than the join's text. **The view very nearly defanged guard two**: written first with
      aliased columns, which left the canonical join matching neither pattern, caught by
      `tests/policy/guards.test.ts` going red because its violating fixture is the real join. The
      dated columns keep the base tables' names. **Probe 1 found a second defect** — the audit line
      was written in a `finally`, so a failed read's `42P01` was replaced by the audit INSERT's
      `25P02` on the poisoned transaction, which would have broken every pending case in weeks 5 and
      6. The line is written after a successful read now. **The audit line records what was reached
      and never what was asked**, because an Israeli mobile number has too little entropy for a hash
      of one to be one-way; the inbound number belongs to the channel module's log at week 9. 297
      tests on every merge, up from 279.

- [ ] **2.4 — The importer.** Idempotent, re-runnable, reports rejects rather than failing whole.
      Natural keys do the work — `address_key` for a building, `(unit_id, start_date)` for a
      tenancy — so a re-run is a no-op instead of a duplicate, with no caller-supplied intent key
      anywhere.
      **Done when:** running it twice changes nothing the second time, and a malformed row is
      reported with its line number instead of aborting the file.
      **Verify:** run, re-run, diff row counts; feed it a deliberately broken file. · **M**
      **Owed by 2.1 — `party` has no natural key, deliberately, and this is the slice that gives it
      one.** 2.1 left it out for the reason 1.9 left `address_key` out and 1.11 vindicated: the
      obvious candidate is `national_id`, and it is the same trap the address was. A ת.ז. is nine
      digits **with leading zeros that every spreadsheet export drops**, so `042…` and `42…` are one
      person and a naive `UNIQUE (national_id)` is a key that disagrees with itself the first time
      the register arrives. It also has to be `(party_kind, national_id)` at minimum — a ת.ז. and a
      ח.פ. are different registries and can be the same nine digits — and it is nullable, which is a
      third decision. Choose it here, against the export, and it costs a migration.
      **Owed by 1.11 — the shape the import report has to have.** `ImportReport` counts from
      `(xmax = 0)` on each upsert's own returned row rather than counting whole tables, because a
      table count is moved by another suite, another environment or a developer's own `npm run seed`.
      Parties and tenancies join it on the same terms; a count that is not about *this* import is not
      a fact about it.
      **Owed by 2.2 — every imported lease has to name a `terms_profile`, and it is NOT NULL.**
      Which maintenance annex governs a lease is what the responsibility decision keys on, so the
      column may not be nullable and quietly absent. `terms_profile` also has **no natural key**: the
      importer needs one to look a profile up idempotently, and choosing it is the same question as
      *how many profiles are in force*, which is week 5's. Decide the key here against the export;
      if the export carries no profile at all, that is a question for the client, raised now rather
      than discovered at week 6 with a matrix that has no input.
      **Owed by 2.3 — normalise every number before inserting it.** `normalisePhone` is on
      `src/scope/`'s contract for this caller. A register formatted for a spreadsheet —
      `052-123-4567`, `+972 52 123 4567` — is rejected row by row by 2.1's `phone_is_e164` CHECK
      otherwise, and a bare nine-digit number is refused rather than assumed Israeli, which is a
      reject with a line number rather than a row that silently becomes a Mexican subscriber.
      **Owed by 2.1 — `is_primary` carries no uniqueness.** "At most one primary contact per party
      per channel" is a plausible rule the workbook does not state; as a partial unique index it
      would fail an import that touches two rows in the wrong order, on a rule nobody asked for.
      Decide it here if the export contains the fact, and leave it out if it does not.

- [ ] **2.5 — Import the real register.** The Priority export into staging: 1,500 units, their
      tenancies and their parties.
      **Done when:** counts reconcile against the export and ten `resolveByPhone` spot-checks return
      the party the export names — including one party on two tenancies and one ended tenancy reading
      as a vacancy.
      **Verify:** the ten spot-checks, listed individually in the evidence file. · **M**
      **Blocked on F3.** See *The declared demo kind and F3* above. **Closes open question 3** in
      [plan.md](plan.md) — how much of month one depends on the ERP.
      **Owed by 2.2 — the overlap constraint will reject rows, and the count is a fact about the
      client's data.** `one_active_tenancy_per_unit` refuses two ACTIVE tenancies overlapping on one
      unit, which a register with sloppy end dates will contain. That is the intended direction — a
      reject with a line number rather than two households in one apartment — but the number of
      rejects is measured and recorded here, not discovered on Wednesday. The same applies to
      `(unit_id, start_date)`: two leases on one unit starting the same day are one lease typed
      twice, and the import will say so.
      **This is the first slice in the project that puts real personal data in a database.** The
      controls that apply are not the tier-2 corpus's: staging's Cloud SQL, not the corpus bucket.
      Confirm before the first row lands that `national_id` is not in any screen's response shape and
      that `/estate` is still fixture-only — **week 5 is where those routes get a session**, and
      nothing may put a real party behind an unauthenticated route before it does (1.11's carry).

- [ ] **2.6 — Browse at portfolio scale.** Buildings list, unit grid, search, and the occupancy
      chip — **derived on every load, never stored**.
      **Done when:** search across 1,500 units returns in under a second and Q5 (leases ending in the
      next 60 days, whole portfolio) is one indexed query.
      **Verify:** timed queries at full row count, recorded as numbers. · **M**
      **Owed by 1.11 — `GET /` stops being a redirect here.** It is a 302 to `/estate` because
      `/estate` was the only screen in the system. This slice is the week a second screen exists, so
      the root becomes an index. One line of routing and one decision about what an index of two
      screens should say.
      **Owed by 1.11 — the token guard runs on every new screen and its v3 pattern is known broken.**
      `tests/ui/tokens.test.ts` misses `padding-left`, `border-left-width` and `text-align: left`;
      the miss is recorded in [../docs/from-v3.md](../docs/from-v3.md) and was fixed at 1.11. Any
      screen added here is asserted by it, and a physical side that slips through is an RTL bug found
      by a Hebrew speaker rather than by CI.
      **Owed by 2.2 — `tenancy` has no index on `end_date`, and Q5 is the query that needs one.**
      Left out deliberately at 2.2 on the same principle as the one below: an index is decided at
      full row count with a timing in front of it. `tenancy_unit` and `tenancy_party (party_id)` do
      exist, the latter because the composite primary key does not serve the isolation join's third
      hop.
      **Owed by 2.3 — the occupancy chip calls `src/scope/`, it does not read the view.** R6's
      `occupancy` view carries no day predicate on purpose, so applying `today` in `src/estate/`
      means writing the predicate there — a second copy, and guard two fires on it.
      `resolvePartiesInUnit` is the call. Q5 is estate's own query and is unaffected.
      **Owed by 2.1 — one index to measure rather than assume.** `party_contact` has no btree on
      `(channel, value)`; the exclusion constraint's **GiST** index covers that lookup and GiST is
      slower than btree at plain equality. It is the first hop of the isolation join and therefore
      the hottest query in the system once the agent is live. A few thousand rows today; the right
      moment to decide is at full row count with a timing in front of it, which is here.

---

**Cut line, in order:** the occupancy chip in 2.6 · search in 2.6 (the grid at full row count is what
proves scale) · the tenth spot-check in 2.5. **Do not cut 2.3** — it is the isolation join's only
home, and every week after this one reads it.

**Say it in the room.** Week 1's demo was a fixture top to bottom and was said to be. If F3 lands,
this is the week that stops being true, and the sentence changes to: the addresses, the unit numbers
and the names on screen are Dona Dom's own, imported through the same path the fixture used, and the
second run of the import changed nothing. If F3 does not land, the sentence does not change and the
week is re-declared — **not** demoed as though it had.
