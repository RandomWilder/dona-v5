# SPEC: staff

The admin edge — authentication, sessions, roles, and the invite that creates an operator. **Not a
domain module**: it owns none of E1–E16, and it owns no fact about a building, a household or a
piece of paper. Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here.

- **Owns:** the operator's identity, the session that carries it, the role matrix, and the invite.
- **Entities:** none of E1–E16. Its three tables — `staff_account`, `staff_session`, `staff_invite` —
  are the mechanism's own and appear in no entity catalogue.
- **Depends on:** kernel. Nothing else, and nothing depends on it before slice 5.2.
- **Built:** slice 5.1, lifted from v3 and extended ([docs/from-v3.md](docs/from-v3.md) Tier 2) with
  MFA and an invite flow. The `national_id` field guard is **5.3**.

---

## What this module is for, and what it is not

Until slice 5.1 this system had never had a session. Seven routes had served unauthenticated since
week 1 — `/`, `/estate`, `/estate/buildings/:id`, `/estate/search`, `/estate/expiring`,
`GET /documents/new` and `POST /documents` — deliberately, on fixture data, and stated in six files
rather than hidden in one. **5.1 builds the mechanism; 5.2 puts those routes behind it.** A reader
who finds an unauthenticated estate route in a tree that already contains this file is looking at a
commit between the two, not at an omission.

This module answers exactly three questions and refuses to answer a fourth:

1. Who is making this request? (a session, or nobody)
2. What is that person allowed to do? (a role, resolved against a matrix in code)
3. How does a new operator come to exist? (an invite, accepted, with a second factor enrolled)

The fourth — *what may this person see about a particular tenant* — is **`src/scope/`'s and nobody
else's** (foundation rule 1). A staff role never widens or narrows the isolation join. The two
mechanisms are deliberately independent: one says whether a request has an operator behind it, the
other says which rows a tenant's phone number reaches. Collapsing them would put a staff permission
on the path that decides tenant isolation, and that path has exactly one file.

---

## Identity Platform holds the credential; the session is ours

**Identity Platform is the identity provider and the second factor.** It holds the password and the
TOTP secret, it counts its own abuse, and it mints an ID token. This system holds none of those
things — there is no password hash in this repository's schema, and there is no TOTP secret either.

**The session is ours.** An Identity Platform ID token is a JWT with a one-hour life that this
application cannot revoke, and handing it to a browser as a cookie would mean an operator who is
dismissed at 09:00 still holds authority until 10:00. So the ID token is consumed once, at the end
of sign-in, and never stored or re-presented: what the browser carries afterwards is an opaque
32-byte token this system minted, can expire on its own clock, and can revoke in one row.

The division is the settled one from Stack Map §3.1 and `docs/from-v3.md` Tier 2, and it is the
answer to that document's gap 1 — *v3 hand-rolled email + password and had no MFA*.

### The second factor is TOTP, and that is a consequence of the no-JavaScript rule

Identity Platform offers two second factors. **SMS requires a reCAPTCHA token minted in the browser
by Google's JavaScript SDK.** `SPEC.md` says the UI is self-contained HTML plus `/ui/tokens.css` and
nothing else, and `tests/ui/tokens.test.ts` fails the build on a `<script>` in any screen. An SMS
second factor would therefore have cost this system its first client-side dependency, on the very
screens that guard everything else.

**TOTP's REST endpoints need no reCAPTCHA**, so the whole flow — sign-in, the second factor,
enrolment — is server-side, and every staff screen is a plain HTML form like every other screen in
this repository. It costs nothing per sign-in, where SMS costs a message. The trade accepted with
open eyes: TOTP is a genuine second factor and is not phishing-resistant, where a passkey would be.
When Dona Dom's Workspace answer lands (open question 12) the whole of this section is reconsidered,
because Workspace SSO would move the second factor to Google's own and cost nothing.

### "Enforced, not offered" is a claim this module makes twice

- `infra/bootstrap.sh` sets the Identity Platform project config to `mfa.state = MANDATORY` — the
  enum's name for enforced — with the TOTP provider, and disables public sign-up so the API key
  cannot self-register an account. **The script reads the config back and exits 1 if it did not
  take**, because the first version of that block PATCHed `ENFORCED`, got a `400`, exited 0 (an HTTP
  error is not a transport error) and left MFA *disabled* while printing success. A configuration
  step that cannot fail the run is decoration — slice 1.2's lesson about hooks, in another costume.
- **And this module refuses any ID token that does not carry `firebase.sign_in_second_factor`.**

The second is the one with a test behind it. A console checkbox — or a `PATCH` in a shell script no
test runs — is a configuration this repository cannot assert, and *the claim is what the code
refuses* is the same principle that put `document_is_immutable` in the database at slice 3.1 rather
than in a comment. A password sign-in that returns an ID token directly means the account has no
second factor, and that response is refused.

---

## The refusal says `not_allowed` and nothing more

Three different facts produce the same answer, byte for byte:

- the Identity Platform account signed in, and no `staff_account` row names its uid;
- the row exists and its `role` is null;
- the row exists, has a role, and is disabled.

An operator learns what they may do from the board, not by probing sign-in. A refusal that
distinguished *no such account* from *account with no role* would be an account-enumeration oracle
sitting on the login screen of a system holding 1,500 households, and the distinction buys the
honest user nothing they cannot get by asking a colleague. The body is a frozen constant, asserted
in a test as identical across all three cases; `SPEC.md`'s error shape gives it `code:
'not_allowed'`, and it carries no `details`.

Bad password and bad TOTP code answer the same way for the same reason.

---

## The role matrix is code, not a config row

A deliberate exception to *policies are data* (`SPEC.md` rule 8), and v3 stated the reason exactly
right: **an access-control matrix that a database write could widen is a privilege-escalation path
wearing the clothes of a setting.** Changing who may mutate should cost a deploy and leave a diff
that a reviewer reads.

So `src/staff/internal/roles.ts` holds a frozen constant and there is no table it is read from, no
`config_settings` key that tunes it, and no admin screen that edits it — **including slice 5.8's
settings screen**, which manages the `ObligationType` and `DocumentType` catalogues and must never
grow a third card for this one. `staff_account.role` is `CHECK`ed against exactly the role names the
constant defines, so a hand-written `UPDATE` cannot even name a role the code does not know.

Three roles, and the permission names are the vocabulary the rest of the console will guard with:

| | `ADMIN` | `OPERATOR` | `VIEWER` |
|---|---|---|---|
| `estate.read` | ✓ | ✓ | ✓ |
| `documents.read` | ✓ | ✓ | ✓ |
| `documents.write` | ✓ | ✓ | |
| `tenancy.write` | ✓ | ✓ | |
| `settings.write` | ✓ | | |
| `staff.invite` | ✓ | | |
| `party.national_id.read` | ✓ | | |

`party.national_id.read` is here and unused at 5.1, and that is on purpose: `SPEC.md`'s security
default says `national_id` is **admin-only, unreachable by any agent tool, and access-logged**, and
the "admin-only" half needs a permission to name before **5.3** can write the policy case that
enforces the "unreachable" half. A permission with no reader is a smaller lie than a security
default with no vocabulary.

---

## The session, and what the database is not allowed to hold

**`staff_session` stores `token_hash` and never the token.** Reading the table — a backup, a `SELECT`
by a support engineer, a leaked pg_dump — gives an attacker nothing to ride, because the value in
the column is a SHA-256 digest and the cookie is its preimage.

- The token is **32 bytes from `node:crypto`'s CSPRNG**, base64url, generated once, returned to the
  caller once, and never held anywhere afterwards.
- The column is `sha256(token)`, hex.
- **There is no pepper, and that is a decision rather than an omission.** A pepper defends a secret
  whose preimage space can be searched — a password, a six-digit code, a phone number. This token
  has 256 bits of entropy, so an attacker holding the hash has nothing to search. Adding a pepper
  would add a secret to rotate, a rotation path to own, and a way to lock every operator out of a
  running system, in exchange for nothing.
- **The invite token is the same shape**, hashed the same way, for the same reason.
- Lifetimes: **12 hours absolute**, **60 minutes idle**. Both from the injected clock, so a test can
  walk a session to its expiry without sleeping. `revoked_at` makes sign-out a row update rather
  than a hope that the browser dropped the cookie.

`tests/policy/staff-session.test.ts` is the standing form of this rule: **no column anywhere in this
database whose name contains `token` may be anything but a `_hash`.** It builds its own violating
fixture — a table with a bare `token` column, inside a rolled-back transaction — and asserts the
check catches it, then asserts the real schema has none. That is the shape `tests/policy/guards.test.ts`
uses, and it is what stops the check being quietly defanged by a later refactor that would otherwise
leave a green suite behind it.

The pending credential Identity Platform returns between the password step and the TOTP step is a
bearer credential too, and it **never enters the database**: it lives in a hidden field on the
second-factor form for the sixty seconds that flow takes, which is Google's own short-lived
credential going straight back to Google.

### The cookie

`dona_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. `SameSite=Lax` is this slice's real
cross-site defence and is stated as such: a cross-origin form POST does not carry the cookie.

**There is no CSRF token at 5.1, and that is slice 5.2's**, which owns "the write route gets a token
that means something". Building half of one here — a token on the staff forms and none on
`POST /documents` — is precisely the drift that moving the page shell into `src/kernel/ui/page.ts`
existed to prevent. When 5.2 lands, `POST /staff/invites` and `POST /staff/logout` are inside the
token's scope with every other write route, and this paragraph is deleted rather than amended.

---

## The invite flow, and the first operator

**An invite is a printed one-time URL, never an email.** This system has no mail transport, and
acquiring one is an external dependency with its own DPA, its own deliverability problem and its own
fuse — not something a slice about sessions quietly adds. The inviter sees the URL on their own
screen and hands it over by whatever channel they already trust. Recorded here as the honest state:
when a mail path exists, the invite becomes a message and this sentence changes.

Accepting an invite is three steps and one row:

1. **Set a password.** The Identity Platform account is created through the **admin** endpoint under
   the runtime service account's ADC — never through the public sign-up endpoint, which stays
   disabled, so possession of the API key is not possession of an account.
2. **Enrol the second factor.** The screen renders the base32 shared secret and the `otpauth://` URI
   **as text**. There is no QR code, because a QR needs either a canvas — client JavaScript, refused
   above — or an encoder this repository would have to take as a dependency to save an operator
   fifteen seconds of typing, once, ever.
3. **Confirm with the first code.** Only when enrolment finalises does the `staff_account` row
   receive its role.

That ordering is the same sentence as *enforced, not offered*, read from the other end: **an account
that never enrolled a second factor never acquires a role**, so the refusal path and the enrolment
path cannot disagree.

**The first operator comes from `npm run staff:invite <email> <role>`**, which writes the invite row
and prints the URL. There is no seeded credential, and `infra/bootstrap.sh` creates none — which is
slice 1.5's argument honoured rather than reversed: *a generated credential that nothing reads and
no rotation flow owns is worse than an absent one*. What bootstrap creates is exactly what this
mechanism needs and nothing it does not: the Identity Platform config, and one API key in Secret
Manager.

---

## Configuration

One new secret per environment, `<env>-identity-api-key`, bound `secretAccessor` to `app-<env>` per
secret, as every other secret in this system is (ADR-0003, never at project level). It reaches the
process as `IDENTITY_API_KEY`; `GOOGLE_CLOUD_PROJECT` names the project the Identity Platform
tenant lives in and is already injected.

**Absent the key the provider is `unconfigured`, and it says so** — the same shape `ObjectStore`,
`OcrText` and `Extractor` already use, and for the same reason: `npm run dev` on a clean clone must
start, and a deployed revision that signs nobody in must be visibly different from one that does.
`src/serve.ts` prints `identity:` on its boot line beside `docs:`, `ocr:` and `extract:`, so
`identity: unconfigured` on a staging revision is as wrong as a `-dev` version string, and is
readable without a login attempt.

The provider is an **injected port**, `IdentityProvider`, so every contract test in this module runs
the whole sign-in, refusal and enrolment flow against a fake with no network and no key. What the
tests never fake is the shape of the refusal: the fake returns Identity Platform's own response
bodies, including the one that carries an `idToken` with no `sign_in_second_factor`.

---

## Auditing

Every sign-in, refusal, sign-out, invite and enrolment writes an `audit_log` line through the
kernel's `around()` — `actorKind: 'staff'`, `actorRole` the role when there is one. **The email is
not in the line.** `SPEC.md`'s security default is *PII never in logs*, and the audit row names the
`staff_account_id`, which resolves to a person for anyone entitled to resolve it and to nobody else.
A failed sign-in for an address that matches no account names no subject at all, which is the same
non-answer the screen gives.

---

## What this module deliberately does not do yet

- **Guard the seven unauthenticated routes.** Slice 5.2, with the CSRF token and the per-caller
  upload bound in the same change.
- **Enforce `national_id`.** Slice 5.3, as a policy case, red first.
- **Rotate or expire a password.** Identity Platform owns the credential; a rotation policy is a
  decision for the week Dona Dom's own staff are on the system, not a default invented here.
- **Send anything.** See the invite flow above.
