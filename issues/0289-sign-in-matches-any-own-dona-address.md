---
number: 289
title: A Microsoft sign-in matches any address the tenant gave the person, not only the primary one
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 258
created: 2026-10-21
closed:
---

## Parent

#258 — Sign in with Microsoft beside Google.

## Why

In Dona Dom's tenant the people known as `@dona.co.il` have `@donail.onmicrosoft.com` as their
primary address and `@dona.co.il` as an alias. Both domains are verified in the same tenant, and
mail to `@dona.co.il` is delivered by Microsoft 365. The ID token's `email` claim is the primary
address, so the rule #262 shipped — the email claim's domain must be `dona.co.il` — refuses
`asafv@dona.co.il` and, very likely, every member of staff.

The primary address cannot be changed to fix this. The pilot mailbox registration
(`DevMail-DonaAi`) is limited to one mailbox by an Exchange scope filter on `PrimarySmtpAddress`,
and the primary address is the client's tenant decision in any case.

## What to build

After the code exchange, read the signed-in person's own profile from Microsoft Graph
(`GET /me?$select=id,userType,proxyAddresses`) with the access token from the same exchange, under
the delegated `User.Read` permission. The candidate addresses are the person's SMTP addresses —
primary and aliases — whose domain is exactly the configured domain. Exactly one of them must name a
staff account. The tenant, issuer and nonce gates, the `ms:<tenant>:<object id>` binding and the
frozen refusal are unchanged. The sign-in registration holds `openid` and `User.Read`; the `email`
scope is no longer asked for.

## Acceptance criteria

- [ ] SPEC-staff and ADR-0018 say the above before the code does.
- [ ] A person whose primary address is `@donail.onmicrosoft.com` and who has a `@dona.co.il` alias
      signs in against the staff account named by the alias, and binds `ms:<tenant>:<object id>`.
- [ ] Refused with the frozen body: a look-alike alias (`evil-dona.co.il`, `dona.co.il.evil`); a
      guest (`userType` not `Member`); a Graph profile whose `id` is not the token's `oid`; a person
      whose aliases name two different staff accounts; a person with no `@dona.co.il` address.
- [ ] Graph unreachable or answering 5xx is *unavailable*, not a refusal.
- [ ] The access token is never stored or logged.
- [ ] The policy case was red before the code.
- [ ] `infra/bootstrap.sh`, #266 and the Hebrew sign-in guide say `openid` + `User.Read`, and the
      guide no longer asks for a test user whose primary address is `@dona.co.il`.

## Blocked by

None. #266 is blocked by this.
