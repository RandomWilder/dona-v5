# Week 6 · Sun 11 – Thu 15 Oct 2026 — The two core journeys

> **Started 13 Sep 2026**, the day week 5 closed ([evidence/week-5.md](evidence/week-5.md)), rather
> than on the planned 11 Oct. The dates in [roadmap.md](roadmap.md) are never rewritten; the gap
> between them and the evidence files is the measurement of how the project ran. The project enters
> this week roughly three and a half calendar weeks ahead of its plan.
>
> **This week is not the one the roadmap decomposed.** The roadmap's week 6 is `src/policy/` and the
> responsibility matrix. The director paused the rollout on 13 Sep to check the foundation was on its
> way to the flows that matter, and it was not: **there is no way for anybody to create a building**,
> and the upload flow demands a unit before it will accept a document. Both are now this week.
> `src/policy/` and everything behind it are displaced, their unbuilt slices renumbered 6.x → 7.x,
> 7.x → 8.x, 8.x → 9.x and their **week numbers removed** — which week each runs in is the
> director's. See [roadmap.md](roadmap.md) § "What week 6 displaces", where the consequence for
> **M2** is flagged and not decided here.
>
> **Demo kind (Thu): SOFTWARE.** Still no real data. Every lease put through this week is one the
> director invented to look like a real one, which is the point: the flow is proved against paper
> shaped like the real thing while F6 still gates the real thing.
>
> **Week demo (Thu):** an admin creates a building, adds an apartment, and drops an invented lease
> onto a screen that asks for no unit. The system reads the address off the paper, finds the flat,
> pulls out the dates, the names and the ת.ז., and proposes a tenancy. Confirm, and the unit page
> shows it. Then a second lease for the same person in a different flat: **one party, two tenancies.**
> **Freeze:** Wednesday.
>
> **Plan mode is mandatory** for 6.1 (role matrix + two modules), 6.3, 6.4 and 6.5.
>
> **One slice = one session, planning to local click.** The director runs each 6.x slice in its own
> session. ~~Nothing merges to staging until every 6.x slice is closed; then one deploy.~~
> **Corrected at 6.3:** each slice merges to `main` on its own and staging deploys itself off the
> CI result (`deploy.yml`, pipeline §5) — which is what 6.1 and 6.2 already did, so the sentence
> above was describing a batch nobody was running. Staging is current after every closed slice; the
> Thursday demo still runs off it.
>
> One slice = one focused session, half a day or less. **Done when** is the acceptance bar; **Verify**
> is the check that proves it — no self-certification. The standing bar every slice also clears is
> the Definition of Done in [plan.md](plan.md).

**Where a new session starts: 6.1.** Week 5 is closed and merged.
An unbuilt flow is painted in the live shell (`mockups/<flow>.html`, `/dev/mockups/<flow>` on a
`-dev` process) before it is wired; a guard fails if that file and the slice's evidence both exist.

**No slice this week depends on any fuse.** F6 still gates tier 2 and nothing here needs it: the
leases are invented, which is what makes that true.

---

## The one sentence that must survive this week

**Every screen shows a state and a count and never a tenant's name.** Kept at 5.2, 5.4, 5.5, 5.6 and
5.8 — five slices that were each entitled to lift it and each wrote down that they had not.

**This week is the sixth and it is the hardest**, because 6.4 puts a ת.ז. on the capture path and
6.5 shows a household's names on a confirm screen. The ruling this week has to write down, either
way: **a confirm screen showing what the document in the operator's hand says is not the same act as
putting a household on a list.** If that distinction holds, it belongs in `SPEC.md` in 6.6's words. If
it does not, the rule is lifted deliberately and that is recorded too. What is not allowed is the
rule lapsing because a document screen arrived.

---

## Carried in from week 5 — every item, with the slice that closes it

- [ ] **`national_id` never in an agent tool's response shape.** **6.6 now also owns the read
      overlay's word boxes**, where 6.5 found an OPERATOR can read a ת.ז. off the document's own
      rendered line. Was → week 9. **Now 6.4 and 6.6**,
      because this is the week ת.ז. starts existing. `party.national_id.read` gets its first reader
      in 6.4, three weeks earlier than the roadmap assigned it. **6.4's half is done** — the
      permission has a reader, the read path withholds by default and every disclosure writes
      `evidence.read_identifier`. **6.6 still owns the guards**, and now owns one more thing than it
      did: the case names `extracted_field` as well as `party.national_id`.
- [ ] **Staging `staff:add` for a second operator, and the 5.6 clock-end click on staging.** Owed
      since 5.7. **Closes at 6.7**, which is the first slice back on staging.
- [ ] **`config_settings` / secret-name editor, and `DocumentTypeField` on the settings screen.**
      Carried from 5.8. Not this week: 6.4 adds fields through the seed, which is the path A8
      specifies, and a screen for it earns its own slice when a second person needs one.
- [ ] **`work.ts` and its unearned durability claim.** Still after the console walk-through slice.
- [ ] **Walk [fuses.md](fuses.md)** before Thursday's demo. **Ask F1 specifically on 18 Sep.**
- [ ] **F6 — four questions, not three acts.** Settle the signing entity · execute OpenAI's DPA ·
      confirm Google Cloud's and file the record · review and publish the notice. **Blocks tier 2 and
      nothing in this week.** 6.4 makes it sharper, not looser: the extractor will now be asked to
      return an identifier, so the DPA covers a category it did not before.
- [ ] **Answer one question out of the notice draft: how it reaches a tenant.** Owed before week 9.
- [ ] **The three success numbers agreed with the client** — the open M1 box. Director's. Blocks M3.
- [ ] **Director's call: does week 6 displacing `src/policy/` move M2?** Written up in
      [roadmap.md](roadmap.md). Month two is five weeks if it does. Not decided by an agent.
- [ ] **Director's call:** whether the published Data Model's `Document` card is republished.
- [ ] **Staging and prod share one identity configuration**, and **the consent screen stays in
      `Testing`.** Both owned at week 12, beside the prod restart and the F7 organisation move.
- [ ] **The bash guard reads the command that is typed, not what it runs.** Raised at 5.1c, flagged
      rather than fixed. If the director wants the stronger rule it is theirs to say so.
- [ ] **Take delivery of the real document corpus** — after F6.

**Carried in and already owned elsewhere:** the emergency bypass, redaction at the provider boundary
(**rewritten by 6.4's ADR-0006 — re-read it before building it**), `run.admin` per service and the
docs-bucket delete binding, the Node-20 action bumps, `tenant_visible`, prod PITR and the
`party_contact` btree. All in [roadmap.md](roadmap.md) under the weeks that hold them.

---

## Slices

- [x] **6.1 — `estate.write`, and an admin creates a building.** Closed 13 Sep — [evidence/6.1.md](evidence/6.1.md).
      Flow **A11**, written into `SPEC-flows.md` before the code — that file's own rule is that a
      slice serving no flow gets cut on sight, and there has never been a flow for setting up an
      estate. `estate.write` joins `PERMISSIONS` in `src/staff/internal/roles.ts` and goes to
      **ADMIN only**: an operator files paper, an admin shapes the estate. `GET
      /estate/buildings/new` + `POST /estate/buildings`, stance `{ staff: 'estate.write' }`, body
      through `src/kernel/ui/forms.ts`. **`csrf: 'in-body'` struck at 6.1, before the code was
      written**: in this repository that flag is not *the token rides in the body*, it is an
      **exemption** from the composition root's CSRF `preHandler`, held by `POST /documents` alone
      because a multipart stream cannot be read there without consuming it. `src/guard.test.ts`
      asserts the exempt list is exactly that one route so the exemption cannot spread, and a
      urlencoded body is verified by the hook already. **The `GET` carries `estate.write` too** — a
      form an operator may render and may not post is a door that answers `not_allowed` after they
      have typed an address into it. **The write is `importEstate`** with one
      `BuildingPlan`, zero spaces, zero units and an optional `ProjectPlan` —
      `validateBuildingSpaces` already accepts that shape. **No new estate command.**
      **Done when:** an ADMIN creates a building from the screen and it appears on `/estate`; an
      OPERATOR posting the same form is refused with `not_allowed` and nothing more; the same address
      posted twice leaves one row, because `building.address_key` says so.
      **Verify:** the OPERATOR refusal written **red first**; the screen appended to
      `tests/ui/tokens.test.ts`'s `SCREENS` registry, never a second copy of the guard; restart
      `npm run dev` and click it on `:3000`.
      **Mockup first:** `mockups/building-new.html` at `/dev/mockups/building-new`.
      **Plan mode. Deps:** 5.8 · **M**
      **Raised and closed inside 6.1:** `/dev/mockups/:flow` named two flows in a condition and
      rendered two TypeScript paints whose slices had already closed, so guard four sat idle over an
      empty `mockups/` and could never have seen them. The route reads the file now
      (`src/dev-mockups.ts`), both TS paints are deleted, and the one live guard riding on the a9
      paint — no `asset_type` and no role matrix on the settings screen — moved onto the wired
      screens in the registry.

- [x] **6.2 — An apartment, its spaces, and the bays it implies.** Closed 13 Sep — [evidence/6.2.md](evidence/6.2.md).
      Flow **A13**, written into `SPEC-flows.md` before the code. **Not A12:** that number is 6.3's
      in this file and in `roadmap.md`, and A11's prose calling it "A12's apartment screen" was the
      stale half — corrected there rather than here.
      `GET /estate/buildings/:buildingId/units/new` + `POST`, same stance, reusing **`upsertUnitRow`**
      — the register's own per-row primitive, already idempotent on `space_natural_key` and R2's
      shared key. Parking and storage follow 4.6's convention (`חניה {unit}` / `מחסן {unit}`), so a
      handover protocol has a space to land on later. **Bulk stays `npm run import:register`**; no
      second bulk path is built.
      **Done when:** an apartment added from the screen appears on the building page with its space
      count and its occupancy chip; the same `unit_number` posted twice updates rather than
      duplicates.
      **Verify:** re-post and diff row counts; `:3000` click through building → new apartment →
      building.
      **Mockup first:** `mockups/unit-new.html` — **waived by the director on 13 Sep**, on the plan
      as written. Never painted, so guard four stayed idle.
      **Deps:** 6.1 · **M**
      **Raised and closed inside 6.2:** the `UNIT` space is named by the **bare `unit_number`**, the
      way `src/register/internal/importer.ts` names it, or a screen and an import would write two
      apartments behind one door. The building handed to `upsertUnitRow` is **rebuilt from its own
      row**, because `DO UPDATE` sets `project_id` from it and a form-shaped building would unlink
      the project while adding a flat — proved red. The POST opens its own transaction.
      **Raised → 6.3:** `inTransaction` is now written twice (`src/evidence/internal/promote.ts` and
      inline in estate's routes) — **a third writer moves it to `src/kernel/`**; and `.check` joins
      `.form-grid` / `.form-row` / `.hint` / `.form-actions` in the two-module state, so **a third
      occurrence of either moves to `tokens.css`**.

- [ ] **6.3 — The document-first upload screen.**
      Flow **A12**; A1 is amended rather than replaced. `GET /documents/new` **with no `unit`**
      becomes the dedicated screen: choose the type, attach the file. **The unit-first entry from a
      building page stays** — the place is already known there and the shortcut costs nothing.
      `POST /documents/intake` reads the bytes in memory under the existing `LIMITS`, runs
      `documentText` over pdf + OCR, and runs a **deterministic place reader** — the analogue of
      `src/evidence/internal/protocol.ts`'s, which already pulls an apartment number out of text with
      no model. Resolution is `building.address_key` exact first, then `searchEstate`-shaped
      candidates. **Exactly one candidate** → the existing `fileDocument` runs against that place,
      unchanged, and the chain continues into A1/A2 as it does today. **Zero or several** → the form
      comes back with the candidates listed and the file input re-armed, **no row and no object**,
      422 — 3.3's refusal shape reused.
      **The structural call, recorded rather than discovered:** no staging store and no `UNFILED`
      place kind. `PlaceKind` stays four values and the object path keeps naming a real place (3.2).
      A6 settled the principle — nothing is held between propose and confirm.
      **Done when:** a lease naming רקפת 12, דירה 12A files against that unit with no unit chosen by
      hand; a lease naming an address not in the system writes no row and no object and offers a
      search.
      **Verify:** both paths on `:3000`; the "writes nothing" half proved by row counts and a bucket
      listing, the way 3.3 proved its refusal.
      **Carried in from 6.2, and this slice writes, so both land here:** `inTransaction` exists twice
      (`src/evidence/internal/promote.ts`, inline in `src/estate/internal/routes.ts`) — **a third
      writer moves it to `src/kernel/`**; `.check` and the four form classes are each in two files —
      **a third occurrence moves them to `tokens.css`**. **A12 is this slice's number**, confirmed
      at 6.2 against A11's stale sentence.
      **Mockup first:** `mockups/document-intake.html` — painted, clicked and commented on by the
      director on 13 Sep, who ruled on the question it was painted to ask (below). Deleted when
      `tasks/evidence/6.3.md` was written, as guard four requires.
      **Plan mode. Deps:** 6.2 · **L**
      **Raised and closed inside 6.3:**
      • **The director's ruling on what a document attaches to.** The paint read as though the flat
      were the destination. It is the **anchor**: the object path names a place (`PlaceKind`, four
      values) and the meaning is `document_link`, which already carries `TENANCY`. A lease creates
      the tenancy it then supports, at A2's confirm screen — so a tenancy cannot be chosen at the
      door, and `tenancyId` stays null on this path. The screen says so above the button now.
      • **The 6.2 carry, discharged and worse than recorded:** `inTransaction` existed **three**
      times, not twice (`promote.ts`, `lease.ts` byte-identical, inline in estate's routes). The rule
      had already tripped → `src/kernel/db.ts`, all three call sites rewired, four kernel cases.
      • **A candidate list cut at twelve**, found by clicking: `רקפת 12, דירה 999` matched a building
      and no flat in it, and the screen came back with **72** radio buttons. `CANDIDATE_LIMIT`, the
      real count printed beside the list, `SEARCH_LIMIT`'s own sentence.
      • **Test residue in the developer's own database**, found the same way: a case in
      `src/evidence/routes.test.ts` reads its hash back with `rows[0]` and no `ORDER BY`, so once one
      run leaks a document every later run leaks another. The suite now deletes everything in its own
      bucket on the way out, which is exact and self-healing.
      **Raised → 6.4:** a scanned lease pays for OCR **twice** — once in intake for the reader, once
      inside `fileDocument` when the verdict is `unverified` — because 6.3 promised not to touch
      `fileDocument`. The fix is **pass the pre-read pages into the intake request**, not a wider
      `fileDocument`. The CSS half of the 6.2 carry has **not** tripped: `.check` and the four form
      classes are still two files each — **a third occurrence moves them to `tokens.css`**.

- [x] **6.4 — ת.ז. on the capture path — the spec edit, then the field.** Closed 13 Sep — [evidence/6.4.md](evidence/6.4.md).
      **The spec edit is proposed and merged before the code edit.** Four documents move: `SPEC.md`'s
      security defaults (ת.ז. stays admin-only, unreachable by any agent tool and access-logged —
      what changes is that it now *exists* as an `ExtractedField` row, and what holds the line
      instead is `party.national_id.read`, the isolation join that never exposed the column, and
      6.6's two guards); **`docs/decisions/ADR-0006-the-extractor-may-read-a-declared-identifier.md`**,
      amending **ADR-0004 decision 2** so masking applies to the embedder and to any model call whose
      output can reach a tenant, with a *declared* field on a governed catalogue as the named
      exception; `SPEC-evidence.md`; and `SPEC-flows.md` A2.
      **Without ADR-0006, slice 9.1 masks the value this slice exists to capture**, and 9.1 is
      hard-bounded by week 10. *(Corrected at 6.4: this entry said 8.1 twice. The displacement at the
      top of this file renumbered redaction 8.1 → 9.1 and `roadmap.md` already says 9.1; 8.1 is now
      ServiceCall. The number, not the sentence, was the stale half.)*
      Then the code: `tenant_id_number` and `guarantor_id_number` join the `lease` type in
      `src/evidence/fixtures/document-types.ts` as **seed rows, not a migration** — A8's open half
      used for real for the third time. **No `field_promotion` target for either**: the value reaches
      `party.national_id` through 6.5's confirm step, which is a human act and not a promotion.
      **Done when:** lease extraction returns a ת.ז. for each named person, and zero is still a
      correct result; an OPERATOR sees the value nowhere; every read of it writes an `audit_log` line.
      **Verify:** the OPERATOR refusal red first; the audit line asserted by count, not by eyeball.
      **Plan mode. Deps:** 6.3 · **M**
      **Carried in from 6.3, and discharged:** the scan is OCR'd **once** now —
      `IntakeRequest.readPages` hands `fileDocument` the pages the intake route already read off the
      same bytes, proved by a call-counting spy (`ocrCalls === 1`). The CSS carry rides on unchanged:
      `.check` plus `.form-grid` / `.form-row` / `.hint` / `.form-actions` are two files each, and
      **a third occurrence of either moves them to `tokens.css`**.
      **Raised and closed inside 6.4:**
      • **`main` was red for weather at the start of the session.** `src/evidence/routes.test.ts`
      asserted `doesNotMatch(body, /503/)` against a page that prints a freshly generated document
      id — week 5's `/05\d/` defect again, in a suite that had merged green. The status code already
      proves the request was not a 503; the body assertion is `/unavailable/` now, which is a word no
      identifier can be.
      • **`docs/decisions/README.md` listed ADR-0004 as `proposed`**, which its own body stopped being
      on 6 Sep. Corrected with the reason, in the spec half.
      • **The declaration's version window is live, not decorative.** The new suite clocked at the
      file's 7 Sep read a catalogue that declares these fields from the 13th and extracted nothing,
      which is R18 working and cost one run to see.
      **Raised → 6.5, 6.6 and 6.7:**
      • **6.5** — the identifier is **not** in `proposeLeaseTenancy`'s screen shape, so A2's confirm
      page cannot leak one. 6.5 opens it server-side for its identifier-overlap ranking, with its own
      audit line.
      • **6.6** — `extracted_field` is a second home for an identifier, so the policy case names the
      **table** and not only `party.national_id`; and `tests/ui/tokens.test.ts` now has a second
      deliberate exception, `documents · read overlay, may read identifiers`, which 6.6's
      identifier-run assertion must name beside the lease confirm screen.
      • **6.7** — **`npm run seed:doctypes` must run against staging** before the demo, or the lease
      type there declares no identifier and the walk shows nothing.

- [x] **6.5 — Which tenancy is this? Propose, confirm, write.** Closed 14 Sep — [evidence/6.5.md](evidence/6.5.md).
      `proposeLeaseTenancy` grows a resolution over `listUnitTenancies` — candidates ranked by
      identifier overlap first, then date overlap. It proposes *attach to this letting* or *create a
      new draft*, and **a human confirms**; invariant 5 is unchanged. `confirmLeaseTenancy` gains the
      **attach** branch, which it has never had — today it creates or no-ops. `upsertParty` (keyed on
      `national_id_key`) replaces `createParty` wherever an identifier was captured; `createParty`
      stays for the lease that names none, which is the case its comment was written for.
      **`SPEC-flows.md` A2 step 5 is amended, not reversed.** Matching a **name** across tenancies
      stays forbidden — 5.5 measured 303 identified people sharing a full name, which is the number
      that says why. Matching an **identifier** is the governed path, and is the reason the rule was
      written about names in the first place.
      **Done when:** two leases for the same ת.ז. in two flats produce **one** party and two
      tenancies; a second lease on the same unit and dates offers the existing letting rather than a
      second one; a lease naming no identifier still writes a party and a draft.
      **Verify:** all three cases on `:3000` with invented leases; party count asserted before and
      after.
      **Plan mode. Deps:** 6.4 · **L**
      **Raised and closed inside 6.5:**
      • **The lease confirm button answered 403 in a browser, and had since 5.2.** Two text-only
      forms posted `multipart/form-data` — the lease confirm (4.6) and the promote button (4.3) —
      and 5.2's CSRF `preHandler` reads `request.body`, which a multipart body leaves undefined. The
      suite never saw it because it calls those handlers rather than posting to them. Fixed by
      dropping the `enctype`, not by a third `csrf: 'in-body'` exemption: those bodies were never
      streams. **The guard is the class and lives on the registry** — a form declares that enctype
      only when it contains a file input.
      • **121 orphan `terms_profile` rows** in the developer database, one per run of one
      `routes.test.ts` case since 4.7, found because the annex select box was 125 options deep. 6.3's
      leak in a second table; the case cleans up after itself now.
      • **A UUIDv7's first eight characters are a timestamp, not randomness** — `id.slice(0, 8)` as a
      uniqueness token collided on `building_address_unique`. Twelve test files use the random tail.
      A hard-coded ת.ז. in a fixture fails on somebody else's row for the same reason; derived now.
      • **Date overlap is computed in TypeScript, never SQL** — the predicate that expresses it is
      guard two's, and writing it out *in a comment* turned the guard red on the first run.
      **Raised → 6.6:**
      • **An OPERATOR can read a ת.ז. off the read overlay's word boxes.** The captured-row gate
      works exactly as 6.4 claims — admin **1** hit, operator **0** — but the page-image overlay
      renders the document's own line in a `title` attribute and there both stances score **1**.
      6.4's "withheld from every read path" does not cover the document's own text. **6.6 rules:
      withhold the overlay below `party.national_id.read`, or lift the rule deliberately and say so.**
      • **The exception list is one entry, not two.** `LeaseProposal` has no field for an identifier,
      so the lease confirm screen cannot leak one and `documents · read overlay, may read
      identifiers` stays the only deliberate exception — correcting what 6.4's carry predicted.
      **Raised → the director:** the walk's local residue is still in the developer database.
      `extracted_field`'s promotion guard refuses both the delete and the unstamp (4.3, working), and
      disabling a trigger to get past it is not an agent's call.

- [ ] **6.6 — The guards, and the number that says ת.ז. did not leak.**
      **Policy case, red first:** no identifier-shaped run in the response shape of anything
      `src/scope/` serves, and none in the copy sent to the embedder. `tests/policy/` is the gate and
      not an eval — SPEC.md's "never test a deterministic constraint through the agent".
      `tests/ui/tokens.test.ts` gains an identifier-shaped-run assertion across `SCREENS`, beside the
      phone and `+972` assertions it already carries, with **`documents · read overlay, may read
      identifiers` as the one deliberate exception** — corrected at 6.5, which expected to add the
      lease confirm screen beside it and did not need to: the identifier is not in
      `LeaseProposal`, so that screen carries a boolean and a count and no value. **Assert it over the
      registry and never over a live response** — week 5 closed on exactly that mistake, where a
      duplicated `/05\d/` read the CSRF token's own hex and failed 4 runs in 20.
      **The never-a-name rule is reconsidered a sixth time and written down either way.**
      **Carried in from 6.5, and it is this slice's largest item:** **an OPERATOR can read a ת.ז. off
      the read overlay's word boxes.** The captured-row gate does what 6.4 claims — admin 1 hit,
      operator 0 — but the page-image overlay puts the document's own printed line in a `title`
      attribute, and there both stances score 1. Rule either way: withhold the overlay below
      `party.national_id.read`, or lift it deliberately and record why. **A registry assertion will
      not catch this one** — the overlay's words come from the document, not from a fixture — so it
      needs its own case over a rendered page with known words, which is the exception week 5's
      lesson allows when the value under test is one the test itself put there.
      **Done when:** both guards fail against a deliberate violation and pass after, and the overlay
      question is answered in writing.
      **Deps:** 6.5 · **M**

- [ ] **6.7 — The journey, end to end, on staging.**
      The demo slice, and the first time this week's work leaves localhost. Create a building → add an
      apartment → upload an invented lease from the document screen → the system finds the unit,
      extracts the fields and the ת.ז., proposes a new tenancy → confirm the roles → the unit page
      shows the letting and its change log. Then a **second** invented lease for the same person in a
      different flat: one party, two tenancies, and the console says so.
      **Carried in from 5.7:** the staging `staff:add` and the 5.6 clock-end click happen here.
      **Carried in from 6.4:** **`npm run seed:doctypes` runs against staging first.** The two
      identifier fields are seed rows in no workflow, so staging's `lease` type declares no ת.ז.
      until somebody runs it, and the second half of the demo — one party, two tenancies — reads as
      broken rather than as unseeded.
      **Done when:** the whole walk is done by clicking, with no seed and no SQL.
      **Verify:** live on staging, both halves in one sitting.
      **Deps:** 6.6 · **M**

---

## Week-6 cut line

If the week runs hot, cut in this order: **6.2**'s implied parking and storage bays (an apartment
without them is still an apartment, and 4.6's convention can be applied later by the importer); then
the `guarantor_id_number` half of **6.4**, because a guarantor is frequently absent from the lease
anyway and A2 step 3 already says zero of them is a correct result.

**Do not cut 6.4's spec edit, 6.6, or 6.7.** The first is what makes the rest lawful to build, the
second is the only thing standing between a captured ת.ז. and a screen, and the third is the only
slice that proves any of it outside localhost.
