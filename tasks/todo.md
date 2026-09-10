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

~~**Seven routes have been served unauthenticated since week 1**~~ — **closed 10 Sep by 5.2**
([evidence/5.2.md](evidence/5.2.md)). Every route in the application is behind the session, every
write route carries a CSRF token derived from it, and an undeclared route now stops the process from
starting rather than serving. The corpus stays gated behind **F6** — that was always the other half,
and it is unchanged by this.

**What replaces it as the sentence to keep:** *every screen shows a state and a count and never a
tenant's name.* 5.2 was the slice entitled to lift that on the strength of the session and **kept
it**, tightening the wording rather than relaxing it. **Reconsidered at 5.4.**

---

## Carried in from week 4 — every item, with the slice that closes it

- [x] **Session, CSRF, and a cap on upload *count*. CLOSED 10 Sep by 5.2**, all three in one change.
      22 routes declare a stance and 7 are `public`; the token is `sha256('csrf:' + session token)`
      and is held in no column; the cap is **50 filed documents per operator per rolling 24h**,
      counted off `audit_log`, refused attempts included. `too_many` → 429 is the sixth `ErrorCode`.
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
- [x] **The root index moved from `src/estate/` to the composition root. CLOSED 10 Sep by 5.2** —
      `src/index-page.ts`, registered by `src/app.ts`. It is the one screen whose nav names both
      modules' routes and carries the sign-out form.
- [x] **4.5 — the accuracy number. CUT and travelling**, not this week's. It goes to pilot
      preparation with **F6**, bounded by **week 12**; the same treatment 2.5 took with F3 and 3.4
      with F4. Recorded in full at [roadmap.md](roadmap.md) § 4.5 and
      [evidence/week-4.md](evidence/week-4.md).
- [x] **The UI-pass decision. DECIDED: no** at M1, **amended at 5.2b** to a chrome pass, **and at
      5.2c** to v3's ops sidebar on the live destinations only — not a card redesign. Unbuilt tabs
      and the rest of the parked comments wait on **M2** / **5.9**.
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
- [ ] **Raised at 5.1, amended at 5.1b, owned at week 12: staging and prod share one identity
      configuration**, because they share one GCP project — so a staging operator is a prod
      operator. 5.1b changes what the shared thing *is*, not that it is shared: an OAuth client and
      a consent screen rather than an Identity Platform tenant. Prod answers 503 by design until the
      first pilot tag, so this is a known window rather than an open one. Decided **once**, beside
      the prod restart and the F7 organisation move, as either a client per environment or a second
      project. `release.yml` mounts no `prod-google-oauth-*` today and gains both in the same pass.
- [ ] **Raised at 5.1b, owned at week 12 beside the entry above: the consent screen stays in
      `Testing`, so every operator is also a row in Google's test-user list.** Publishing the app
      is blocked on the Branding page, which requires an application home page, a privacy policy
      URL, a terms-of-service URL and an authorised domain — and the project has no domain of its
      own; `run.app` is a public suffix and cannot be claimed. Testing costs nothing operationally:
      `access_type=online` means no refresh token, so the seven-day testing expiry never applies,
      and our own session is 12h regardless. The cost is a second list saying what `staff_account`
      already says, capped at 100 lifetime users, and an unverified-app interstitial the operator
      clicks through. Decided **once**, with the domain — which is also what the client-facing URL
      needs. Until then `staff:add` has an undocumented second half: add the address as a test user
      too.
- [x] **Raised at 5.1, owner the director: an invite is a printed URL because there is no mail
      transport. RETIRED at 5.1b** — there is no invite and no URL. An admin adds an operator's
      email and role, the operator signs in with Google, and no message ever had to reach them. The
      mail-transport ADR-0004 naming is not owed by anything in the plan today; when a slice needs
      to *send* something it is that slice's, and week 8 no longer carries it.
- [x] **DONE 10 Sep 2026. Left standing in GCP by 5.1b, the director's — and 5.1c found it was four
      acts, not two.** All four ran: the secret and both keys removed, `identitytoolkit` disabled.
      Staging signed in again afterwards and smoke returned `ok:true` with `db:up`, which is what
      proves nothing still read them. Original entry follows.
      Unread by any revision since the 5.1b deploy: `staging-identity-api-key` in Secret Manager,
      the `dona identity (staging)` API key `8eec9e86-710e-45ed-8725-3528ffa404b3`, **and a
      `Browser key (auto created by Firebase)` `5ee51088-a00c-4a27-9ebf-82ffa656ff51`** that
      `initializeAuth` created at slice 1.5 and nothing has read since — it was not in the 5.1b
      list because nothing looked for what the vendor created on its own. Plus
      `gcloud services disable identitytoolkit.googleapis.com`, which `infra/bootstrap.sh` no longer
      enables, so the live project and a fresh bootstrap have drifted. `apikeys.googleapis.com`
      stays: it manages keys rather than being a vendor, and with no keys left it costs nothing.
      **These are the director's because `.claude/hooks/guard-bash.mjs:20` refuses a `gcloud`
      command containing `delete`, and that refusal was not worked around.** An unused credential
      nobody rotates is exactly what slice 1.5 argued against.
- [ ] **Raised at 5.1c, flagged to the director rather than owned: the bash guard reads the command
      that is typed, not what it runs.** `.claude/hooks/guard-bash.mjs:20` blocked the four `gcloud`
      deletions above; in the same session `./infra/staff-add.sh` removed its own Cloud Run job from
      inside itself and was not blocked, because the hook saw only the script's name. This is
      recorded rather than fixed, because it looks like the design and not a hole: the guard is a
      fuse against a typo or a half-considered one-liner, and a script in the repo has been read,
      reviewed and merged, which a typed command has not. Making the hook read script bodies would
      refuse `infra/rollback.sh` and `infra/corpus-delete.sh` too, both of which exist to remove
      things on purpose. **If the director wants the stronger rule, it is theirs to say so**, and it
      is a change to how much the agent is trusted rather than a bug fix.
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

- [x] **5.0-cut — Delete the speculative kernel while the migrations are still editable.**
      **Closed 10 Sep 2026** ([evidence/5.0-cut.md](evidence/5.0-cut.md)) — `events.ts` and
      `idempotency.ts` deleted with their suites, `outbox` and `idempotency_keys` squashed out of
      `0002_kernel_durability.sql`. **−176 production lines, −220 test lines, 29 → 27 tables**, all
      gates green, 50 policy cases untouched. Three further deletions the re-plan asked for were
      **disproved and not done** — `kernel/embeddings.ts`, the `vector` extension and
      `resolvePartiesInUnit` all have live callers in `evals/` and `scripts/`; the numbers and the
      greps are in the evidence file. Taken ahead of 5.2 because a migration is only editable while
      no environment holds real data (`docs/from-v3.md`), and F3 closes that window.
      **Opened → 5.1b:** local *and staging* still carry both dead tables, because the migration
      ledger is by filename with no checksum — an edited migration does not re-run anywhere it has
      already run. Rebuilding local needs a `DROP SCHEMA` the bash guard refuses and rebuilding
      staging is a hand-run against a live environment, so **5.1b's `0022_` drops them where they
      stand**, which is the one mechanism that reaches both.
      **Carried → post-7.2:** `work.ts` left standing, its durability claim still unearned.

- [x] **5.1 — Staff identity, the session, and the role matrix in code.** **Closed 9 Sep 2026**
      ([evidence/5.1.md](evidence/5.1.md)) — 481 code + 41 hooks + 50 policy, 0 failed; the
      no-plaintext-token policy case red against a deliberately wrong `0021_` before it was green;
      the `-- pii` guard fired on `staff_account.display_name` and then passed. **MFA enforcement was
      proved against the live Identity Platform** — after enrolment the same password returns
      `mfa_required` and no token — and that run found two defects the fake could not have
      (`x-goog-user-project` on the admin call, `displayName` on enrolment), both now pinned as
      tests. `bootstrap.sh`'s config step was silently failing on a wrong enum name and now reads
      the config back and exits 1 if it did not take. Staging serves `dc45dff` on revision
      `dona-staging-00056-kvp` with `identity: identity-platform:dona-v5` on its boot line;
      `/staff/login` answers 200 with no script and `/staff` redirects without a cookie.
      **What remains is a human signing in on the staging URL as themselves**, which is the
      director's. **Amended at 5.1b:** the two commands the 5.1 evidence names are gone with the
      invite — there is no URL to open, no password to set and no authenticator to enrol. What is
      needed instead is one `staff_account` row on the staging database, after which the sign-in is
      the same single link the local click-through proved. **Written at 5.1c**, by
      `./infra/staff-add.sh staging <email> ADMIN` — execution `dona-staging-staff-add-lq6v8`,
      `staff:add: added · wilder.netboost@gmail.com · ADMIN`, exit 0. 5.1b had carried "how does a
      row reach the staging database" to 5.9 as an open question; it was never open, because
      `.github/workflows/deploy.yml:72` had been answering it for migrations since slice 1.6. So
      **all that remains here is the click**, on
      `https://dona-staging-r44j24yuaa-zf.a.run.app/staff/login` — **and the director clicked it on
      10 Sep 2026, landing on `/staff` as ADMIN against revision `06ec20c`. The step 5.1 opened and
      5.1b carried is closed**, in `tasks/evidence/5.1.md`.
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

- [x] **5.1b — The credential is Google's, and the TOTP machinery goes.** **Closed 10 Sep**
      ([evidence/5.1b.md](evidence/5.1b.md)). Ticked here at 5.2b: the evidence was already written
      and the director had signed in on staging; the week list had not caught up. Slice 5.1 is closed; this
      **amends** it rather than reopening it, which is why it carries a letter. Move 1 of the 10 Sep
      re-plan: the director's own worked example was the admin login, and the instinct — *more
      machinery than the job needs* — was right. The correct simplification is not a hand-rolled
      password (that is `docs/from-v3.md` gap 1, the thing v3 failed at) but the opposite direction:
      **delegate the whole credential and delete our screens.** Our password form, our TOTP form,
      the invite URL, the enrolment screen and the base32 secret an operator hand-types are replaced
      by **one link → Google → our session** — a server-side OIDC authorization-code flow, one
      redirect, still not one line of client JavaScript. Identity Platform is **dropped entirely**,
      not kept as a directory in front of Google. `google-auth-library` is already a dependency, so
      no new one.
      **The invite becomes a row and `staff_invite` is dropped.** An admin adds `email` + `role`;
      that row *is* the authorisation, and first sign-in fills `idp_local_id`. No token, no expiry,
      no acceptance URL.
      **What is lost, stated plainly: the assertable second factor.** 5.1 refused any ID token
      without `firebase.sign_in_second_factor`; whatever factor Google enforces, we cannot assert
      it. What replaces it is narrower on the other axis — **only an email that already has a
      `staff_account` row may sign in at all**, where before it was anyone Identity Platform knew.
      The allowlist is what makes this safe without Workspace, which **retires open question 12 as a
      blocker** rather than leaving auth waiting on it. `ADR-0005` is where that trade is written
      down.
      **Done when:** an operator added by `npm run staff:add` signs in through Google and holds a
      session; an email with no row, an unverified email, a role-less account and a disabled account
      are each refused with `not_allowed` and nothing more; a replayed or absent `state` is refused;
      and `grep -rn "totp\|mfa\|otpauth" src/` returns nothing.
      **Verify:** every refusal committed **red first**; `npm run migrate` leaves **26 tables** with
      no `staff_invite`, no `outbox` and no `idempotency_keys`; and the sign-in is clicked on `:3000`
      against the real Google client, not the fake — 5.1 found two defects the fake could not have.
      **One manual step, the director's:** Google exposes no API for creating an OAuth 2.0 Web
      client, so a human creates it and the consent screen once per project (~10 minutes) and
      `bootstrap.sh` **documents** that rather than pretending to do it — `bootstrap.sh:222`'s own
      lesson. The two secrets reach the system through `infra/set-secret.sh` and nowhere else.
      **Carried in from 5.0-cut:** `0022_` drops `outbox` and `idempotency_keys` where they still
      stand, and `assignRole` gets the first caller 5.0-cut said it was owed.
      **Two of the re-plan's own instructions are corrected here**, in the shape 5.0-cut used:
      squashing `staff_invite` out of `0021_` cannot work — staging applied `0021_` at the 5.1 deploy
      and the ledger has no checksum, so the edit would reach nothing and leave staging with
      `idp_local_id NOT NULL` and a first sign-in that fails on an INSERT. Hence a forward `0022_`,
      and `0021_` left standing as the record of what every environment actually ran. And "25 tables
      → 24" is **27 → 26**: 5.0-cut removed two tables, not three.
      **Plan mode. Deps:** 5.1 · **M**

- [x] **5.2 — The screens go behind the session, and the write route gets a token that means
      something. CLOSED 10 Sep** — [evidence/5.2.md](evidence/5.2.md). 487 code + 41 hooks + 50
      policy, 0 failed. Two cases red first; a third was written because clicking `:3000` found a
      screen serving an **empty** token that every gate had passed. **The never-a-name rule was
      KEPT** and the wording tightened to *a tenant's name*; reconsidered at 5.4. Both halves in one change, plus the bound none of 3.3's bounds are: a **per-caller**
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
      **Carried in from 5.1, amended by 5.1b, three things.** (1) **The CSRF token's scope is every
      write route and not only `POST /documents`** — after 5.1b the staff module has exactly two:
      `POST /staff/operators` and `POST /staff/logout`. The two new GETs, `/staff/auth/start` and
      `/staff/auth/callback`, are deliberately **outside** the token's scope: they change no row of
      ours, and `state` is the anti-forgery value that flow carries by construction. 5.1 built no
      half of a token; what stands in for one until this slice is `SameSite=Lax` on the session
      cookie, which is stated as the defence it is in `SPEC-staff.md`. (2) **The guard is
      `requireStaff` from `src/staff/contract.ts`, called once per route and never re-implemented** —
      the same rule `tests/ui/tokens.test.ts`'s `SCREENS` registry carries, for the same reason.
      (3) **The staff screens are already in that registry** — two of them after 5.1b, where four
      were deleted with the flow they belonged to; week 5's remaining screens append beside them.
      **Plan mode. Deps:** 5.1 · **L**

- [x] **5.2b — One chrome on every signed-in screen.** The session arrived at 5.2 and each module
      kept writing its own bar: the index had staff and sign-out; estate had search and neither;
      evidence had three links and no search; staff home had no chrome at all. Sign-out existed on
      two screens. **This slice does not redesign cards** and is not 5.9's seven-tab shell.
      **Done when:** every authenticated screen carries the same bar — buildings, expiring,
      incomplete, search, staff, sign-out — and the login screen carries none of it.
      **Verify:** `tests/ui/tokens.test.ts` asserts the chrome over the signed-in registry and its
      absence on login; restart `npm run dev` and sign out from a **non-index** screen.
      **The M1 “no UI-pass” call is reversed only this far** — chrome and shared controls, so an
      operator can leave any screen. Reconsidered again at M2 / 5.9.
      **Plan mode. Deps:** 5.2 · **M**

- [x] **5.2c — v3's ops shell on v5's live URLs.** 5.2b put one bar on every signed-in screen; it
      was still a top bar, so the console did not look like the temp admin v3 already had. **This
      slice does not add unbuilt tabs** and is not a card redesign.
      **Done when:** every authenticated screen is the ops sidebar (buildings, expiring, incomplete,
      search, staff, sign-out in the footer); the current destination is marked; login has no rail.
      **Verify:** the token registry asserts `.ops`, the live hrefs, one `aria-current` except on
      the index, and login without any of it; restart `npm run dev` and sign out from a **non-index**
      screen. No push until the director approves localhost.
      **Plan mode. Deps:** 5.2b · **M**

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
      **Carried in from 5.2, two things.** (1) **`request.staff` is set on every guarded route and
      read by exactly one handler** — `POST /documents`, for the cap and the audit line. Every other
      write route still records a *user-typed* name: `confirmed_by`, `promoted_by`, and the
      exception's `actor: 'console'`. This is the slice that owns provenance, so it is the slice that
      decides whether those become the signed-in operator or stay snapshot strings on purpose.
      (2) **The never-a-name rule is reconsidered here**, because this slice is already deciding what
      a session unlocks. 5.2 kept it and said why; keeping it a second time is an answer, and so is
      lifting it — what is not allowed is it lapsing.
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
      **Carried in from 5.2: the route→permission mapping is a first cut and nothing tests that it
      is the *intended* one.** 22 routes each declare a permission or `public`, and the boot check
      proves every route declares *something* — it cannot prove `/documents/:id/promote` should ask
      for `tenancy.write` rather than `documents.write`. This is the first slice with an operator
      looking at the matrix, so it is the slice that reads the mapping back and says whether it is
      the one meant. **The public list is 7 and is asserted exactly** in `src/guard.test.ts`; a
      change to it is a decision, not a diff.
      **Verify:** add one of each on staging; a role without the permission is refused with
      `not_allowed`; grep the screen for `asset_type` and find nothing; the route→permission mapping
      is read back against the matrix on screen and either confirmed or corrected in writing.
      **Deps:** 5.1, 5.7 · **M**

---

---

## The 10 Sep re-plan, and where each of its moves now lives

The re-plan the director stopped the build for is Moves 0–4. Move 0 is **5.0-cut**, closed. Move 1 is
**5.1b**, above. The rest are recorded here so that nothing it decided is owned only by a plan file
outside the repository ([docs/pipeline.md](docs/pipeline.md) §8, §10):

- [ ] **Move 2 → new slice `5.9`: unbuilt tabs, where the navigation *is* the plan.** The ops
      frame itself landed at **5.2c**. This slice adds the destinations that do not exist yet —
      seven tabs at the composition root (the kernel must not learn a route); an unbuilt tab
      renders one line naming the week and slice that owns it, so **the remaining roadmap is on
      screen**. Written into the slice list when the chore below runs. **It inherits an answer
      rather than a question:** 5.1b carried "how does an operator row reach the staging database"
      here, and 5.1c closed it — `./infra/staff-add.sh <env> <email> <ROLE>` runs `staff-add.ts` as
      a one-off Cloud Run job on the deployed image. This slice adds operators, it does not have to
      invent how.
- [ ] **Move 3 → chore, before 5.9: the mockup-first slice contract.** `mockups/<slice>.html` through
      the real page shell on a dev-only route, `data-state="wired" | "painted"`, and a guard in
      `scripts/guards.ts` that fails the build when a mockup and its evidence file both exist. With
      it: `tasks/todo.md` holds the current week only, `tasks/roadmap.md` stops being retrospective,
      evidence files are capped at ~40 lines, and `CLAUDE.md` gains the gate. **5.1b adopts the
      evidence cap early**; the rest is that chore's, because restructuring three plan files inside
      an auth slice is how both jobs get done badly.
- [ ] **Move 4 → the reorder.** `5.2` keeps its place; then `5.9` → `6.1` → `6.2` → `6.3` → `7.1` →
      `7.2`, which is the first thing in this project the director can judge by looking. The
      deferrals it decided, each with its new owner: **5.3 → week 9** (no agent exists to reach
      `national_id` before week 10) · **5.7 → folded into 6.1**, its first reader · **5.4, 5.5, 5.6 →
      post-7.2** · **5.8 → cut**, and it becomes the `הגדרות` stub tab in 5.9 under
      [SPEC-flows.md](../SPEC-flows.md):16. The slice list below still reads in the old order and is
      rewritten by the Move 3 chore, not here.
- [ ] **One dependency to re-check before week 6 starts:** `roadmap.md:1604` gives 7.1 a dependency on
      **6.6**, which the order above does not reach. Either 7.1's dependency is really 6.2, or 6.6
      comes forward. Resolved when 6.1 is taken.

---

**Cut line, in order:** **5.8** first — the catalogue keeps its seed for another week, which is the
honest state it has been in since week 3 and not a regression. Then **5.7** — obligations slide into
week 6, which is lighter. **Never 5.1 or 5.2**: every week after this one assumes the session, and a
week 6 that starts without it inherits an unauthenticated console with a responsibility matrix
behind it.

**M2 is at the end of week 8**, not this week. Its boxes: the console usable on its own · all five
policy cases green, each red first · weeks 9–12 decomposed before week 9's Monday.
