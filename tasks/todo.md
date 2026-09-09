# Week 5 · Sun 4 – Thu 8 Oct 2026 — Paper becomes truth

> **Started 9 Sep 2026**, the day week 4 closed, rather than on the planned 4 Oct. The dates in
> [roadmap.md](roadmap.md) are never rewritten; the gap between them and the evidence files is the
> measurement of how the project ran. After four weeks the project is running roughly three and a
> half calendar weeks ahead of its plan.
>
> **M1 was reached 9 Sep on five of six boxes** ([evidence/week-4.md](evidence/week-4.md)). The open
> one — the three success numbers agreed with the client — is the director's and blocks **M3**, not
> this week.
>
> **Demo kind, declared Sunday 9 Sep: SOFTWARE — and the roadmap says *Real data*, deliberately not
> rewritten.** We have no real data to demo. The 1,500-unit register is **generated** (2.5 travelled
> to pilot preparation with **F3**) and every document filed is a **tier-1 authored specimen** (the
> corpus waits on **F6**). An amendment against a generated unit is a working amendment, not real
> data, and calling it real data is precisely the claim this project exists to refuse. **If F3 burns
> before Wednesday's freeze the kind is upgradeable**; until then the honest declaration is Software.
>
> **Week demo (Thu):** an amendment arrives for a unit; the tenancy updates; the change log shows old
> → new, who approved it, and which document caused it. Then a tenancy ends because a date passed,
> with no document at all. **And it is all behind a login, which it has never been before.**
> **Freeze:** Wednesday. The last merge that reaches staging lands Wednesday.
>
> **Plan mode is mandatory** for **5.1** (auth — the whole of it), **5.2** (auth + estate + evidence +
> the composition root), **5.4** (a migration across evidence and kernel), **5.6** (a migration
> relaxing a live CHECK) and **5.7** (two new entities). That is five of eight; this is an
> auth-and-migration week and almost nothing in it is single-module.
>
> One slice = one focused session, half a day or less. **Done when** is the acceptance bar; **Verify**
> is the check that proves it — no self-certification. The standing bar every slice also clears is
> the Definition of Done in [plan.md](plan.md).

**Where a new session starts: 5.1, in plan mode**, after reading [SPEC-staff.md](../SPEC-staff.md)
(a stub — it gains content *in* this slice, and that is the signal the build has started),
[SPEC.md](../SPEC.md) Security defaults, and [docs/from-v3.md](../docs/from-v3.md) Tier 2, which is
what 5.1 is lifted from.

**The chain is 5.1 → 5.2, then a fan: 5.3 and 5.4 hang off 5.2.** 5.5 → 5.6 → 5.7 → 5.8 runs
underneath. 5.1 and 5.2 gate literally everything else in the week and in the three weeks after it.

**No slice this week depends on any fuse.** Walked 9 Sep. Week 6 is the first week a fuse touches,
and it touches its *sizing* rather than its ability to start.

---

## The one sentence that must survive this week

**Seven routes have been served unauthenticated since week 1** — `/`, `/estate`,
`/estate/buildings/:id`, `/estate/search`, `/estate/expiring`, `GET /documents/new` and
`POST /documents` — deliberately, on fixture data, stated in six files rather than hidden in one.
**Nothing may put a real party, contact or document behind them before 5.2 closes.** That constraint
is now four weeks old. It is the reason the corpus is gated behind F6 *and* behind a session, and it
is the single most important thing carried out of month one.

---

## Carried in from week 4 — every item, with the slice that closes it

- [ ] **Session, CSRF, and a cap on upload *count*.** → **5.2**, all three halves in one change. A
      token defends a session's authority and there is none; 20 MB bounds a file and nothing bounds a
      caller.
- [ ] **`uploaded_by`, signed URLs, and `superseded_by` re-asked.** → **5.4**. All three held for the
      same reason and released by the same fact.
- [ ] **`national_id` never in an agent tool's response shape.** → **5.3**, a policy case, red first.
      Owed by 1.7, restated at 2.1, in `SPEC-parties.md` and in `0006_parties.sql`.
- [ ] **Cross-tenancy party identity.** → **5.5**. `SPEC-flows.md` said "month two" and named no week
      until 9 Sep.
- [ ] **Clock-driven `TenancyEvent` kinds; Obligation and ObligationType (E9, E10).** → **5.6**,
      **5.7**.
- [ ] **The A9 settings screen** — the catalogue has been dynamic since week 3 and the hand on it has
      been a seed. → **5.8**.
- [ ] **The root index moves from `src/estate/` to the composition root** — this is the week a second
      *module* has a screen. → **5.2**.
- [x] **4.5 — the accuracy number. CUT and travelling**, not this week's. It goes to pilot
      preparation with **F6**, bounded by **week 12**; the same treatment 2.5 took with F3 and 3.4
      with F4. Recorded in full at [roadmap.md](roadmap.md) § 4.5 and
      [evidence/week-4.md](evidence/week-4.md).
- [x] **The UI-pass decision. DECIDED: no.** Parked at week 2, parked at week 3, closed at M1 rather
      than parked a third time. Nothing raised was a correctness, isolation or data question, and
      **this week changes what those screens show** — a design pass now runs against screens about to
      change shape. Reconsidered at **M2**.
- [~] **2.5 — import the real register.** Pilot preparation, with **F3**.
- [~] **3.4 and A10 — Drive ingestion and the bulk review queue.** Pilot preparation, with **F4**.

## Also this week

- [ ] **Walk [fuses.md](fuses.md).** Walked 9 Sep at week 4's close; no fuse changed state. Walk
      again before Thursday's demo. **Ask F1 specifically on 18 Sep**, when its burn window opens and
      silence stops being the expected state.
- [ ] **F6 — the ask is now four questions, not three acts.** Settle the **signing entity** first (it
      decides what goes on the OpenAI form) · execute OpenAI's DPA · confirm Google Cloud's is in
      force and file the record · review and publish the notice
      ([../docs/data-subject-notice.draft.md](../docs/data-subject-notice.draft.md)). If the accounts
      stay ours, a **Dona Dom ↔ us DPA** is owed and is written nowhere. Handed to the director 9 Sep
      in English and Hebrew. **Blocks 4.5 and nothing in this week.**
- [ ] **Answer one question out of the notice draft: how it reaches a tenant.** Owed before **week
      9** — it is the only item in the draft with an engineering consequence.
- [ ] **Ask at Thursday's demo, for week 6: are the Shoham buildings still inside תקופת הבדק?** Open
      question 4. It decides whether **6.3** demos a live ternary responsibility case or a synthetic
      one. Either is a correct slice; only one is a good demo.
- [ ] **The three success numbers agreed with the client** — the open M1 box. Director's. Blocks the
      **M3 go/no-go**, which is the decision those numbers exist to make.
- [ ] **Director's call:** whether the published Data Model's `Document` card is republished.
      Flagged, not owned.
- [ ] **Raised at 5.1 and owned at week 12: staging and prod share one Identity Platform tenant**,
      because they share one GCP project — so a staging operator is a prod operator. Prod answers
      503 by design until the first pilot tag, so this is a known window rather than an open one.
      It is decided **once**, beside the prod restart and the F7 organisation move, as either an
      Identity Platform tenant per environment or a second project. `release.yml` mounts no
      `prod-identity-api-key` today and gains one in the same pass.
- [ ] **Raised at 5.1, owner the director: an invite is a printed URL because there is no mail
      transport.** Adding one is a third party that sees an operator's address, so it is an
      **ADR-0004 naming** before it is an integration. Not urgent while the operators are three
      people in one office; it bites when Dona Dom's own staff are onboarded, which is **week 8**,
      the week the console has to be usable on its own.
- [ ] **Take delivery of the real document corpus** — after F6. Arrival and removal dates go on
      [fuses.md](fuses.md) the day it lands, and the removal is **run by hand on the day** rather
      than trusted to the lifecycle rule, which is the backstop and not the record.

**Carried in and already owned elsewhere:** policy cases 4 and 5 — **6.4** / **6.5**. The emergency
bypass — **7.5**. Redaction at the provider boundary (ADR-0004 decision 2, **hard-bounded by week
10**) — **8.1**. `run.admin` per service and the docs-bucket `legacyObjectOwner` delete — **8.4**.
Node-20 action bumps and `release.yml`'s size line — **8.3**. `tenant_visible` — week 9. Prod PITR,
`environment: production` protection rules and the `party_contact` btree — week 12.

---

## Slices

- [x] **5.1 — Staff identity, the session, and the role matrix in code.** **Closed 9 Sep 2026**
      ([evidence/5.1.md](evidence/5.1.md)) — 481 code + 41 hooks + 50 policy, 0 failed; the
      no-plaintext-token policy case red against a deliberately wrong `0021_` before it was green;
      the `-- pii` guard fired on `staff_account.display_name` and then passed. **The staging
      sign-in with MFA enforced is the one half not yet performed** — `./infra/bootstrap.sh staging`
      needs the director's approval to run; see the evidence file.
      *Original entry:* Identity Platform with
      **enforced MFA**, an invite flow, and `src/staff/` — the admin edge, not a domain module; it
      owns none of E1–E16. **The role matrix is code, not a config row**, a deliberate exception to
      *policies are data*: an access-control matrix a database write could widen is a
      privilege-escalation path wearing the clothes of a setting. Sessions store `token_hash` and
      never the token. The refusal says `not_allowed` and nothing more.
      **Done when:** a named operator signs in with a second factor and holds a session; an account
      with no role is refused with `not_allowed` and no other detail; and no token value exists
      anywhere in the database.
      **Verify:** sign in on staging with MFA *enforced*, not offered; a test asserts the stored hash
      is not the cookie; a role-less account is refused on every route with the same message.
      **Owed by 1.5:** `infra/bootstrap.sh` deliberately creates no staff seed secrets — a generated
      credential nothing reads and no rotation flow owns is worse than an absent one. This slice
      creates in Secret Manager exactly what its mechanism needs, and `bootstrap.sh` gains those
      lines here.
      **Plan mode. Deps:** none · **L**

- [ ] **5.2 — The screens go behind the session, and the write route gets a token that means
      something.** Both halves in one change, plus the bound none of 3.3's bounds are: a **per-caller**
      cap on upload *count*. The root index moves to the composition root.
      **Done when:** none of the seven routes answers without a session; a POST with a valid session
      and no token is refused; an authenticated caller is bounded on upload **count** as well as
      size; and `src/estate/` no longer owns the root index.
      **Verify:** unauthenticated GET on all five read routes refused; POST with session and no token
      refused; the cap+1 upload from one session refused; week 5's screens **appended to
      `tests/ui/tokens.test.ts`'s `SCREENS` registry** — never a second copy of the guard, which is
      how a guard dies.
      **This slice may lift the never-a-name rule.** Every screen shows a state and a count and never
      a name. Behind a session a name may become lawful to show. **Lifting it is a decision this
      slice records; keeping it is equally an answer.** What is not allowed is the rule lapsing
      because a session arrived.
      **Carried in from 5.1, three things.** (1) **The CSRF token's scope is every write route and
      not only `POST /documents`** — `POST /staff/login`, `/staff/login/verify`, `/staff/logout`,
      `/staff/invites` and both invite POSTs are inside it. 5.1 deliberately built no half of a
      token; what stands in for one until this slice is `SameSite=Lax` on the session cookie, which
      is stated as the defence it is in `SPEC-staff.md`. (2) **The guard is
      `requireStaff` from `src/staff/contract.ts`, called once per route and never re-implemented** —
      the same rule `tests/ui/tokens.test.ts`'s `SCREENS` registry carries, for the same reason.
      (3) **The four staff screens are already in that registry**; week 5's remaining screens append
      beside them.
      **Plan mode. Deps:** 5.1 · **L**

- [ ] **5.3 — `national_id` is unreachable by any agent tool.**
      **Done when:** a policy case in `tests/policy/` fails against a tool response shape carrying
      `national_id` and passes when it does not.
      **Verify:** committed red, then green, in that order.
      **Owed by 1.7**, restated at 2.1, in `SPEC-parties.md` and in `0006_parties.sql` — deterministic,
      so a policy case and never a review and never an eval. This week owns it because this is the
      week a staff surface exists that could leak it.
      **Carried in from 5.1:** the permission `party.national_id.read` exists in the role matrix,
      held by `ADMIN` alone, **with no reader**. That is the admin-only half of `SPEC.md`'s security
      default given a vocabulary before the unreachable half is enforced; this slice is what gives
      it a reader, and a permission still unread when this slice closes is a permission to delete.
      **Deps:** 5.1 · **S**

- [ ] **5.4 — What the session unlocks in evidence: `uploaded_by`, signed URLs, and the supersession
      question re-asked.** `uploaded_by` is a nullable `ADD COLUMN` the moment an authenticated actor
      exists. A signed URL is a bearer token for one object — whoever holds the string reads the
      document, isolation join or not — so minting one belongs behind a session, which is why 3.2 and
      3.6 both declined to. And `superseded_by` is **re-asked, not re-opened**: 3.1 ruled that
      `SPEC-flows.md` invariant 2 already made supersession a fact about *values*; this is the
      amendment week, so what it asks that ruling is whether promotion at scale finds a case it does
      not cover.
      **Done when:** every document filed after this slice names its uploader; the panel serves a
      signed URL where it rendered a `gs://` string as text; and `superseded_by` either exists with
      the case that forced it or is recorded as still unnecessary **against a stated number of
      promotions**.
      **Verify:** `uploaded_by` is the signed-in operator; a stale URL is refused; the supersession
      answer cites a count, not a view.
      **Plan mode. Deps:** 5.1, 5.2 · **M**

- [ ] **5.5 — Promotion at scale, and the amendment that changes a real unit.** The demo's first
      half. `applyPromotedField` and `TenancyEvent` landed at 4.3 against one document at a time;
      this is where they meet a portfolio. **Cross-tenancy party identity gets its ruling here** —
      `SPEC-flows.md` A2 step 5 forbids matching a name across tenancies and deferred the question to
      "month two". Matching people is a privacy decision before it is a data-quality one, so the
      **duplicate count** is what should provoke the ruling, not the convenience of a join.
      **Done when:** an amendment promoted against a unit changes the tenancy and appends an event
      naming the operator and the source document; and the cross-tenancy question has a written
      ruling citing the duplicate-party count that provoked it.
      **Verify:** read the change log back for one unit — old → new, actor, document, in order; A2
      step 5's prohibition still holds, or its replacement is a policy case written red first.
      **Deps:** 5.4 · **M**

- [ ] **5.6 — A tenancy ends because a date passed, with no document at all.** `0019_tenancy_event.sql`
      makes `source_document_id` NOT NULL for `amended`, because a promotion that changed a value
      without naming the paper is the exact claim this system refuses. `terminated` has no paper by
      construction. **The column relaxes for that kind only, by CHECK, never by dropping the
      constraint.** `at` comes from the injected clock; no `DEFAULT now()`, which is what makes this
      demonstrable in a room rather than merely true in November.
      **Done when:** advancing the injected clock past an `ACTIVE` tenancy's `end_date` terminates it
      and appends `terminated` with a null document — **and an `amended` event with a null document
      is still rejected by the database**.
      **Verify:** both directions in one test. The demo runs off the injected clock, on staging, with
      the date said out loud.
      **Plan mode. Deps:** 5.5 · **M**

- [ ] **5.7 — Obligation and ObligationType — E9 and E10.** The last two entities month one deferred.
      `ObligationType` is admin-managed, **deactivated never deleted**, with `responsible_party`
      **copied onto the obligation at creation** so editing the catalogue cannot rewrite history —
      foundation rule 8, the same shape as `FieldPromotion`'s snapshot of who approved a copy.
      **Done when:** an obligation carries its own `responsible_party`, and editing or deactivating
      its type afterwards changes nothing the obligation says.
      **Verify:** create, edit the type, read the obligation back unchanged; a DELETE on a type is
      refused.
      **Plan mode. Deps:** 5.6 · **M**

- [ ] **5.8 — The settings screen — A9, delivered.** A9 has been true of the mechanism since week 3
      and false of the hand on it. **One screen, one pattern, both catalogues** — `ObligationType`
      and `DocumentType` — and `asset_type` deliberately absent, because the asset register's kinds
      are estate's and not a setting. Inherits ADR-0003's question of **who may change a reference**:
      pointing production at a different secret is a privileged act even when the value never
      appears.
      **Done when:** an `ObligationType` and a `DocumentType` are each added through the screen with
      no release and no migration, by an operator whose role permits it; and `asset_type` is not on
      it.
      **Carried in from 5.1: and neither is the role matrix.** Two catalogues, and never a third card
      for who may do what — an access-control matrix a database write could widen is a
      privilege-escalation path wearing the clothes of a setting (`SPEC-staff.md`). The permission
      this screen guards with is `settings.write`, which exists from 5.1.
      **Verify:** add one of each on staging; a role without the permission is refused with
      `not_allowed`; grep the screen for `asset_type` and find nothing.
      **Deps:** 5.1, 5.7 · **M**

---

**Cut line, in order:** **5.8** first — the catalogue keeps its seed for another week, which is the
honest state it has been in since week 3 and not a regression. Then **5.7** — obligations slide into
week 6, which is lighter. **Never 5.1 or 5.2**: every week after this one assumes the session, and a
week 6 that starts without it inherits an unauthenticated console with a responsibility matrix
behind it.

**M2 is at the end of week 8**, not this week. Its boxes: the console usable on its own · all five
policy cases green, each red first · weeks 9–12 decomposed before week 9's Monday.
