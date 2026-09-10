# ADR-0005 — The staff credential is Google's, and this system asserts an allowlist instead of a second factor

- **Date:** 2026-09-10
- **Status:** accepted
- **Context slice:** 5.1b — amending 5.1, which shipped the arrangement this replaces
- **Supersedes:** the identity half of `SPEC-staff.md` as written at slice 5.1. Nothing in ADR-0001–0004 changes.

## The decision

1. **Staff sign-in is Google, through the standard OIDC authorization-code flow, server-side.** One
   link, one redirect, one code exchange, one verified ID token. No client JavaScript, no SDK in the
   browser, and no new runtime dependency — `google-auth-library` was already in this repository.
2. **Identity Platform is dropped entirely**, rather than kept as a directory in front of Google.
3. **This system no longer asserts the second factor.** Whatever Google enforces on the account is
   what protects it, and we cannot inspect it in a way we may rely on.
4. **What we assert instead is an allowlist**: only an email that already has a `staff_account` row
   may sign in at all, and that row is bound to the first Google `sub` that ever uses it.
5. **`STAFF_GOOGLE_HD`, optional**, adds the Workspace domain as a second condition when Dona Dom's
   Workspace answer lands. Unset is the honest default until it does.

## Context

Slice 5.1 put Identity Platform between this system and Google: our password form →
`signInWithPassword` → `mfaPendingCredential` → our TOTP form → `mfaSignIn:finalize` → our session,
with an invite URL, an enrolment screen, and a base32 shared secret an operator hand-typed because a
QR code needs client JavaScript this repository's UI rule forbids. It worked, it was proved against
the live provider, and it found two real defects a fake could not have.

It was also five screens and 700 lines managing a credential we had already decided not to hold. The
director's own worked example, on stopping the build at 5.1, was this login: *more machinery than the
job needs.* The proposed replacement — hand-rolled email, password and an emailed code — is **more**
code and is precisely [from-v3.md](../from-v3.md)'s gap 1, the thing v3 failed at. The simplification
that is actually available runs the other way: delegate the whole credential and delete the screens.

## The trade, stated as a ledger

| Property | 5.1 | after 5.1b |
|---|---|---|
| password hash in our schema | none | none |
| second factor | TOTP, **asserted by us** from `firebase.sign_in_second_factor` | Google's, **whatever the account has — we cannot assert it** |
| who may sign in | anyone Identity Platform knew, public sign-up disabled | **only an email with a `staff_account` row** — an allowlist, strictly narrower |
| our session | opaque 32-byte token, sha256 at rest, 12h absolute / 60min idle, revocable in one row | **unchanged** |
| phishing resistance | none | none from us; Google-side passkeys give it at no cost to this repository |
| client JavaScript | none | none |
| external moving parts | Identity Platform project config, an API key in Secret Manager, 378 lines of adapter | an OAuth client, two secrets, ~110 lines |

**The loss is real and is not being talked around.** An assertable second factor is a property a
dispute can be shown; "Google enforced something" is not. Three things make the trade acceptable:

1. **The population shrank.** The old fence was *public sign-up is disabled*, which is a setting in
   someone else's console. The new fence is a row a human wrote in our database, and a stranger with
   a Google account reaches the same refusal as a stranger without one.
2. **The factor did not disappear — the assertion did.** Google enforces 2-Step Verification on the
   accounts that have it, and enrolling passkeys there is an act in Google's console that costs this
   system nothing. Where the old design paid 700 lines to *prove* a weaker factor, the new one pays
   nothing to *inherit* a possibly stronger one.
3. **The alternative that keeps the assertion keeps everything else too.** Retaining Identity
   Platform to read one claim means retaining the project config, the API key, the adapter and the
   enrolment screen — and the enrolment screen is where the machinery actually hurts, because it is
   what every new operator meets on their first day.

## What was rejected

- **Hand-rolled email + password + emailed code.** More code, a mail transport with its own DPA and
  deliverability problem, and a password hash in a schema that has never had one. This is v3's gap 1.
- **Keeping Identity Platform in front of Google.** Pays the full cost of the dependency for one
  claim, and leaves the TOTP enrolment screen standing.
- **Waiting for the Workspace answer (open question 12).** It would have left auth blocked on a
  question nobody was being asked. The allowlist makes personal Google accounts safe enough for three
  operators in one office, and `STAFF_GOOGLE_HD` is one environment variable the day the answer
  arrives.

## Consequences

- **Open question 12 stops blocking anything.** It becomes a configuration value, not a design.
- **The invite is deleted, not replaced.** An admin adds an email and a role; nothing has to be
  delivered to the new operator. The "a staff invite is a printed URL because we have no mail
  transport" item carried since 5.1 is retired rather than owned.
- **One manual step exists and is documented rather than faked.** Google exposes no API for creating
  an OAuth 2.0 Web client or its consent screen; `infra/bootstrap.sh` prints the step and the exact
  redirect URIs and does not pretend to perform it.
- **Staging and prod share one OAuth client** while they share one GCP project, exactly as they
  shared one Identity Platform tenant. Unchanged in substance, still owned by week 12, decided beside
  the prod restart and the F7 organisation move.
- **`tests/policy/` is untouched.** No policy case asserted a second factor: the MFA assertions lived
  in `src/staff/identity.test.ts` and `routes.test.ts`, which is where the new refusals live too.
