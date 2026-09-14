# The new track — UI-first, from the document intake

> **Opened 14 Sep 2026, the day week 6 closed.** The plan that was going to run next is archived:
> [archive/displaced-slices.md](archive/displaced-slices.md), seventeen unbuilt slices, 7.1–9.5.
> Not deleted, and the debts inside it are still debts — they are named at that file's head and in
> the carried list below. **The slice sequence restarts at 7.1**, which is a different 7.1.
>
> **Why the plan stopped.** Week 6's demo found four defects that eleven green slices and a full CI
> gate had not. The director's reading: the weak link is not the engineering, it is the flow
> descriptions the engineering is built from — written in week 1, before the vision they encode had
> settled. So the flows get rebuilt one screen at a time, starting where the data enters, because
> everything downstream is a function of what lands in `extracted_field`.
>
> **No week number, on purpose.** [roadmap.md](roadmap.md)'s calendar and month tables are untouched,
> as they always are. What the remaining weeks *mean* has not changed; which slices deliver them has.
>
> **The pipeline does not change.** Plan mode, both gates, mockup-before-wiring, the carry rule, one
> slice per session, `deploy.yml` off the CI result. That is the part that is working and it is not
> what is being rethought. The one standing change: **mockup-first is the default here, not the
> exception** — every slice in this track paints before it wires.

## The paint, reviewed — 14 Sep 2026

`mockups/document-intake.html` was reviewed and accepted. The director declined the click-on-`:3000`
step ("the idea is clear; the mockup gets the flow across") and raised **one functional comment**,
on step 3.

> The phrases searched for are `המושכר או הדירה` and `תקופת השכירות`. Add, or even replace these two
> with, `הסכם שכירות` — normally what a lease has in its title.

**`הסכם שכירות` is already declared, and has been since 6.8.** `src/evidence/fixtures/document-types.ts`:
`['חוזה שכירות|הסכם שכירות', 'המושכר|הדירה', 'תקופת השכירות']`, where `|` separates the spellings of
**one** requirement and every requirement must still be met.

**The comment nevertheless found a real defect, in the screen rather than the declaration.**
`refusal()` in `src/evidence/internal/views.ts` prints `verification.missingTerms` and nothing else.
The title requirement was *found*, so it never appeared — and a refusal that shows only its failures
cannot be audited by the person reading it. Three requirements were checked and the screen named two.
Fixed in 7.1 below.

**On replacing the two body terms with the title alone — not taken here, and measured instead.**
`תקופת השכירות` is what separates a lease from an ארנונה bill, an insurance certificate or a handover
protocol, and `tests/policy/document-verification.test.ts` exists to refuse every specimen in every
slot that is not its own — a title-only rule is the any-term rule that case was written to prevent
(6.8's own argument, third paragraph). The sharper reason is a gap rather than an opinion:
`lease_amendment` is titled `נספח לחוזה שכירות` and **the corpus has no specimen for it**
(`NO_SPECIMEN_YET`), so the change cannot be measured against the one type most likely to collide.
7.1 writes that specimen and runs the comparison; if nothing cross-verifies, the replacement is
adopted on evidence in the same slice. Separately: **the terms are already editable without a deploy**
at `/settings` (5.8, one requirement per line, `|` for spellings), so any wording can be tried today —
a wording worth keeping also goes into the seed, which is what a re-seed reads.

**How the paint's seven rulings landed.**

| # | The question | Ruled |
|---|---|---|
| 1 | Schema editable at runtime | Yes — **7.2**. No migration: `document_type_field` and `upsertDocumentTypeField` already carry it |
| 2 | The boundary | Held. `verificationTerms` stay code + policy matrix; extraction fields open. Refusal deterministic, extraction configurable |
| 3 | `city`, `rent_amount`, `security_deposit` | **Deferred to the director.** No money field and no `MONEY` value type, twice on purpose. 7.2 adds a guard so the editor cannot create one by the back door |
| 4 | Approve, to where | **Split the verb.** Approve is a stamp on `extracted_field` (**7.3**); promote stays the copy onto a typed column and its `CHECK` widens in **7.4**, target by target |
| 5 | Read value vs approved value | Two columns. `value` is never overwritten — the delta *is* the dataset. Threshold 80% unless the director says otherwise |
| 6 | ת.ז. | The existing rule, honoured from the first row. Masked, governed reveal, `evidence.read_identifier` |
| 7 | Derived name | A label, never a key. 6.10 already ruled identity |

**Not needed — already works.** "Renter 2" is not a new field. Two tenants on one lease are two rows
of the same declaration; `0017_extracted_field.sql` says so and deliberately declines the unique
constraint on `(document_id, document_type_field_id)`.

---

## Slice 7.1 — The tab, the declaration, and an honest refusal — **closed 14 Sep 2026**

No migration, no write path. Read-only screens and one corpus file.
Evidence: [evidence/7.1.md](evidence/7.1.md).

- [x] **`GET /documents`** — the tab's landing. Type picker (`listDocumentTypes`) and, for the chosen
      type, the declaration the reader will look for (`documentTypeFields`): key, value type,
      required, extraction hint, and a `גרסה <effective_from>` chip. Closed rows
      (`effective_to IS NOT NULL`) are not shown.
- [x] **The rail points at it.** `src/chrome.ts`: `/documents/new` → `/documents`, label
      `תיוק מסמך` → `מסמכים`. `ChromeDest` already has `documents` (6.9) and does not change. The
      landing carries the same `documents.write` gate the rail item does — an ungated landing is the
      door that answers `not_allowed` after somebody walked through it, which is what A11 refused to
      build.
- [x] **The refusal names every requirement, not only the failures.** `Verification` gains
      `matchedTerms` beside `missingTerms`; `refusal()` prints all of them with found / not-found.
      `missingTerms` keeps its meaning, so nothing downstream moves. **This is the director's
      comment, closed.**
- [x] **`docs/corpus/lease-amendment.md`** — the missing tier-1 specimen, authored to the published
      form's structure. **Never a real tenant document.** Registered in `SPECIMEN_TYPES`, removed
      from `NO_SPECIMEN_YET`.
- [x] **The measurement**, `tests/policy/document-verification.test.ts`: evaluate a *candidate* lease
      declaration of `['חוזה שכירות|הסכם שכירות']` alone against every specimen and assert which
      cross-verify. **Red first** — the expectation is that the נספח verifies as a lease, and that
      failure is the answer to the comment. If it stays green, the replacement is adopted here.

**Done when:** the rail reaches `/documents`; the declaration renders out of the database; a refused
upload names all three requirements and which of them was found; the cross-verify case has printed
its result and the director has the number. **All four met.**

**What it answered, and what it raised.**

- **The replacement is refused, on evidence.** The title-only candidate and the live declaration
  verify the same two specimens and refuse the same six — indistinguishable on this corpus. 6.8's
  body terms stay, and the reason is now a number rather than an opinion. *The director's comment is
  closed.*
- **`lease_amendment`'s declaration was wrong in both directions and is corrected in the seed** —
  it verified `bank-guarantee.md` and refused a real נספח. Any wording worth keeping still goes
  through `/settings` first (5.8); this one went to the seed because a re-seed is what reads it.
- **A lease cannot refuse its own annex**, and no choice of terms changes that: the annex's
  vocabulary is a superset of the lease's and the term language has no negation. One named pair in
  `tests/policy/document-verification.test.ts`. **Open, and it belongs to the director:** whether
  separating them is worth a third verb — 7.4 already has one (`verify`) waiting on the same kind of
  question — or whether declared-type-plus-operator is simply where this stops.
- **The guard-four owner moved `7.1` → `7.3` inside 7.1, not in 7.3.** Writing `evidence/7.1.md`
  while the mockup's owner was `7.1` fails the guard, so the move could not wait for the slice that
  deletes the paint. 7.3's bullet below is corrected to match.
- **The test isolation defect the slice tripped over**, fixed here rather than carried: eight
  evidence suites shared one bucket string and each teardown deleted by it. See the evidence file.
- **Gate two did not run in full locally** — the corpus cases need `OPENAI_API_KEY`. CI is where the
  new specimen is actually exercised, and a skip there is a failure.

## Slice 7.2 — The declaration becomes editable (ADMIN) — **closed 15 Sep 2026**

Plan mode — policy layer, two modules. No migration. Flow **A14**, written into `SPEC-flows.md`
before the code. Evidence: [evidence/7.2.md](evidence/7.2.md).

- [x] **`POST /documents/types/:typeKey/fields`** — add or correct one declaration. A correction is
      **R18 new-row**: close the current row and insert a new row at `effective_from = <clock date>`,
      one transaction. Never an `UPDATE` of what a row said. The natural key makes twice-in-one-day a
      conflict, which is correct and earns its own sentence. ~~close the current row at
      `effective_to = <clock date>`~~ — **wrong, and corrected inside 7.2 rather than implemented:**
      `documentTypeFields` is inclusive at both ends, so closing at the same day the successor opens
      leaves **two live rows for one field today**. The close is **the day before**, which is what
      the seed and `schema.test.ts` have always done.
- [x] **Permission: reuse `settings.write`.** ADMIN-only, and already the hand on the `DocumentType`
      catalogue since 5.8. A permission with one reader adds vocabulary without adding a boundary,
      and `roles.ts` stays untouched — which is the point: the matrix is code.
- [x] **The money loophole, and the reason this slice needs a guard of its own.** `0011` says it:
      "No MONEY member … no amount is ever a column on a business record." That holds today *because
      the schema is source code*. The moment an admin may declare a field, they may declare
      `rent_amount` as `NUMBER`, and READ ME rule 3 stops being enforceable. The editor refuses a
      declaration whose `field_key` or `label_he` carries the money vocabulary — `amount`, `rent`,
      `deposit`, `price`, `fee`, `payment`, `שכר דירה`, `סכום`, `פיקדון`, `תשלום`, `דמי` — with a
      **red-first** policy case and a refusal sentence naming the rule. Adding money stays a deploy
      and a diff, which is what `roles.ts` says an irreversible widening should cost.
      `src/evidence/internal/money.ts` holds the vocabulary and the policy case reads **it**, never a
      copy, so a shortened list is a red build.
- [x] **Retire, added to the scope and named here so it can be struck.** The bullets said add or
      correct. A correction keys on `field_key`, so a mis-typed key cannot be corrected — only
      declared again beside its own mistake, forever — and an editor whose first typo is permanent is
      a trap. `retireDocumentTypeField` closes the row and inserts nothing: deactivate, never delete,
      which is the rule `upsertDocumentType` already states one level up.
- [x] The money case is a policy case, in `tests/policy/money-field.test.ts`, **red first**. **The
      OPERATOR refusal is a route case and not a policy case**, against this bullet's original
      wording: `tests/policy/` builds no application, and every role refusal in this repository is
      asserted against the stance the composition root actually registered. It was red first too —
      registered at `documents.write`, which an OPERATOR holds. `src/evidence/schema.test.ts`: a
      correction leaves two rows and the old one still says what it said.

**Done when:** an ADMIN adds a field, a lease is re-filed, and the new field is extracted against the
new declaration; an OPERATOR is refused; a money declaration is refused; the superseded row is intact.
**All four met** — the extraction half in `src/evidence/extract.test.ts` on the fake extractor, which
is what makes it runnable with no `OPENAI_API_KEY`; the rest clicked on `:3000`.

**What it answered, and what it raised.**

- **Foundation rule 8 is true of both halves for the first time.** A field was a commit and a
  `seed:doctypes` until today, paid three times (3.1, 3.5, 6.4).
- **A refusal case can pass as a 303, and four of them were.** `SESSION_ABSOLUTE_MS` is twelve hours
  (5.1) and this is the first route suite in the repository that spans two days: the session minted
  on day one was expired on day two, so the guard answered a redirect to sign-in — which is
  indistinguishable from a route that accepted the post unless the case asserts the status. Fixed
  inside the slice (a session per day, one account). **No other suite spans two days today**, so
  nothing is owed; the day one does, this is the trap.
- **The day is UTC and the office is not. Open, and it is the module's convention rather than this
  route's.** `deps.clock.now().toISOString().slice(0, 10)` is what every date here uses; the verify
  click ran at 00:02 IDT and the declaration was stamped `2026-09-14`. For three hours a night an
  administrator's "today" and the catalogue's disagree — which also means the twice-in-one-day
  conflict can be stepped around by declaring at 00:30 and again at 03:30. **A clock with a zone is
  a kernel change and a migration's worth of thought**; the director places it.
- **Refusals are the JSON error body, including the money one.** One refusal shape per route, as
  `settings`, `estate` and `staff` all do. A refusal *screen* for this editor is not built. Named
  below; default is to leave it.
- **Two standing carries moved, both in the week-6 list below where they have always lived.**
  `.env`'s `DOCUMENT_AI_*` are **removed** — 7.2 uploads nothing locally, so that item's "remove it
  or write down that you kept it" was not a choice. And the four form classes have still never
  reached a third file, but **7.1 fixed `.form-grid` in evidence's copy and not estate's**, so the
  two now disagree: the trigger becomes "the copies disagree" and the owner is 7.3.

## Slice 7.2b — The day the system is having — **ahead of 7.3** · **closed 15 Sep 2026**

Plan mode — kernel, and it touches `src/scope/`. **No migration.** Opened 15 Sep 2026 by the
director's ruling on the item 7.2 raised. Evidence: `tasks/evidence/7.2b.md`.

**What 7.2 found, and what counting the call sites found after it.** 7.2's verify click ran at 00:02
IDT and the declaration was stamped `2026-09-14`, because every date in this system is derived as
`clock.now().toISOString().slice(0, 10)` — the **UTC** day. Israel is UTC+2/+3, so for two or three
hours every night the system's "today" is the country's yesterday. As a stamp on a schema row that is
a cosmetic annoyance. It is not only a stamp:

- **`src/scope/internal/isolation-join.ts:187`** feeds that day to `TENANCY_ACTIVE_TODAY`. Foundation
  rule 1's join asks about **yesterday** between midnight and 03:00: a letting that starts today is
  not yet active, and one that ended yesterday still is. This is the scope, computed in the wrong
  zone, and the scope is the one thing this product cannot get wrong.
- **`src/tenancy/internal/status.ts:40`** — `utcDay`, already honestly named — dates the obligation
  state machine, which SPEC.md rule 3 says is inspectable, versioned and defensible in a dispute.
- ~~Nine others~~ **Ten others**, including `extract.ts:157` (which declaration governed this
  reading) and `read-model.ts` (occupancy). **The count was one short, and the slice counted it:
  fourteen occurrences in ten files** — twelve asking *what day is it now*, two doing date
  arithmetic. `grep` found thirteen and missed `src/register/fixtures/generate.ts`, whose `shift`
  the formatter had broken across two lines; the guard below collapses whitespace and found it.

- [x] **`today(clock)` in `src/kernel/clock.ts`**, formatting in a configured zone that defaults to
      `Asia/Jerusalem`, through `Intl.DateTimeFormat` with `en-CA` — no dependency, and the zone is a
      `config_settings` row rather than a literal, because a second country is a row and not a
      release (rule 8's own argument). Delivered as `today(clock)` · `dayIn(at, zone)` ·
      `zonedClock(zone)`, with `Clock.zone` on the clock itself: a caller that can pass an instant
      can pass the wrong one, so the zone travels with the thing that knows what time it is. The row
      is `clock.zone`, read in `src/serve.ts` and printed on the boot line — `clock: Asia/Jerusalem`,
      beside `docs:` and `identity:`. No migration seeds it: `settings.text()` falls back, so the row
      exists only once somebody means to change it.
- [x] **Every call site that asks *what day is it now* moves to it.** Twelve did. `addUtcDays`
      **behaves exactly as it did** — but it **moved**, and that is a deviation from this bullet as
      written, recorded rather than quietly taken: it is now `addDays` in `src/kernel/clock.ts`, and
      `shift` in `src/register/fixtures/generate.ts` was the same six lines and collapsed into it.
      The reason is the guard below, which has no exclusion list beyond the kernel file — writing
      two module file names into a guard's exemptions is how a guard dies (`scripts/guards.ts`
      says so of guard two), so lifting the arithmetic was cheaper than excusing it. The signature
      change everywhere is `Date` → `Clock`, in `src/scope/`, `src/estate/`, `src/tenancy/` and
      their contracts. Saying which call site was which was most of this slice, and each of the
      fourteen is classified in the evidence file.
- [x] **A policy case, red first, in `tests/policy/`.** In `tests/policy/isolation.test.ts` beside
      POLICY CASE 1, because it is the same claim at a boundary hour. A handover: the outgoing lease
      ends on the 14th, the incoming starts on the 15th, asked at `2026-09-14T21:30:00Z`. Red first,
      and the failure named the leaked party id — output in the evidence file.
- [x] **A kernel case** that the same instant is `2026-09-15` in Jerusalem and `2026-09-14` in UTC,
      so the fix cannot be undone by somebody "simplifying" it back to `toISOString`. Written, **plus
      a winter case** — a fix that adds three hours passes the summer case and is wrong for half the
      year, in the direction nobody checks.
- [x] **Scope added, named so it can be struck: guard five, `no-utc-day`.** A test says the answer is
      right today; a guard says nobody may write the wrong question again, which is what this bullet
      asked for and a test cannot give. `toISOString().slice(0, 10)` and `split('T')[0]` fail the
      build outside `src/kernel/clock.ts`. Cases in `tests/policy/guards.test.ts` — the violating
      fixture is **the real `clock.ts`, relocated**, guard two's idiom. `docs/pipeline.md` §6 said
      *three* grep guards when there were four; corrected to five there, with a bullet each for
      guard four and guard five.

**Done when:** an instant between midnight and 03:00 IDT resolves the same tenancy the office would;
`utcDay` has no callers left that meant *today*; the full suite is green with the clock fixed at
00:30 IDT. ✔ — `utcDay` is deleted, not merely uncalled. 652 pass / 0 fail / 0 skipped, from 640.
**Verify:** the policy case red first, with the wrong tenancy named in the failure. Then `:3000` with
`TZ` unchanged and the declaration stamped the day the calendar says. ✔ — and the click landed
**inside the broken window**: 00:32 Jerusalem, 21:32 UTC on the 14th. `/documents` declared `city`
and the row says `effective_from = 2026-09-15`; `/estate/expiring` said *מסתיים היום* for leases
ending on the 15th, which the day before this slice would have read *מסתיים מחר*.

**Carried, and owned.**
- **The guards read comments and string literals as readily as code**, which is stated as a virtue in
  `scripts/guards.ts` and bit twice in this slice: a comment quoting the tenancy-active predicate
  failed guard two, and a test fixture spelling the UTC-day expression failed guard five over its own
  test. Both were rewritten rather than exempted. **No owner needed** — it is the design working, and
  it is written into the evidence file so the next person meets it as a rule and not as a surprise.
- **`ScopeOptions.clock` is gone.** Nothing ever set it, and with a `Clock` in the positional
  parameter it was a second clock beside the real one. The audit line takes its time from the same
  clock the day comes from. Closed here.
- **No `config_settings` row is seeded for `clock.zone`**, and there is still no admin screen on that
  table. Until there is, a second country is a row somebody inserts by hand. **Owner stays 5.8's open
  half** (the `config_settings` / secret-name editor), in the week-6 standing list below.

## Slice 7.3 — The approval table — **closed 15 Sep 2026**

Plan mode. **Migration 0028** — ~~0019~~, which is `0019_tenancy_event.sql` and has been since 5.5;
corrected at 7.2, which counted them. This is the slice that deletes the paint, and it did.
Flow **A15**, written into `SPEC-flows.md` before the code. Evidence: [evidence/7.3.md](evidence/7.3.md).

- [x] **`GET /documents/:id/fields`** — the ledger from the paint. One row per `extracted_field`:
      field, read value, confidence, action. `/documents/:id/read` stays what it is
      (`מילים על הדף`, the pixel view); the two link to each other and the `קדם` buttons move here.
- [x] **0028 on `extracted_field`** — `approved_value text`, `approved_by text` (`-- pii`, a
      snapshot and not a staff FK, exactly as `promoted_by`), `approved_at timestamptz`. **`value` is
      never overwritten.** A trigger in the shape of `extracted_field_promotion_guard()` refuses an
      approval stamp written without `dona.approving` and refuses to delete an approved row.
- [x] **Approve ≠ promote, and both verbs survive.** Approving says *this reading is correct*;
      promoting copies it onto a typed column and is still the two dates until 7.4.
- [x] **Primary control is `אישור כל מה שלא סומן`**, never approve-all, with the flagged rows sorted
      up and a threshold below which a row must be touched individually. **80%, ruled 15 Sep** — and
      the ruling comes with a correction, because this bullet was about to build a control that reads
      as something it is not.
      • **`extracted_field.confidence` is not the model's confidence in the field. It is the
      *minimum OCR word confidence* of the words the reader pointed at** —
      `src/evidence/internal/extract.ts:303`, `min()` over `MeasuredWord.confidence`, and the
      extraction schema **deliberately refuses a model-supplied `confidence`**
      (`extract.test.ts`: `assert.equal(blob.includes('"confidence"'), false)`). So 90% means
      *Document AI read these characters well*, never *this is the tenant's name rather than the
      landlord's*. A crisp page misread with total legibility scores 99%. 80% is a sound cut **on
      that number** — it is roughly where Document AI's own guidance puts human review — and it is
      kept. What changes is what the screen calls it: **`איכות הקריאה`**, never `ביטחון`.
      • **`null` is not "confident", and this is the half that would have shipped broken.**
      `src/kernel/pdf.ts:308` gives every native-text word `confidence: null`, and the `min()` above
      turns any null into a null field — so **every field of every digitally-produced lease has no
      confidence at all**, and a threshold that treats null as passing would let
      `אישור כל מה שלא סומן` approve an entire document on no signal whatsoever. **Null sorts up with
      the low ones and is flagged**, and the row says *נקרא מטקסט, לא נמדד* rather than showing a
      number it does not have. A red-first case asserts a null-confidence row is never in the
      unflagged set.
      • **A second signal is not this slice's.** The honest one — whether the words the model pointed
      at actually sit under the declared field's label on the page — is geometry the read overlay
      already has. Named, not built.
- [x] **ת.ז. masked, revealed under `party.national_id.read`**, the reveal a separate request that
      writes `evidence.read_identifier`. The value never ships to be hidden by CSS — 6.6.
      **Sharpened inside the slice, against this bullet:** an identifier is **never in the bulk set,
      at any stance**, not merely withheld from a viewer who may not read one. A ת.ז. does not reach
      the screen until somebody asks for that row, so `אישור כל מה שלא סומן` would otherwise sign a
      value the signer has not been shown — the same objection as approving a withheld row, at scale
      and without anyone noticing. `POST …/fields/reveal` is **the first route in this system to
      declare `party.national_id.read`** rather than consult it inside a handler, and it renders
      rather than redirects: a redirect would put the revealed row's id in a URL, in history and in a
      referrer, and a refresh would re-log a disclosure that happened once.
- [x] **`tests/ui/tokens.test.ts`**: the **seventh** document-shaped screen under 6.6's ruling, with
      the justification written where the other six have theirs. ~~fifth~~ — 7.1 registered the
      fifth and 7.2 the sixth (`documents · the declaration, admin may edit`, the same screen at the
      other role). Corrected inside 7.2, which is the slice that moved the number. Registered at
      **three** stances — masked, withheld, and one row revealed — and the third is the second entry
      ever added to that suite's disclosure exemption, which SPEC-evidence.md rules before the array
      does.
- [x] **Delete `mockups/document-intake.html`** and its `MOCKUP_OWNERS` entry — guard four. ~~Owner
      moves `7.1` → `7.3` in `scripts/guards.ts`~~ — **done in 7.1**, which is where it had to
      happen: the owner's evidence file and the mockup cannot both exist, so 7.1 could not close
      with the owner still pointing at itself. The paint's last unwired screen is this one and the
      owner is whoever deletes it.
- ~~**Fix `.form-grid` for real**~~ — **closed in 7.1**, which turned out to be the slice that
      first puts a table on a wired `.form-grid`. Measured at 478px in the evidence file.

**Done when:** a filed lease shows its ten rows; approve-unflagged stamps the high-confidence ones;
edit-and-approve writes `approved_value` and leaves `value` intact; a second approval of the same row
is refused; an OPERATOR sees the ת.ז. rows as a count and no value; ~~0019~~ **0028** round-trips.
**All six met.** On `:3000` the bulk control signed 4 of 8 and left the unmeasured row, the 71% row
and both ת.ז. rows. 670 pass / 0 fail / 0 skipped, from 652.

**What it answered, and what it raised.**

- **The measurement exists.** `value` is what the reader produced and `approved_value` what a person
  signed; the audit line says `edited` and carries neither. `SELECT field_key, value, approved_value`
  is the dataset, and the evidence file has the first row of it.
- **The read-quality predicate would have shipped broken and the policy case caught it.**
  `(confidence ?? 1) < THRESHOLD` — a default of *fine* on an absent measurement — approved two of
  three fixture rows instead of one, and the extra one was the row nobody had measured.
- **The `קדם` buttons moved off the read overlay and were not replaced there.** Two screens writing
  the same row is how the two drift into disagreeing about which one is the flow. `promote.test.ts`'s
  4.3 case was rewritten to assert the new division rather than deleted.
- **A promotion now copies `COALESCE(approved_value, value)`.** Copying the raw read after a person
  corrected it would write a value nobody affirmed. **Whether an approval should be *required* first
  is 7.4's**, and it is in that slice's bullets below.
- **`הוספה ידנית` is not built**, and it is a ruling rather than a button: a row for a declaration
  nothing was read for is an `extracted_field` with no page and no bbox, which `0017` forbids. In the
  director's list below, default unbuilt.
- **The overlay could not be clicked locally** — `object not found`, because `docs: memory` loses the
  bytes of a document filed before a restart. Pre-existing and nobody's carry; recorded because it is
  the design decision confirming itself, the ledger having been built to read no bytes.
- **A test asserted the wrong page and passed.** The overlay-links-to-the-ledger case first read
  `ledger.body`, which carries `/fields` in every form it draws. Found by clicking, fixed inside the
  slice. **No owner needed** — it is written into the evidence file so the next person meets it as a
  rule and not as a surprise.

## Slice 7.4 — Approve-to-where

Plan mode. **Migration 0020**, and the only slice in this track that touches tenancy's typed columns.

`field_promotion.target`'s `CHECK` is `('tenancy.start_date','tenancy.end_date')` (0018) and
`TARGET_FIELD` in `src/evidence/internal/promote.ts` mirrors it. Widen it target by target, each with
a mapping in `applyPromotedField` and a policy case.

- [ ] **The finding that makes this the director's and not the agent's:** `address` and
      `apartment_number` are already facts about the *unit*, and A11 says only an ADMIN shapes those.
      Promoting them would not write a new fact — it would **assert the document against the flat it
      was filed under**, where disagreement is a defect to surface and not a value to copy. That is a
      third verb (`verify`), and probably its own slice. `tenant_name` and `tenant_id_number` already
      have a home: the party rows 6.5's proposal writes.
- [ ] So the honest scope is: decide which targets are genuinely *copies*, and build only those.
      **Opens with the two dates and adds nothing until ruled.**
- [ ] **Carried in from 7.3: whether a promotion should require an approval first.** 7.3 made
      `promoteExtractedField` *prefer* `approved_value` (`COALESCE(approved_value, value)`), which is
      the cheap half and is done. Requiring one is the other half and belongs here, in the slice that
      decides which targets are copies at all: a target that is genuinely a copy is also the one
      where promoting an unsigned reading is hardest to defend.

## Left to the director — named, not blocking

1. **The money field.** No money field and no `MONEY` value type, twice on purpose; 7.2's guard keeps
   it that way. *Default: stays refused.*
2. ~~**The low-confidence threshold.**~~ **Ruled 15 Sep and built at 7.3: 80%**, as
   `READ_QUALITY_THRESHOLD` in `src/evidence/internal/approve.ts`, with `null` flagged rather than
   passed. It is **a constant and not a `config_settings` row**, deliberately: a row with no editor
   is a row somebody inserts by hand, and moving it there would add a second unreachable knob beside
   `clock.zone`. **Owner of the knob stays 5.8's open half** (the `config_settings` / secret-name
   editor), in the week-6 standing list below. What is open is only the number, and the number is
   one edit and one evidence file.
3. **7.4's targets**, and whether `address` becomes a cross-check rather than a promotion.
   *Default: 7.4 opens with the two dates and adds nothing.*
4. ~~**A refusal screen for the declaration editor.**~~ **Ruled 15 Sep, and re-scoped rather than
   built.** A bespoke screen on one route would be the seventh form in this console and the only one
   that does not dead-end — which is not a fix, it is an inconsistency. **Every form post in this
   system loses what the administrator typed**: `settings`, `estate`, `staff` and now `documents`
   all throw a `KernelError` into one `setErrorHandler` that answers JSON. That is **one change at
   the composition root** — an HTML-accepting request that posted a form gets its form back with the
   message in it — and it is a slice, not a bullet. Named in the carried list below. *Until then:
   JSON, as now.*
5. ~~**The day is UTC.**~~ **Ruled 15 Sep: it is fixed, in the kernel, and it is bigger than 7.2
   found.** 7.2 raised it as a stamped declaration reading `2026-09-14` at 00:02 IDT. Counting the
   call sites found eleven, and one of them is
   **`src/scope/internal/isolation-join.ts:187`** — foundation rule 1's own *Tenancy (active today)*
   predicate. **For three hours every night this system asks the isolation join about yesterday**: a
   letting that starts today is not yet active, and one that ended yesterday still is. `tenancy`'s
   state machine derives its day the same way (`status.ts:40`, a function already honestly called
   `utcDay`). This is a correctness bug in the two things SPEC.md says are never decided by a model,
   and it gets cheaper to fix now than after real tenant data. **New slice, below, ahead of 7.3.**
6. **`city` is declarable from a screen now**, with no deploy — one of the three fields the paint
   deferred. The other two are money and stay refused. *Default: nobody declares it until a flow
   needs it.*
7. **`הוספה ידנית` — a value somebody types for a declaration the reader found nothing for.**
   Raised by 7.3, which drew the row and declined the button. `0017` requires `page >= 1` and a
   four-edged `bbox`, so a hand-typed value cannot be an `extracted_field` without either inventing
   geometry or making it nullable — and the question under that is whether a value nobody read off a
   page is evidence at all, or a fact about the flat that belongs in another module entirely.
   *Default: it stays unbuilt and the row says `לא נקרא`.*
8. **Whether a lease should be able to refuse its own annex.** Raised and measured by 7.1: it cannot,
   by construction, and the fix is either negation in `verification_terms` — a new grammar in the
   settings editor — or the third verb 7.4 already circles. *Default: the named pair stands and
   nothing is built.*

## Carried

- [x] **`.form-grid` floors its implicit column at its widest item's min-content.** **Closed in
      7.1**, not 7.3: `GET /documents` is the first wired `.form-grid` holding a table, so the slice
      that inherits the bug turned out to be this one. `grid-template-columns: minmax(0, 1fr)` is on
      the real screen now, and the table scrolls inside `.table-wrap` rather than widening the page. Found by
      clicking this paint at 478px: one `.notice` holding a table made the whole page, headings
      included, 567px wide and scrolled the body sideways. Fixed *inside the paint* with
      `grid-template-columns: minmax(0, 1fr)` scoped under `.paint`, deliberately not in
      `src/evidence/internal/views.ts` — no wired `.form-grid` holds a table today, so nothing is
      broken yet. **The slice that puts these tables on a real screen inherits the bug**, and that
      is the slice that fixes it for real.
- [x] **`roadmap.md` § "What week 6 displaces" was in the file twice** — a 27-line stale copy from
      `bda380e`, starting at a `---|---|---|` with no header row above it, so it rendered as
      garbage and contradicted the live copy on M2. Deleted 14 Sep. Nothing referenced it.

---

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

**WEEK 6 IS CLOSED — 14 Sep 2026.** [evidence/week-6.md](evidence/week-6.md). Eleven slices, fifteen
PRs (#74–#88), **code tip `b6b8605`** on staging as `dona-staging-00083-rp9`, smoke green (this
close's own docs-only merge then redeployed it as `0a1e05b`, byte-identical `src/` — the footnote is
in the evidence file). The demo was given off staging and found four defects;
6.8, 6.11, 6.9 and 6.10 closed all four on 14 Sep — 6.11 was added by 6.8's verify step and the
director sequenced it ahead of 6.9, because it is the one defect that files a lease against a flat
nobody chose. 6.1–6.7 were closed and merged before the demo. Both conditions
[CLAUDE.md](../CLAUDE.md) names are met: the slices closed **and** the demo was given, so **week 7
starts today** rather than on a Thursday. Everything this week raised and did not close is in the
carried list below, each with an owner.
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

- [x] **`national_id` never in an agent tool's response shape.** **Closed at 6.6**, and the read
      overlay with it — the ruling is *captured is governed, printed is the document*
      ([evidence/6.6.md](evidence/6.6.md)). **6.6 now also owns the read
      overlay's word boxes**, where 6.5 found an OPERATOR can read a ת.ז. off the document's own
      rendered line. Was → week 9. **Now 6.4 and 6.6**,
      because this is the week ת.ז. starts existing. `party.national_id.read` gets its first reader
      in 6.4, three weeks earlier than the roadmap assigned it. **6.4's half is done** — the
      permission has a reader, the read path withholds by default and every disclosure writes
      `evidence.read_identifier`. **6.6 still owns the guards**, and now owns one more thing than it
      did: the case names `extracted_field` as well as `party.national_id`.
- [x] **Staging `staff:add` for a second operator.** Owed since 5.7, **closed at 6.7** —
      `infra/staff-add.sh staging asaf.wilder@roseberry.media OPERATOR`, through the new
      `infra/run-job.sh` ([evidence/6.7.md](evidence/6.7.md)).
- [ ] **The 5.6 clock-end click.** Carried 5.6 → 5.7 → 5.8 → 6.7, and **6.7 found it is not a click
      at all**: no route writes `status: 'ACTIVE'`, only the fixtures do, so A5 is a flow with no
      screen and `expireDueTenancies` can only move a row nothing can create. The register generator
      ends every ACTIVE tenancy in the future by construction — 7 rows, earliest end 2027-07-14.
      **Re-owned by whichever slice gives A5 a screen**, and written into that slice when the
      director places it. Not carried forward again as a click.
- [ ] **`config_settings` / secret-name editor.** ~~and `DocumentTypeField` on the settings screen~~
      — **that half closed at 7.2**, and deliberately not on the settings screen: the declaration is
      edited at `/documents`, beside the table showing what the reader looks for, under the same
      `settings.write`. `src/settings-page.ts` says so and points there. The `config_settings` /
      secret-name editor half is still open and still unowned.
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
- [ ] **The rail's other six destinations are ungated.** Raised at 6.9, which gated the seventh.
      `settings` is `settings.write` and ADMIN-only and a VIEWER is shown it; `staff` and `calls` are
      their own question. 6.9 gated `documents` because A11's rule says a door an operator may see
      and may not walk through is a refusal after they have already walked — the other six are older
      than this slice and were not widened by it. **Whether the rail hides what a role cannot reach,
      or shows everything and lets the route refuse, is a ruling and the director's.**
- [ ] **Nothing can move a document's anchor.** Raised at 6.10, and it is the price of that slice's
      ruling stated out loud: a document filed against the wrong flat stays filed against it. The
      operator is told which flat and can open it, so nobody is stuck — but correcting one is a
      deliberate act with its own audit line and its own screen, and it does not exist. Nothing needs
      it yet. **The day something does it is a slice, not an edit**, and the director places it.
- [ ] **`cap.test.ts` deletes another suite's rows.** Raised at 6.10. Its teardown is
      `storage_uri LIKE 'gs://dona-v5-test-docs/%'` and `routes.test.ts` commits under that same
      bucket; `node --test` runs files concurrently. Seen twice in one session — an FK violation in
      cap's own teardown, and `routes.test.ts` losing its filed document mid-run — and **both passed
      on a re-run, which is the problem**: a suite that fails only sometimes teaches everyone to
      re-run. The fix is a bucket per suite, or a cleanup scoped the way routes' own is (by hash).
      A test-harness slice, and small. **The same root cause, raised separately at 6.8:** the
      after-write hook went **5 red on a clean green tree and twice green on a re-run**, because it
      runs `src/evidence/*.test.ts` in parallel against one developer database and is not
      `npm run test:code`. One slice owns both halves — suite isolation, in the fixtures and in the
      hook.
- [x] **`.env` still points at the staging OCR processor.** Left wired at 6.8 because 6.9 and 6.11
      both wanted it, and unchanged at 6.11. `.env.bak-6.8` is the backup. **Every local upload spends
      a Document AI call until it is removed**, which is a real bill against a developer machine and
      not a tidiness item. Whoever opens the next slice that uploads locally either removes it or
      writes down that they kept it. **Removed at 7.2**, which uploads nothing locally — so the
      choice this item offered was not a choice, and `cp .env.bak-6.8 .env` is the way back.
- [ ] **6.5's `extracted_field` residue in the developer database.** Raised at 6.5, restated at 6.6,
      6.7 and 6.8, and **promoted here to the standing list because it has outlived four slices**.
      The promotion guard refuses both the delete and the unstamp (4.3, working as designed), and
      disabling a trigger to get past it is not an agent's call. **Director's.**
- [ ] **A document's *tenancy* link is stable but arbitrary.** Raised at 6.10, beside the anchor.
      `tenancyLinkOf` and `promote.ts` order by `entity_id`, so they never reshuffle — but no rule
      says a document has one letting, and if one ever has two the lowest id wins for no reason.
      6.10 ruled the *place*; the letting is a different question and A3 is where it would be asked.
- [ ] **`.form-grid` / `.form-row` / `.hint` / `.form-actions` are two files each — and from 7.1 the
      two copies *disagree*.** Carried 6.9 → 6.10 → 7.2, and a third file has still never been
      written: 7.2's declaration editor went into `src/evidence/internal/views.ts`, which is already
      one of the two. **But 7.1 fixed `.form-grid`'s `grid-template-columns: minmax(0, 1fr)` in
      evidence's copy and not estate's**, so the failure this rule was written to prevent has
      happened by a route the rule does not name. **The trigger is now "the copies disagree" rather
      than "there are three", and the owner is 7.3** — the next slice to put a table on a
      `.form-grid`. `.check` is already in `tokens.css` and is closed.
- [ ] **Every form post in this console dead-ends into JSON.** Raised at 7.2 as a refusal screen for
      the declaration editor and **ruled on 15 Sep as the console-wide gap it actually is**: seven
      forms — `settings` ×2, `estate` ×2, `staff`, `documents/intake`, `documents/types/:key/fields`
      — throw into one `setErrorHandler` (`src/app.ts:278`) that answers `{code, message}`, so an
      administrator who typed a declaration and named a money field gets a JSON page and a back
      button onto an empty form. **The fix is one change at the composition root**, not seven
      bespoke screens: a request that accepts HTML and posted a form gets its form back with the
      message in it and its values still in the inputs. `POST /documents/intake` already does this by
      hand at 422 (6.3) and is the shape to generalise. **Unowned**, and it wants a slice.
- [ ] **The bash guard reads the command that is typed, not what it runs.** Raised at 5.1c, flagged
      rather than fixed. If the director wants the stronger rule it is theirs to say so. **Bit for
      the first time at 6.7**, in the other direction: writing a *file* whose text contained
      `gcloud run jobs delete` was refused as a destructive command, and the file was written with
      another tool. The guard is currently both too broad and too narrow, which is the argument for
      deciding it rather than leaving it.
- [ ] **Take delivery of the real document corpus** — after F6. **Sharper at 6.11:** A12's anchors
      have now been read against one real project lease and rewritten for it. A second form is what
      says whether they are anchors or a second calibration to a single specimen.

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

- [x] **6.6 — The guards, and the number that says ת.ז. did not leak.** Closed 14 Sep — [evidence/6.6.md](evidence/6.6.md).
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
      **Raised and closed inside 6.6:**
      • **Neither of 6.5's two options was taken, and that is the ruling.** Withholding the overlay
      would have withheld the page image, which the same viewer can already read through 5.4's
      signed URL — a control that is believed and absent. Lifting the rule would have given up a
      real distinction. **Captured is governed; printed is the document**: the `title` attribute is
      this system's transcription of the paper and is withheld; the picture of the page is the paper
      and is not. Wholesale rather than per word (`312`, `345`, `678` as three OCR tokens defeat any
      per-token pattern) and on every type rather than the types that declare the field (a
      declaration governs what is *captured*, not what a page prints).
      • **An unanchored `\d{9}` was the third repeat of week 5's `/05\d/`.** It fires on a
      64-character hex digest about four times in five and on every UUID. `IDENTIFIER_RUN` in
      `src/kernel/identifier.ts` is boundary-anchored and carries its own test — 2,000 UUIDs, 2,000
      digests, 200 base64 page images, **0** false hits. One constant, read by both guards and
      waiting for 9.1.
      • **The two write receipts came off the never-a-name allowlist when the case was first run.**
      `renderTenancyWrittenPage` says `partiesWritten` and not who, so the rule was already holding
      one screen earlier than the line 6.6 drew.
      **Raised → 6.7:**
      • **Neither guard has a staging half.** Both read the screen registry and the rows the policy
      suite seeds; nobody has grepped a staging page for an identifier. 6.7's walk files a lease with
      a ת.ז. on it, so the grep costs one command there.
      **Raised → the director:** 6.5's `extracted_field` residue is still in the developer database
      and is unchanged — the promotion guard refuses both the delete and the unstamp, and disabling a
      trigger to get past it is not an agent's call.

- [x] **6.7 — The journey, end to end, on staging.** Closed 14 Sep — [evidence/6.7.md](evidence/6.7.md).
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
      **Carried in from 6.6:** **grep the staging page for an identifier-shaped run**, at both
      stances, on the lease this walk files. Both of 6.6's guards read the registry and the policy
      suite's own rows; neither has ever looked at a page staging served.
      **Done when:** the whole walk is done by clicking, with no seed and no SQL.
      **Verify:** live on staging, both halves in one sitting.
      **Deps:** 6.6 · **M**
      **Raised and closed inside 6.7:**
      • **`seed:doctypes` and `staff:add` needed a way to reach a deployed database**, and
      `staff-add.sh` already held the shape. The gcloud flags are written once in
      `infra/run-job.sh` now, with `infra/seed-doctypes.sh` as the second caller — a second literal
      copy of the secret-mounting flags is the thing that drifts, and it drifts silently. The job's
      own output is read back out of Cloud Logging, because `fields — created 2, updated 20` is the
      record and `Done.` is not. Both callers were run for real.
      • **Staging's `lease` type declared no ת.ז. until this slice** — `2 created` is 6.4's carry
      proving itself.
      • **The first real extraction in the project's life.** Address 90%, apartment 91%, dates 96%,
      name 92%, **ת.ז. 77%**, guarantor id **0** — zero being the correct result for paper naming no
      guarantor.
      • **6.6's guards have a staging half now.** ADMIN 162 word boxes / 2 carrying a run / 3 runs in
      raw HTML; OPERATOR 8 / **0** / **0**, withheld line shown, `מספר הדירה` shown. Wholesale, as
      6.6 ruled. The lease confirm page carried **0** runs while printing `התאמה לפי ת.ז.: 1`.
      • **The bash guard blocked writing a file rather than running one** — 5.1c's open item, biting
      on a heredoc containing a `gcloud` delete. Still the director's.
      **Raised → 6.8:**
      • **A12's address reader has never seen a line break in production.** `documentText`
      (`src/evidence/internal/verify.ts:47`) joins a page's words with a space and puts a newline only
      between pages, so the clause `place.ts` and SPEC-evidence.md both lean on describes text this
      system cannot produce. Punctuation is what has always saved it — the spec's own example is
      `רקפת 12, שוהם.` — and the first scan without a full stop read the city as
      `כפר סבא דירה מספר 3 המשכיר`. The refusal was correct and wrote nothing. Kernel, plan mode.
      • **The 5.6 clock-end click moves to whichever slice gives A5 a screen.** It has been carried
      since 5.6 as a click, and it is not one: **no route writes `status: 'ACTIVE'`**, only the
      fixtures do, and the register generator ends every ACTIVE tenancy in the future by construction
      (7 rows, earliest end 2027-07-14). It cannot close until A5 exists.
      **Raised → the director:**
      • **"One party, two tenancies" is true in the database and on no screen.** There is no party
      route — eight GET routes, none rendering a person — so the week's demo sentence can be asserted
      and not shown. The nearest proof is 6.5's attach branch, which is why the walk filed a fourth
      lease. A household screen is a product decision, not an agent's.
      • **The audit trail is unreadable outside SQL.** `evidence.read_identifier` was counted in
      psql at 6.6 and cannot be counted on staging at all.
      • **A confirmed lease leaves its flat reading as vacant** — `0 מאוכלסות היום, 3 פנויות` after
      two leases — because a confirm writes `DRAFT`. The same A5 gap, on the demo screen.

---

## What the week-6 demo found — 14 Sep 2026, and it owns 6.8, 6.9 and 6.10

The demo was given on staging at 11:26 local. The director created a building and a flat, then
uploaded a **lease scanned on a phone** — a fabricated lease, invented names and ת.ז., printed on a
real standard form, filled in **by hand in pen**, CamScanner, 5 pages, 15.6 MB. The system refused it
four times and then told him the address did not match. The request log, GCS and the file itself say
why, and the four defects below are what this week's remaining slices are for. None of them is the
defect the room thought it was watching.

- **The demo used the wrong door, and A12 was invisible.** `POST /documents/intake` — flow A12, the
  document-first path — ran **three times successfully at 06:25–06:28 UTC**, two hours before the
  demo, each one a `302` straight into `/documents/:id/tenancy`. The demo itself, 08:26–08:40, is
  **six `POST /documents` and zero `/documents/intake`**: the unit-first door, because the walk opened
  by creating a flat and the only button on a unit page is `הוספת מסמך → /documents/new?unit=…`
  (`src/estate/internal/views.ts:621`). **`src/chrome.ts` has seven destinations and none of them is
  documents** — A12's only entrance is one card on the index (`src/index-page.ts:85`). The flow the
  management team asked for after the demo is the flow that was already built at 6.3 and was not
  shown. → **6.9**.
- **OCR is gated on emptiness, not on failure, so Document AI was never called.**
  `src/evidence/internal/read.ts:125-128` returns `null` the moment the native text layer has any
  text at all, and `src/evidence/internal/intake.ts:187` returns on a `refused` verdict *before* OCR
  is considered. A `refused` verdict requires **non-empty** text (`verify.ts:96-99`), so the phone
  scan's own CamScanner text layer beat the good reader. Latency proves it: **0.43–1.31 s** for the
  four refusals, against **7.07–7.40 s** for the one file with no text layer, which is a real
  Document AI call. → **6.8**.
- **The type's terms are calibrated to one specimen.** *(Closed at 6.8 — and 6.8's verify step found
  the same sentence is true of the **anchors** as well as the terms, which is 6.11.)*
  `src/evidence/fixtures/document-types.ts:79` requires **all three** of
  `חוזה שכירות` · `המושכר` · `תקופת השכירות`. The demo's paper is titled **`הסכם שכירות`** and says
  **`הדירה`** throughout; only `תקופת השכירות` is present. Two of three absent, so the refusal was
  correct behaviour and wrong calibration. Both vocabularies are standard in an Israeli lease. →
  **6.8**.
- **A second filing of the same bytes silently re-anchored the screen to another flat.** The bucket's
  last write is 06:28:19; **nothing was stored at 08:36 or 08:40**. `ON CONFLICT (file_hash) DO
  UPDATE` (`src/evidence/internal/documents.ts:81`) returned the document filed on **8 Sep**,
  `01a07f58-507e-7038-a4d7-09c2bc99f43b`, against unit `01a07769-77bf-726c-8727-78c57b64d8ba`. The
  new `SUBJECT` link was added, but `unitIdOf` (`src/evidence/internal/lease.ts:296`) takes `LIMIT 1`
  with **no `ORDER BY`**, so `proposeLeaseTenancy` compared the lease to a flat created a week
  earlier and `views.ts:916` printed the mismatch. **The sentence was true of the wrong apartment.**
  That document now carries `SUBJECT` links to three flats. → **6.10**.

**Two latent items the same reading surfaced**, both owned by 6.8 and **both closed there**:
`onlineOcrPageLimit = 15` (`src/kernel/ocr.ts:51`) silently disabled OCR for a longer scan, and real
leases exceed it — the demo's is 38 pages; and an OCR failure was swallowed by `read.ts`'s
`catch { return null }`, indistinguishable from a successful read that found nothing. The first
turned out not to need a refusal at all: `individualPageSelector` reads the front of a long document,
measured at `200` in 36.4s for fifteen pages of the demo's file.

**The director's two rulings, taken on 14 Sep after the demo and binding on 6.9:**
- **A12 may create.** `SPEC-flows.md`'s *"It does not create a building or a unit… creating the
  building is A11's act and an admin's"* is overruled: an address in nobody's portfolio offers the
  admin the building and the flat, prefilled from what was read.
- **Confirm-before-file was considered and rejected.** It would need the bytes held between two
  requests — a staging store, which 3.2, A6 and A12 all refuse, and which a browser's file input
  cannot avoid. **The indication comes after the exact match files**, on a receipt that leads with
  what was read and where it landed. `PlaceKind` stays four values.

**Still the director's, and in none of these three slices:** there is no party route, so a tenant
cannot be searched for and "one party, two tenancies" is shown on no screen. 6.7 raised it; a
household screen is a product decision. It is the other half of the room's feedback and it is
week 7's if the director wants it.

---

- [x] **6.8 — The reader reads a scan.** Closed 14 Sep — [evidence/6.8.md](evidence/6.8.md).
      Three defects in one path, and they have to move together: the reader cannot be reached, and
      when it is reached the guard it feeds refuses the paper on vocabulary. **(a)** `documentText`
      (`src/evidence/internal/verify.ts:47`) flattens a page's words with a space and emits a newline
      only between pages, while A12's place reader — and the spec documenting it — is written against
      text where a line break ends a field; both OCR and pdfjs already know the lines and this throws
      them away and then depends on them. **(b)** OCR runs only when a PDF has no text layer
      (`read.ts:125-128`) and never after a refusal (`intake.ts:187`), so any phone-scanner text layer
      permanently outranks Document AI. **(c)** `verification_terms` are three all-required strings
      from one specimen. **Carries the 5.6 clock-end click no further:** that item belongs to the
      A5-screen slice and is written there.
      **Done when:**
      • the demo's own phone scan — 5 pages, CamScanner text layer, `הסכם שכירות`, handwritten —
      files through `/documents/intake` on `:3000` and **resolves its flat**, and every case that
      proves it was **red first** against today's code;
      • OCR runs when the declared type's terms are **absent**, not only when the page is empty, and
      a call-counting spy shows it ran **once** — 6.4's `ocrCalls === 1` bar is not relaxed;
      • a lease titled `הסכם שכירות` saying `הדירה` verifies, and a file carrying none of the type's
      vocabulary still refuses and still writes nothing — the refusal is not traded away for the
      match;
      • a scanned address line ending in **no punctuation** resolves its flat — 6.7's original bar,
      unchanged;
      • a PDF longer than `onlineOcrPageLimit` is refused **with a sentence that says so**, rather
      than filed as though it had been read;
      • an OCR **failure** is distinguishable from an OCR **miss** in the audit line, asserted by
      count.
      **Verify:** the demo file, unedited, and 6.7's original lease-1, unedited, both on `:3000` after
      a `npm run dev` restart. The page-limit and OCR-failure cases asserted by count, never by
      eyeball.
      **Spec edit first:** `SPEC-evidence.md`'s A12 anchors and the verification section — terms
      become sets and OCR runs on a failed guard, which is a behaviour change and belongs in the file
      before the code. `src/evidence/internal/place.ts`'s own comment describes a reader nobody has.
      **Plan mode** — `src/kernel/pdf.ts`, `src/kernel/ocr.ts` and `src/evidence/` is two modules and
      the kernel.
      **Deps:** 6.7 · **L**
      **Raised and closed inside 6.8:**
      • **The demo file is 38 pages, not 5**, and the write-up at 6.7 said five. The size is the
      half that was right — 15,608,329 bytes is the 15.6 MB on record — and every page carries a
      CamScanner text layer of **one run with zero line marks**, so `documentText` produced 38
      "lines", one per page. Fix (a) does nothing for this file on its own; only Document AI emits
      lines for it, which is the chain (a)+(b) was designed as.
      • **`batchProcess` was asked for and is not needed**, and the probe is why. Document AI's
      online `process` accepts `individualPageSelector` on a document longer than the online limit:
      the demo file, pages 1–3, answered `200` in 33.2s; pages 1–15, `200` with fifteen pages in
      36.4s. batchProcess takes its input only from GCS, so it would have required the bytes in a
      bucket before any verdict — **a staging store, which 3.2, A6 and A12 all refuse and which the
      director's own ruling of 14 Sep rejected**. The selector gets the same outcome with no staging
      store, no new bucket, no async operation and no PDF splitter.
      • **The page limit is no longer a refusal**; a byte ceiling is. `onlineOcrByteLimit` is three
      quarters of Document AI's 20 MiB *request* bound, because the whole file rides in every request
      base64-encoded and selecting fewer pages does not shrink it. `LIMITS.fileSize` is larger, so
      there is a band where a file is storable and unreadable, and that band is the refusal.
      • **The OCR bound went 20s → 90s**, off a stopwatch: most of a large call is the upload. At
      twenty the demo file timed out and the log recorded a reader that had *failed*, which is a
      false answer rather than a slow one.
      • **The demo file now verifies.** Against the live staging processor, unedited: verdict
      `verified`, 0 missing requirements, `partial` 15 of 38 pages, **874 lines** of text where its
      own layer gave 38. It was refused four times on staging.
      **Raised → 6.11, and it is the largest thing this slice found:**
      • **A12's anchors were written from the tier-1 specimen and do not fit the real standard
      form.** On the demo's own paper the reader returned
      `{ addressLine: 'דם המכבים 38', city: null, apartmentNumber: null }` — and `דם המכבים 38,
      מודיעין` is **a party's own address**, matched through the `רחוב` needle inside `מרחוב`. The
      flat is `דירה מס ' 206-7`, a hyphenated number inside a sentence, which `APARTMENT` cannot
      read (it stops at `206`, and the spaced apostrophe defeats the `מס` branch outright). And the
      flat's address is **not in the body at all**: the form says the details are `כמפורט בנספח א'`
      and identifies the property by `גוש 80031 חלקות 43, 46, מגרש 212א`. **The risk is not a null
      reading, it is a confident wrong one** — on a portfolio holding that street, A12 would have
      filed this lease against the wrong flat and said nothing. Not patched here: the fix needs the
      real corpus and a ruling on whether an annex is read, which is a slice and not an edit.

- [x] **6.9 — The document tab, and a refusal that offers to create.** Closed 14 Sep — [evidence/6.9.md](evidence/6.9.md).
      Flow **A12** gains its entrance and its two missing screens. **The tab:** `ChromeDest` and one
      `item()` in `src/chrome.ts` — seven destinations become eight, and the index card at
      `src/index-page.ts:85` stops being A12's only door. **The create offer:** the 422 screen carries
      `reading.addressLine` / `city` / `apartmentNumber` into A11's and A13's forms as prefill, and
      returns to intake with the new unit preselected and the file input re-armed — the same
      re-attach price A12 has always charged, because nothing is held. **The indication:** the filed
      receipt and the lease confirm screen lead with what was read and where it landed.
      **The role split is the interesting half:** `estate.write` is ADMIN-only and `documents.write`
      is an OPERATOR's, so an operator meets today's screen — the candidate list and the search box —
      and an admin meets the create buttons. A door an operator may see and may not walk through is
      6.1's refusal-after-typing, and this slice does not build one.
      **Done when:**
      • a documents destination is in the side nav on every signed-in screen, and the walk reaches the
      upload screen **without going through a building**;
      • an ADMIN whose lease names an address in nobody's portfolio creates the building **and** the
      flat from the refusal screen, with the read address already in the fields, and files that same
      lease without retyping an address;
      • an OPERATOR on the identical refusal sees the search box and **no create control** — written
      **red first**;
      • the filed receipt names what was read (address, city, apartment number) and the flat it
      anchored to, and the lease confirm screen says **which fields were not read** separately from
      **which did not match** — one sentence per cause, where `views.ts:915-917` today fires one
      sentence for four;
      • nothing is held between the read and the file: no staging store, no fifth `PlaceKind`, and a
      refused intake still writes **no row and no object**, proved by row counts and a bucket listing
      the way 3.3 proved its refusal.
      **Verify:** both stances on `:3000` after a `npm run dev` restart; the OPERATOR refusal red
      first; every new or changed screen appended to `tests/ui/tokens.test.ts`'s `SCREENS` registry,
      never a second copy of a guard.
      **Mockup first:** `mockups/document-intake.html` again, at `/dev/mockups/document-intake` — the
      refusal-with-create screen is the one to paint, and guard four requires the file be deleted when
      `tasks/evidence/6.9.md` is written.
      **Spec edit first:** `SPEC-flows.md` A12 — the "does not create" sentence is struck on the
      director's ruling of 14 Sep and replaced by the role split; A11 and A13 gain prefill.
      **Plan mode** — `src/evidence/` and `src/estate/` is two modules.
      **Carried in from 6.11:** a refusal has **four** causes and not three now — nothing read, an
      address in nobody's portfolio, several candidates, and **the document defers to an annex**
      (`כמפורט בנספח א'`, the property identified by `גוש`/`חלקה`). That last one is a correct answer
      and reads today as a failure, which is exactly what one-sentence-per-cause is for. And the
      refusal screen prints an apartment number that may have been read off a party line, so it says
      **which field was read**, not only what was not.
      **Carried in, and discharged as *not tripped*:** `.check` turned out to be in `tokens.css`
      already; `.form-grid` / `.form-row` / `.hint` / `.form-actions` are still **two files each**,
      because this slice wrote its screens in exactly those two files. **The rule rides on to 6.10.**
      **Deps:** 6.8 · **L**
      **Raised and closed inside 6.9:**
      • **The nav item is gated and the other six are not.** `signedInChrome` takes `mayFile` and it
      is **required, not defaulted** — 5.8's argument one level up, since a default renders the whole
      console's navigation for a viewer and is only ever found by clicking. Four test files and three
      module dep types failed to compile, which is the parameter working.
      • **`MOCKUP_OWNERS` is live code and was stale by design.** It said `document-intake: 6.3`, and
      a **repaint** of a flow whose first slice has closed fails guard four against a two-week-old
      evidence file rather than against the paint on disk. Moved to `6.9`: the owner is always the
      slice that will wire the flow next.
      • **`matchesUnit` was decomposed and kept.** `crossCheck` returns the four facts the confirm
      screen needs and `matchesUnit` is written as their conjunction rather than beside them — two
      independent expressions of one rule is how a screen and a write stop agreeing.
      • **The annex marker is a display fact.** `readPlace` returns it, `resolvePlace` does not read
      it, and a case asserts the resolution is unchanged either way — so a marker that fires wrongly
      can change a sentence and can never change a filing.
      • **The developer database was left as it was found**, 12 documents before and after. The first
      week-6 slice to leave no residue, and only because nothing this one wrote was stamped by the
      promotion guard — 6.5's and 6.6's residue is still there and still the director's.
      **Raised → 6.10:** the CSS carry above. **Raised → the director:** the ungated rail, in the
      carried-in list. **Raised → the corpus item (F6):** the apartment number is still read from
      anywhere in the text; 6.9 says on the screen where it may have come from and does not stop it.

- [x] **6.11 — The anchors meet the form the operator actually uses.** Closed 14 Sep — [evidence/6.11.md](evidence/6.11.md).
      Flow **A12**, and it is raised by 6.8's verify step against the demo's own paper. The reader's
      three anchors were written from `docs/corpus/lease-standard.md`, which is authored to the
      *published* חוזה שכירות אחיד. The form the operator files is a project lease and it differs in
      three ways that matter, every one of them measured:
      • **A party's address is matched as the property's.** `רחוב` matches inside `מרחוב`, so
      `מרחוב דם המכבים 38 מודיעין` — the signatory's own address — was returned as `addressLine`.
      **This is the dangerous one**: a null reading asks a question, a wrong reading files a lease
      against a flat nobody chose. It is not new at 6.8 and it has never been reachable before,
      because until 6.8 no scan was read far enough to reach it.
      • **The flat is a hyphenated number inside a sentence** — `דירה מס ' 206-7` — and `APARTMENT`
      reads neither the hyphen nor the spaced apostrophe.
      • **The flat's address is in נספח א׳ and not in the body.** The body says
      `פרטיה ותיאורה … כמפורט בנספח א'` and identifies the property by `גוש 80031 חלקות 43, 46,
      מגרש 212א`. On a 38-page file the annex is past the fifteen pages the online call reads, so
      **no page selection of the front of the document can ever contain it**.
      **Done when:** the reader distinguishes the property's address from a party's, or returns null
      rather than a party's — **the wrong-address case written red first**; a hyphenated unit number
      reads whole; and the ruling on annexes is written into `SPEC-evidence.md` before the code —
      either A12 reads beyond the first pages when the body defers to an annex, or it says it cannot
      place this document and offers the search, which is a correct answer and not a failure.
      **Verify:** the demo file on `:3000`, and a second real form once the corpus arrives.
      **Spec edit first:** `SPEC-evidence.md`'s A12 anchors — the section's own rule is that they are
      printed there because somebody has to write a lease that matches them, and the real corpus does
      not.
      **Needs the corpus** (F6) to be finished properly, and the wrong-address half needs nothing.
      **Deps:** 6.8 · **M**
      **Raised and closed inside 6.11:**
      • **The wrong reading files, and the number that says so is 302.** The reader's own suite proves
      a reading and a fake database proves a resolution; neither proves what the application does
      with an upload. A route case posts a lease whose only address is the landlord's party line
      against an estate holding that street: **302, filed against flat 12A**, before the reader
      changed — a redirect into the confirm screen, no question asked anywhere. 422 now, 0 rows, 0
      objects, and the landlord's street not echoed back as the property's.
      • **The annex is ruled and not patched.** A12 does not read one, for three reasons written into
      `SPEC-evidence.md`: it is past the pages the online call reads and the byte bound is on the
      whole request (6.8), a `גוש`/`חלקה` has nothing to resolve against, and the *published* form
      defers the same way — so this is the form and not the specimen.
      • **An apartment number is still read off a party line.** `APARTMENT` runs over the whole text,
      so a lease naming only the landlord's flat still returns `12A` with a null address. Harmless
      where it stands — with no address there is nothing to resolve — and it is a number the refusal
      screen prints, so **6.9 says which field was read and from where.**
      **Raised → 6.9:** *the document defers to an annex* is one of the refusal screen's causes, and
      6.9 is the slice that gives each cause its own sentence. The screen says `לא נקראה כתובת` today
      for a document that named its property perfectly well, in an annex nobody may read.
      **Raised → the corpus item (F6):** the anchors are honest about **one** real form now. They have
      never been read against a second, and the demo file itself is not in this repo, so 6.11's live
      half is the director's click and not a fixture.

- [x] **6.10 — A dedupe names its anchor.** Closed 14 Sep — [evidence/6.10.md](evidence/6.10.md).
      The same bytes are one document forever — `ON CONFLICT (file_hash) DO UPDATE`, which is correct
      and stays. What is not correct is that filing them a second time against a different flat looks
      like success, adds a second `SUBJECT` `document_link`, and then lets `unitIdOf`'s unordered
      `LIMIT 1` (`src/evidence/internal/lease.ts:296`) pick which of them the confirm screen is about.
      That is what produced the demo's *"the address does not match"* about a flat the director had
      never opened.
      **Done when:**
      • re-filing bytes already on file against a **different** flat either refuses with a sentence
      naming the flat the document is already anchored to, or anchors the confirm screen to the flat
      it was **just** filed to — **the ruling written down either way**, in the spec, before the code;
      • `unitIdOf` is deterministic, proved by a case with two `SUBJECT` links that was **red first** —
      today it returns either row and the suite cannot tell;
      • the demo's exact sequence replays: one file, two flats, and the confirm screen names the one
      the operator is standing in.
      **Verify:** on `:3000` with the demo file; `document_link` row counts before and after, so the
      second link is proved present or proved refused rather than assumed.
      **Carried in from 6.9, still riding:** `.form-grid` / `.form-row` / `.hint` / `.form-actions`
      are **two files each** (`src/estate/internal/views.ts`, `src/evidence/internal/views.ts`) and a
      third occurrence moves them to `tokens.css`. `.check` is already there and is closed.
      **Carried in from 6.9, and it is this slice's own screen:** the confirm page now says which
      fields were not read separately from which did not match, and **which flat it is about is still
      `unitIdOf`'s unordered `LIMIT 1`** — so a sentence that is finally precise can still be precise
      about the wrong apartment.
      **Spec edit first:** `SPEC-evidence.md` on what a second filing of the same bytes means — A1
      says one document and a second link, and says nothing about which one a screen is then about.
      **Deps:** 6.8 · **S** · no plan mode: one module, one query, one sentence.
      **The ruling, taken here and written into `SPEC-evidence.md` before the code: a document is
      anchored to one place, and it is the place its own `storage_uri` names** — written once,
      immutable since 3.1, and already unique. Re-filing the same bytes against a different flat is
      **refused**, naming the flat they are anchored to; against the same flat it is what it always
      was. **Refused rather than re-anchored** because re-anchoring makes the last filing win, which
      is the demo's own defect with a different winner, and because 6.11's standing form says a
      confident wrong anchor is the dangerous failure and a refusal the safe one. R13 is untouched at
      the table: the guard is in `fileDocument`, and `schema.test.ts` still proves one document binds
      to a letting and to two signatories.
      **Raised and closed inside 6.10:**
      • **It was two unordered `LIMIT 1`s, not one.** `/documents/:id/read` took the same query and
      drew the page's back link and building name off whichever `SUBJECT` row came back. `anchorOf` is
      one read and both callers use it — deterministic by construction rather than by an `ORDER BY`,
      and **right for the rows already in the wild**, which resolve to the flat their bytes are filed
      under rather than to an arbitrary one.
      • **The 3.3-era case was inverted, not deleted.** *The same file against a second place is one
      document with two links* has carried the fixture text `one lease, two flats claim it` since the
      day it was written; two flats claiming one lease is a contradiction, not a binding.
      • **The developer database was left as it was found**, 12 documents and 25 links, after a live
      walk that went 302 → 422 → 422 through both doors.
      **Raised → the carried list, and none of it is this ruling's:** nothing can move an anchor ·
      `cap.test.ts` deletes another suite's rows · a document's *tenancy* link is stable but
      arbitrary · the CSS carry rides on, untripped a second time.

---

## Week-6 cut line

If the week runs hot, cut in this order: **6.2**'s implied parking and storage bays (an apartment
without them is still an apartment, and 4.6's convention can be applied later by the importer); then
the `guarantor_id_number` half of **6.4**, because a guarantor is frequently absent from the lease
anyway and A2 step 3 already says zero of them is a correct result.

**Do not cut 6.4's spec edit, 6.6, or 6.7.** The first is what makes the rest lawful to build, the
second is the only thing standing between a captured ת.ז. and a screen, and the third is the only
slice that proves any of it outside localhost.
