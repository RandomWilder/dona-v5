# Week 2 · Sun 13 – Thu 17 Sep 2026 — All 1,500 units, from the register

> **Demo kind, declared Sunday 6 Sep: REAL DATA. Re-declared Sunday 6 Sep: SOFTWARE.** The line
> below said it was the one promise in this file that was not ours to keep, and it was re-declared in
> advance rather than missed on Thursday, which is the whole distinction
> ([rollout-cadence.html](../docs/rollout-cadence.html)). The cause is not that F3 stayed unlit; it is
> that the project adopted a method in which the real register belongs to a later step —
> **concept → example documents → schema review → real documents preparing for pilot**
> ([SPEC-flows.md](../SPEC-flows.md), [pipeline.md](../docs/pipeline.md) §1.5). The register is step 4.
> **2.5 moves there with it, and F3 leaves month one's critical path.**
>
> **Week demo (Thu):** the same URL as week 1, now with every building across Shoham, Beit Shemesh,
> Ashdod, Lod and Ashkelon — units, tenancies, parties, searchable — at **1,500-unit volume from a
> generated register**, with the query timings that volume exists to produce.
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

**Amended 6 Sep 2026: five slices. 2.5 leaves the week** and the chain becomes
2.1 → 2.2 → 2.3 → 2.4 → 2.6. See the re-declaration above and *The declared demo kind and F3* below,
which is kept rather than deleted because the reasoning it records is what produced the amendment.

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

- [x] **Confirm F3 by Tuesday, or re-declare the week.** The director's, and the only item in this
      file that is. **Answered 6 Sep 2026: the week is re-declared SOFTWARE, and F3 is not confirmed
      because it is no longer needed this month.** The method adopted the same day puts the real
      register at step 4, so F3 stops gating week 2 and becomes a pilot-preparation dependency. The
      table above is now read as a record of why, not as a live constraint: **2.5 moves out of the
      week; 2.6 stays and takes its 1,500 units from a generated register.** Volume is what 2.6's two
      index decisions need, and volume is not the same fact as realness — deferring the index
      measurement to the pilot would push it to month two on no reasoning at all.

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

- [x] **2.4 — The importer.** Idempotent, re-runnable, reports rejects rather than failing whole.
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
      **Closed 2026-09-06** ([evidence](evidence/2.4.md)). `0009_import_natural_keys.sql` — three
      keys, and the argued one is `party.national_id_key`: a **generated column**, `address_key`'s
      technique applied to the identifier, left-padding an all-digit ת.ז. to nine so the leading zero
      a spreadsheet drops cannot make one person two, prefixed by `party_kind` because a ת.ז. and a
      ח.פ. are different registries, and null when the identifier is. **The file format requires an
      identifier where the schema does not** — no identifier, no idempotence — which is a question
      put to the client rather than an assumption made about them. `terms_profile` is keyed by
      `UNIQUE (name)` and a blank one is a reject, never a row defaulted to `standard`.
      `party_contact` gets `UNIQUE (party_id, channel, value, valid_from)` because `ON CONFLICT`
      needs an arbiter and an `EXCLUDE` constraint cannot be one; `is_primary` gets nothing, which
      confirms 2.1 rather than revisiting it.
      **The register is a flat CSV, one row per party-on-a-tenancy**, parsed by a written parser
      whose one hard property is that a quoted field carrying newlines moves the **line counter** and
      not just the record index. `src/register/` is a new module — it calls `normalisePhone`, so an
      importer inside parties or tenancy would have been the cycle `tenancy → scope → tenancy` — and
      it **writes no SQL against a table it does not own**: `src/parties/contract.ts` and
      `src/tenancy/contract.ts` exist from here, with the callers 2.1 and 2.2 both predicted.
      **A SAVEPOINT per row, and it was proved load-bearing by removing it**: the first
      database rejection then poisoned the transaction, three later rows failed `25P02` — one of them
      a good row — and every constraint name in the report became "rejected by the database", which
      is the count 2.5 needs. **Three probes found three things review would not have.** The
      `ON CONFLICT` arbiter check runs before any index insertion, so the unique key resolves a
      re-run and the exclusion constraint is never reached — measured, not reasoned about. The
      recycled-number case asserted the wrong thing and the database said so: an `ENDED` tenancy
      resolves to **nobody**, which is the property. And the fixture reusing `+972521234567` from
      another suite turned thirteen tests across five files into `40P01 deadlock detected` — parallel
      files, one database, and a speculative insertion each side waits on. **Guard three did not fire
      and should have**: `national_id_key` was not on its list, which is the list's second miss after
      `party_contact.value` at 2.1, and the rule stayed the rule — the list learned the name, and the
      guard then fired on line 41 when the marker was removed on purpose. `src/kernel/boundary.test.ts`
      now proves the boundary AGENTS.md has claimed since week 1 and nothing enforced — no module
      reaches another's `internal/` — and it was proved red on a real violation. 326 tests on every
      merge, up from 297.

- [~] **2.5 — Import the real register. MOVED OUT OF WEEK 2 on 6 Sep 2026**, to the
      pilot-preparation step of the method ([SPEC-flows.md](../SPEC-flows.md)). Not cut, not blocked
      — **rescheduled to where the method puts it**, which is step 4, after the concept is proved and
      the schema reviewed. Its dependency F3 travels with it and leaves month one's critical path.
      Everything below stays true of the slice and is what it will be re-opened against; the only
      thing that changed is when it runs. **2.6 no longer depends on it** and takes its volume from a
      generated register instead. The Priority export into staging: 1,500 units, their
      tenancies and their parties.
      **Done when:** counts reconcile against the export and ten `resolveByPhone` spot-checks return
      the party the export names — including one party on two tenancies and one ended tenancy reading
      as a vacancy.
      **Verify:** the ten spot-checks, listed individually in the evidence file. · **M**
      **Blocked on F3.** See *The declared demo kind and F3* above. **Closes open question 3** in
      [plan.md](plan.md) — how much of month one depends on the ERP.
      **Owed by 2.6 — a register cannot express a vacant unit, and the export may contain some.**
      The file is one row per party on a tenancy, so an apartment with no lease has no row and does
      not reach the database. The generated register shows vacancies through ended and draft
      tenancies, which is what a real register does too — but if the Priority export carries empty
      apartments, that is a format question answered here, with the export in hand, rather than a
      set of units silently missing from the portfolio.
      **Owed by 2.2 — the overlap constraint will reject rows, and the count is a fact about the
      client's data.** `one_active_tenancy_per_unit` refuses two ACTIVE tenancies overlapping on one
      unit, which a register with sloppy end dates will contain. That is the intended direction — a
      reject with a line number rather than two households in one apartment — but the number of
      rejects is measured and recorded here, not discovered on Wednesday. The same applies to
      `(unit_id, start_date)`: two leases on one unit starting the same day are one lease typed
      twice, and the import will say so.
      **Owed by 2.4 — two facts about the export that the file format now demands, and one it
      cannot demand.** 2.4's register format **requires `national_id` on every row and a
      `terms_profile` name on every lease**, and rejects a row carrying neither with its line
      number. Both were decided against a designed file because the real one moved to step 4, and
      both are questions for the client: **confirm the Priority export carries a ת.ז./ח.פ. on every
      party and an annex name on every lease before the first row is imported.** If it carries no
      identifier, 2.4's `national_id_key` is reopened here with the export in hand rather than having
      been guessed at — a surrogate built from a name and a phone would be a key that disagrees with
      itself in the other direction. If it names no annex, that is week 6's responsibility matrix
      arriving with no input, and the question is asked now.
      **Owed by 2.4 — the reject count is already a mechanism, and it is what this slice reads.**
      Each rejected row carries its line, its SQLSTATE and the constraint that refused it, so "how
      many rows the register loses to `one_active_tenancy_per_unit`" is a number the importer prints
      rather than a thing to be discovered. Run `npm run import:register -- <file>` and record it.
      **This is the first slice in the project that puts real personal data in a database.** The
      controls that apply are not the tier-2 corpus's: staging's Cloud SQL, not the corpus bucket.
      Confirm before the first row lands that `national_id` is not in any screen's response shape and
      that `/estate` is still fixture-only — **week 5 is where those routes get a session**, and
      nothing may put a real party behind an unauthenticated route before it does (1.11's carry).

- [x] **2.6 — Browse at portfolio scale.** Buildings list, unit grid, search, and the occupancy
      chip — **derived on every load, never stored**.
      **Done when:** search across 1,500 units returns in under a second and Q5 (leases ending in the
      next 60 days, whole portfolio) is one indexed query.
      **Verify:** timed queries at full row count, recorded as numbers. · **M**
      **Deps changed 6 Sep 2026: 2.4, not 2.5.** The 1,500 units come from a **generated register** —
      a fixture file at portfolio volume, produced by the same template the data request to Dona Dom
      is derived from and loaded through 2.4's importer, so the path under measurement is the real
      one. **Volume and realness are different facts, and only volume is what an index decision
      needs.** Both index questions below are answered by row count and distribution; neither is
      answered by the names being Dona Dom's. Deferring them to the pilot would have pushed two real
      decisions into month two for no reason the measurement supports. What the generated register
      cannot tell us is how many rows the overlap constraint rejects — that is a fact about the
      client's data and it stays with 2.5.
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
      **Owed by 2.4 — the generated register is loaded through `npm run import:register`, and the
      importer's own cost is one of the things this slice measures.** A `SAVEPOINT` per row costs a
      round trip per row, which is what makes a rejected row a reject instead of a failed file; at
      nine rows it is invisible and at 1,500 it is a number. **Time the import and record it.**
      Whether to batch — a savepoint per N rows, trading a coarser reject boundary for throughput —
      is this slice's decision if the number says so, taken with a timing in front of it and not
      before, which is the same rule both index questions below are held to.
      **Owed by 2.4 — the register fixture is the template the generated one is produced from.**
      `src/register/fixtures/register.csv` is nine rows carrying every case that breaks an importer;
      the 1,500-unit file is the same twenty-two columns at volume, and it must keep the coverage
      rather than being fifteen hundred copies of one household. Distinct phone blocks and identifier
      blocks are not tidiness — 2.4 learned that the hard way with `40P01`.
      **Owed by 2.1 — one index to measure rather than assume.** `party_contact` has no btree on
      `(channel, value)`; the exclusion constraint's **GiST** index covers that lookup and GiST is
      slower than btree at plain equality. It is the first hop of the isolation join and therefore
      the hottest query in the system once the agent is live. A few thousand rows today; the right
      moment to decide is at full row count with a timing in front of it, which is here.
      **Closed 2026-09-06** ([evidence](evidence/2.6.md)). **Both index questions were answered and
      they went opposite ways**, which is what deciding with a timing in front of you looks like.
      `0010_scale_indexes.sql` adds `tenancy (end_date) WHERE status = 'ACTIVE'` — the scan reads
      every tenancy the company has ever signed and the index reads two pages — and **does not** add
      the btree on `party_contact (channel, value)`: it is three times faster than the exclusion
      constraint's GiST index in isolation, and **with both present the planner chose GiST every
      time**, so it would be a write cost with a comment. That reopens at week 12, in
      [roadmap.md](roadmap.md), and the fix then is not the btree.
      **Search is 2.35 ms against a bar of one second** at 1,500 units, and Q5 is one indexed query.
      The 1,500 units come from a **generated register** — 37 buildings, 2,908 rows, zero rejects —
      loaded through `npm run import:register` in **6.5 s, and 6.0 s the second time creating
      nothing**, which answers `SPEC-register.md`'s batching question in favour of keeping the
      savepoint per row.
      **The occupancy chip did not call `resolvePartiesInUnit`, and this entry was wrong to say it
      would.** One call per card is 29.68 ms and sixty audit rows for a sixty-unit page, against
      0.94 ms and one for `resolveOccupiedUnits` — and the audit line is the bigger half: a log in
      which one browse looks like sixty lookups is worse than useless in the review it is kept for.
      **No name and no number reaches any of the five screens**, asserted from outside in
      `tests/ui/tokens.test.ts` rather than left to the views to remember.
      **The required gate had a latent `40P01` in it and this slice made it fire** — one run in
      three, always in `tests/policy/`, because three suites had been seeding `+972521234567` since
      week 2 and two policy files another number. 2.4 diagnosed this exact deadlock and blocked its
      *register fixtures*; nobody applied the rule to the suites. Each suite owns a block now, and
      the suite ran clean six times consecutively. A flake in a required gate is worse than a red
      one: it teaches people to re-run.
      **Volume found three more things review would not have.** A generated register in the development
      database turned three suites red on `terms_profile_natural_key` — 2.4 namespaced its cities,
      its phone block and its identifiers and then named its maintenance annexes what a real register
      will name them, which is the third time this repository has met this lesson and the first on a
      global key nobody had thought of. The scope suite's own fixture could only ever seed one
      household. And the generator wrote a second contact for two parties, which the import's own
      count reported before any test did.
      **Carried:** a register-created building's handover date is a lease's date and is now visible
      on a card — owned by **3.5**, which brings the real fact; the btree, at **week 12**; the root
      index moving to the composition root at **week 5**; and whether the client's export can express
      a vacant unit, at **2.5**.

---

**Cut line, in order:** the occupancy chip in 2.6 · search in 2.6 (the grid at full row count is what
proves scale). ~~the tenth spot-check in 2.5~~ — 2.5 left the week, so the cut line is two items
shorter and the week has correspondingly less slack. **Do not cut 2.3** — it is the isolation join's
only home, and every week after this one reads it.

**Nothing was cut.** Both items on the line — the occupancy chip and search — shipped, and the chip
shipped in a different shape than this file specified, for a reason the measurement gave.

**Say it in the room.** Week 1's demo was a fixture top to bottom and was said to be. If F3 lands,
this is the week that stops being true, and the sentence changes to: the addresses, the unit numbers
and the names on screen are Dona Dom's own, imported through the same path the fixture used, and the
second run of the import changed nothing. If F3 does not land, the sentence does not change and the
week is re-declared — **not** demoed as though it had.

**Amended 6 Sep 2026, and this is the sentence for Thursday.** The week was re-declared SOFTWARE in
advance, so the honest line is the one that was true all along, said plainly: *every address, every
unit number and every name on this screen is ours and invented, and the file they came from is the
template the data request to you is derived from. What is real is the path — 1,500 units through the
importer in six and a half seconds, and the second run changed nothing — and the timings, which are
what this volume exists to produce.*
