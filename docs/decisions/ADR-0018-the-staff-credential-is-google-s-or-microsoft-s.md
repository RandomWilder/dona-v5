# ADR-0018 — The staff credential is Google's or Microsoft's

- **Date:** 2026-10-18
- **Status:** accepted
- **Amends:** [ADR-0005](ADR-0005-the-credential-is-google-s.md). The allowlist and the first-identity binding are unchanged and apply to both providers. Everything else in ADR-0005 still binds on the Google path.
- **Context:** #258

## The decision

1. **Staff sign in with Google or with Microsoft.** Google's path is unchanged. Microsoft is a second credential of the same kind: the standard OIDC authorization-code flow, server-side, no client JavaScript, and no password in this schema.
2. **The allowlist is unchanged.** Only an email that already has a `staff_account` row may sign in, with either provider. There is no self-service sign-up.
3. **The first-identity binding is unchanged, and it applies to both.** The row binds to the first identity that signs in against it. One staff account binds to one provider. A Google identity stays the bare subject. A Microsoft identity is `ms:<tenant id>:<object id>`. A mismatch in either direction is a refusal. Switching provider is an admin unbinding the row; a login never does it.
4. **The Microsoft path is single-tenant, and `@dona.co.il` only.** The authority is Dona Dom's Entra tenant. A token from any other tenant is refused, including one whose email claim matches a staff account. The email's domain must equal the configured domain exactly. Personal Microsoft accounts are refused.
5. **The sign-in app is registered separately from the mailbox app.** The mailbox registration holds mail access. The sign-in registration holds `openid` and `email` and nothing else, one registration per environment, in Dona Dom's existing tenant. A change to sign-in cannot stop inbound mail, and the sign-in secret cannot read a mailbox.

## Why the address is trusted only inside that tenant

An email claim is a string an administrator of the issuing directory can set. Another organisation's administrator can put a staff member's address on a user they control. Trusting the address without the tenant would make that user a staff member here. The tenant check is what makes the address Dona Dom's. The domain check is the second gate, so a look-alike address inside the right tenant is still refused.

## What was rejected

- **Personal Microsoft accounts** (outlook.com, hotmail, live). The Microsoft path is Dona Dom's directory, not anyone who has a Microsoft login.
- **Widening the mailbox app registration** so the same app also signs staff in. That registration holds `Mail.Read` and `Mail.Send`. Putting the sign-in redirect and secret on it would let a sign-in change stop the mail, and would put mail access on the secret the login flow holds.
- **A tenant of our own.** Dona Dom already has the directory those addresses live in. A second tenant would be a directory we administer for people who are not ours.
- **Self-service sign-up.** The allowlist is a row an admin wrote. A Microsoft account with no row gets the same refusal as a stranger.
- **Two bindings per account.** A second provider on the same row would be a second door a login could open without anyone deciding to. One account, one credential.
- **A Microsoft auth library as a new dependency.** The code exchange is an HTTPS POST. The ID token is a signed JWT, and `google-auth-library` already verifies one. A second library would be a dependency for a job the first library does.

## Consequences

- No schema change, and no change to how an admin adds a staff account: an email and a role, and the first sign-in binds.
- Missing the Microsoft client id, client secret, tenant id or domain leaves Microsoft unconfigured. The application still starts. Google is unaffected.
- The session stays ours. ADR-0005's loss — this system does not assert the second factor — is unchanged, and it now covers Entra's factor as well as Google's.
