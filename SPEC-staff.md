# SPEC: staff

The admin edge — authentication, sessions, roles, and the row that makes somebody an operator. **Not
a domain module**: it owns none of E1–E16, and it owns no fact about a building, a household or a
piece of paper. Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here.

- **Owns:** the operator's identity, the session that carries it, the role matrix, and the operator
  row.
- **Entities:** none of E1–E16. Its two tables — `staff_account`, `staff_session` — are the
  mechanism's own and appear in no entity catalogue.
- **Depends on:** kernel. Nothing else. **Every other module depends on it from slice 5.2**, which
  put every route in the application behind `requireStaff` and every write route behind a CSRF
  token derived from the session.
- **Built:** slice 5.1 on Identity Platform, with a password form, a TOTP form and an invite flow.
  **Amended at slice 5.1b**, which deleted all three and made the credential Google's. The
  `national_id` field guard is **5.3**.

---

## What this module is for, and what it is not

Until slice 5.1 this system had never had a session. Seven routes had served unauthenticated since
week 1 — `/`, `/estate`, `/estate/buildings/:id`, `/estate/search`, `/estate/expiring`,
`GET /documents/new` and `POST /documents` — deliberately, on fixture data, and stated in six files
rather than hidden in one. **5.1 built the mechanism; 5.2 put those routes behind it** — and not
only those seven. The application had twenty-two routes by then, and guarding the seven that had
been named while leaving `/estate/units/:id`, `/estate/incomplete` and the four
`/documents/:id/...` screens open would have satisfied the sentence and defeated it.

**The stance is declared at the route and enforced in one place.** Every route in this application
carries `config: { staff: <permission> }` or `config: { staff: 'public' }`, an `onRequest` hook in
the composition root calls this module's `requireStaff` with whatever the route declared, and an
`onRoute` hook **refuses to start the application** if a route declares neither. The default is
therefore deny, and a route that is open is open because somebody wrote the word `public` next to
it. That inversion is the whole point: the seven routes were not open because anyone decided they
should stay open, they were open because being open was what happened when nobody said otherwise.

This module answers exactly three questions and refuses to answer a fourth:

1. Who is making this request? (a session, or nobody)
2. What is that person allowed to do? (a role, resolved against a matrix in code)
3. How does a new operator come to exist? (an admin adds a row; the person signs in with Google)

The fourth — *what may this person see about a particular tenant* — is **`src/scope/`'s and nobody
else's** (foundation rule 1). A staff role never widens or narrows the isolation join. The two
mechanisms are deliberately independent: one says whether a request has an operator behind it, the
other says which rows a tenant's phone number reaches. Collapsing them would put a staff permission
on the path that decides tenant isolation, and that path has exactly one file.

---

## Google holds the credential; the session is ours

**The credential is Google's, entirely.** This system has no password hash, no TOTP secret, no
password form and no second-factor form. Sign-in is the standard OIDC authorization-code flow: a
link to `accounts.google.com`, a redirect back with a code, one server-side exchange, one verified
ID token — and from that point the browser carries nothing but this system's own session cookie.

**The session is ours**, and that half is unchanged from 5.1. A Google ID token is a JWT with an
hour's life this application cannot revoke, and handing it to a browser as a cookie would mean an
operator dismissed at 09:00 still holds authority until 10:00. So the ID token is consumed once, at
the end of sign-in, and never stored or re-presented: what the browser carries afterwards is an
opaque 32-byte token this system minted, can expire on its own clock, and can revoke in one row.

### Why 5.1b deleted what 5.1 built

5.1 put Identity Platform between this system and Google: our password form → `signInWithPassword` →
`mfaPendingCredential` → our TOTP form → `mfaSignIn:finalize` → our session, plus an invite URL, an
enrolment screen and a base32 shared secret an operator hand-typed because a QR code would have
needed the client JavaScript `tests/ui/tokens.test.ts` fails the build over.

Every one of those screens exists to manage a credential we had already decided not to hold. Once
the credential is Google's, Identity Platform is a directory in front of Google that costs a project
config, an API key in Secret Manager, a bootstrap block and 378 lines of adapter, and buys nothing.
**So it is dropped rather than kept.** What replaces it is one redirect and `google-auth-library`,
which was already a dependency of this repository — the flow is server-side and the screens stay
plain HTML, so the no-`<script>` rule is untouched rather than merely survived.

### The one thing that was lost, and what stands in its place

**5.1 could assert the second factor and this cannot.** It refused any ID token that did not carry
`firebase.sign_in_second_factor`, which is a claim with a test behind it rather than a checkbox in a
console. Google enforces whatever the account has — a passkey, TOTP, a security key, or a password
alone — and does not tell us which in a way this system may rely on.

What replaces it is narrower on a different axis, and is the reason the trade is acceptable:

**Only an email that already has a `staff_account` row may sign in at all.** Before, the population
was everyone Identity Platform knew, with public sign-up disabled as the fence. Now it is an
allowlist a human wrote, one row at a time. A stranger with a Google account reaches exactly the
same refusal as a stranger without one.

The trade, the alternatives weighed and the compensating controls are written down once, in
[ADR-0005](docs/decisions/ADR-0005-the-credential-is-google-s.md), so it is cited rather than
relitigated. Two consequences are worth stating here because they change what other files may
assume:

- **Open question 12 — is Dona Dom on Google Workspace — stops being a blocker.** The allowlist
  makes personal Google accounts safe enough for three operators in one office. If the Workspace
  answer arrives, `STAFF_GOOGLE_HD` turns the domain into a second condition, and that is a
  configuration value rather than a rewrite.
- **Phishing resistance is Google's to give.** This system cannot make sign-in phishing-resistant
  and no longer pretends to; enforcing passkeys on the accounts is an act in Google's console, and
  it costs this repository nothing.

### `state`, `nonce`, and what the callback refuses

The flow carries two random values, both 32 bytes from the CSPRNG, and **neither ever reaches the
database**: they live in one short-lived cookie, `dona_oauth`, `HttpOnly`, `SameSite=Lax`,
`Path=/`, `Max-Age=600`, `Secure` on the same rule the session cookie uses — dropped only when the
request itself arrived over plain http, which is `npm run dev` and nothing else.

- **`state`** is compared with the value Google hands back on the redirect. Absent, malformed or
  different is a refusal. `SameSite=Lax` is what lets the cookie ride the top-level GET redirect
  back from `accounts.google.com`, which is precisely the case Lax exists to permit.
- **`nonce`** is compared with the claim inside the ID token, which is what makes a replayed token
  useless.

The callback is a GET that changes no row of ours, so it is deliberately **outside** slice 5.2's
CSRF token scope; `state` is the anti-forgery value this flow carries by construction.

---

## The refusal says `not_allowed` and nothing more

Every one of these produces the same answer, byte for byte:

- the Google account signed in, and no `staff_account` row names its email;
- the row exists and its `role` is null;
- the row exists, has a role, and is disabled;
- the token's `email_verified` is false;
- the row's `idp_local_id` is set and is **not** the `sub` that just signed in;
- `state` is missing or does not match; the `nonce` does not match the claim;
- `STAFF_GOOGLE_HD` is set and the token's `hd` is not it.

An operator learns what they may do from the board, not by probing sign-in. A refusal that
distinguished *no such account* from *account with no role* would be an account-enumeration oracle
sitting on the login screen of a system holding 1,500 households, and the distinction buys the
honest user nothing they cannot get by asking a colleague. The body is a frozen constant, asserted
in a test as identical across every case; `SPEC.md`'s error shape gives it `code: 'not_allowed'`,
and it carries no `details`.

**The `sub` mismatch is the sharp one.** An email address can be deleted and re-created — inside a
Workspace by an administrator, and by Google itself for some abandoned accounts. Silently rebinding
the row to the new `sub` would hand a stranger an existing operator's role. So the row is bound to
the first `sub` that ever signs in against it, and re-binding is a deliberate act by an admin, not a
side effect of a login.

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

`staff.invite` keeps its name after 5.1b deleted the invite, because the permission names the
authority — *may add an operator* — and renaming a permission is a schema-shaped change to every
future guard for a word. It is read by `POST /staff/operators`.

`party.national_id.read` is here and unused, and that is on purpose: `SPEC.md`'s security default
says `national_id` is **admin-only, unreachable by any agent tool, and access-logged**, and the
"admin-only" half needs a permission to name before **5.3** can write the policy case that enforces
the "unreachable" half. A permission with no reader is a smaller lie than a security default with no
vocabulary.

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
- Lifetimes: **12 hours absolute**, **60 minutes idle**. Both from the injected clock, so a test can
  walk a session to its expiry without sleeping. `revoked_at` makes sign-out a row update rather
  than a hope that the browser dropped the cookie.

`tests/policy/staff-session.test.ts` is the standing form of this rule: **no column anywhere in this
database whose name contains `token` may be anything but a `_hash`.** It builds its own violating
fixture — a table with a bare `token` column, inside a rolled-back transaction — and asserts the
check catches it, then asserts the real schema has none. That is the shape `tests/policy/guards.test.ts`
uses, and it is what stops the check being quietly defanged by a later refactor that would otherwise
leave a green suite behind it.

The authorization code and the ID token are bearer credentials too, and **neither enters the
database**: the code is exchanged in the request that received it, and the ID token is verified,
read once and discarded in the same request.

### The cookie

`dona_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. `SameSite=Lax` is a real cross-site
defence and is stated as one — a cross-origin form POST does not carry the cookie — but from 5.2 it
is the second of two rather than the only one.

### The CSRF token, and why it is derived rather than stored

**Slice 5.2.** The token is `sha256('csrf:' + <session token>)`, hex, computed from the cookie the
request already carries. It is **never stored**: no column, no second secret to rotate, and
`tests/policy/staff-session.test.ts` — no column in this database whose name contains `token` may be
anything but a `_hash` — stays green by construction rather than by remembering. The session cookie
is `HttpOnly`, so a cross-origin page cannot read the token to derive the value; a page on this
origin can, and a page on this origin could post anyway.

It is one token per session, not one per form. A per-form nonce would need somewhere to live, and
the only somewhere available is the table this module is forbidden to put a token in.

**The scope is every write route in the application**, not this module's alone: `POST /documents`,
`POST /documents/:id/promote`, `POST /documents/:id/seed`, `POST /documents/:id/tenancy`,
`POST /estate/incomplete/:tenancyId/exception`, `POST /staff/operators` and `POST /staff/logout`.
Enforcement is one `preHandler` hook in the composition root, which is why the list above is a
consequence of the method rather than a list anybody maintains.

**The two `GET /staff/auth/*` routes are deliberately outside it.** They change no row of ours, and
`state` — minted into a one-shot `HttpOnly` cookie and compared in constant time — is the
anti-forgery value that flow carries by construction. A CSRF token on them would be a second
mechanism doing the first one's job.

**`POST /documents` is the one route that checks the token inside its handler.** Its body is a
multipart stream, and a `preHandler` that read the field would consume the stream the handler needs.
It declares `csrf: 'in-body'` in its route config and calls the same `verifyCsrf` the hook calls —
one comparison, two call sites, and a test asserts that exactly one route in the application
declares `in-body`.

A screen that renders a `<form method="post">` and no hidden `csrf` input is caught by
`tests/ui/tokens.test.ts` over its whole `SCREENS` registry, which is the assertion that catches the
eighth form rather than the seven that exist today.

---

## The operator row, and the first operator

**An operator is a row an admin wrote.** `POST /staff/operators` takes an email and a role and
writes `staff_account` with `idp_local_id` null; the first Google sign-in against that address fills
it in. That row *is* the authorisation — there is no token, no expiry, no acceptance URL, no
enrolment screen and no message to deliver.

This is what deleted 5.1's honest-but-awkward sentence about invites being printed URLs because the
system has no mail transport. **It still has none, and now needs none**: nothing has to reach a new
operator except the fact, told to them however their colleagues already talk, that they may now sign
in with their Google account.

Adding an address that already has a row is not an error and not a second row: the role is updated,
which is how a promotion, a demotion and a re-grant are all spelled. Withdrawing access is
`role = NULL` or `disabled_at`, and both are refusals on the next request rather than at the next
sign-in, because `requireStaff` re-reads the row every time.

**The first operator comes from `npm run staff:add -- <email> <ROLE>`**, run by a human who can
already reach the database. There is no seeded credential and `infra/bootstrap.sh` creates none —
slice 1.5's argument honoured rather than reversed: *a generated credential that nothing reads and
no rotation flow owns is worse than an absent one*. There is nothing to seed now in any case: the
row carries no secret at all.

**In a deployed environment nobody can reach the database, and that is deliberate.** The connection
string is a unix-socket URL held in Secret Manager and readable only by that environment's runtime
service account, so there is no laptop from which `npm run staff:add` could be pointed at staging
without first taking the credential outside the perimeter. `./infra/staff-add.sh <staging|prod>
<email> <ROLE>` is therefore the deployed form of the same command: it runs `src/staff-add.ts` as a
one-off Cloud Run job, on the image the environment is serving, as that runtime service account,
with the database URL mounted rather than read. It is the shape the deploy workflow already uses to
run migrations, for the same reason. The job is deleted when the run finishes, so no standing button
that writes an `ADMIN` row is left in the project.

---

## Configuration

Two secrets per environment, `<env>-google-oauth-client-id` and `<env>-google-oauth-client-secret`,
bound `secretAccessor` to `app-<env>` per secret, as every other secret in this system is (ADR-0003,
never at project level). They reach the process as `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET`, through `infra/set-secret.sh` and no other door.

- `STAFF_BASE_URL` fixes the redirect URI, which Google matches exactly. Absent, the request's own
  origin is used, which is what `npm run dev` wants and what the invite URL already did at 5.1.
- `STAFF_GOOGLE_HD`, optional: when set, an ID token whose `hd` claim is not that domain is refused.
  Unset is the honest default until Dona Dom's Workspace answer lands.

**The OAuth client itself is created by a human, once per project.** Google exposes no API for
creating an OAuth 2.0 Web client or its consent screen, so `infra/bootstrap.sh` **prints the step
and the exact redirect URIs to register, and does not pretend to perform it.** A configuration step
a script cannot verify is decoration — the lesson `bootstrap.sh` already carries from the Identity
Platform block whose PATCH failed silently at 5.1.

**Absent the two values the provider is `unconfigured`, and it says so** — the same shape
`ObjectStore`, `OcrText` and `Extractor` already use, and for the same reason: `npm run dev` on a
clean clone must start, and a deployed revision that signs nobody in must be visibly different from
one that does. `src/serve.ts` prints `identity:` on its boot line beside `docs:`, `ocr:` and
`extract:`, so `identity: unconfigured` on a staging revision is as wrong as a `-dev` version
string, and is readable without a login attempt.

The provider is an **injected port**, `IdentityProvider`, so every contract test in this module runs
the whole sign-in and refusal flow against a fake with no network and no client secret. What the
tests never fake is the *shape* of the claims: the fake returns Google's own claim names, including
the tokens that carry `email_verified: false` and a mismatched `nonce`.

---

## Auditing

Every sign-in, refusal, sign-out and operator change writes an `audit_log` line through the kernel's
`around()` — `actorKind: 'staff'`, `actorRole` the role when there is one. **The email is not in the
line.** `SPEC.md`'s security default is *PII never in logs*, and the audit row names the
`staff_account_id`, which resolves to a person for anyone entitled to resolve it and to nobody else.
A failed sign-in for an address that matches no account names no subject at all, which is the same
non-answer the screen gives.

---

## What this module deliberately does not do yet

- **Enforce `national_id`.** Slice 5.3, as a policy case, red first.
- **Assert what second factor Google used.** It cannot; see ADR-0005 and the allowlist that stands
  in its place.
- **Send anything.** There is no mail transport, and after 5.1b there is nothing that would need one.
