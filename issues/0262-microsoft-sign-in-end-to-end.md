---
number: 262
title: Microsoft sign-in end to end
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [259, 261]
parent: 258
created: 2026-10-18
closed: 2026-10-18
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

A staff member whose `@dona.co.il` address has a staff account can sign in with Microsoft and land on
the staff home with their role, through a Microsoft start route and a Microsoft callback route of
their own. The start route redirects to Dona Dom's tenant-specific authority with an account chooser,
scope `openid email`, and the same state-and-nonce cookie Google uses. The callback exchanges the
code server-side, verifies the ID token's signature, audience, expiry and issuer against the tenant's
published keys (no new dependency), applies the pure acceptance rule (nonce, tenant, issuer, address
present and exactly in the configured domain), and hands the identity to the shared sign-in step from
#261, bound as `ms:<tenant>:<object id>`.

With any of client id, secret, tenant or domain missing, Microsoft is unconfigured: both routes answer
unavailable and the boot line says `microsoft:unconfigured`. Shown without the button: open the start
route directly.

## Acceptance criteria

- [x] A policy case, red before the code exists: a Microsoft sign-in from a foreign tenant, or with an address outside `dona.co.il`, is refused even when a staff account names that address.
- [x] A listed `@dona.co.il` address signs in with Microsoft and gets its role's permissions; the first sign-in binds the account.
- [x] Look-alike domains (`x@evil-dona.co.il`, `x@dona.co.il.evil`), a personal Microsoft account, a nonce mismatch and a missing address are all refused.
- [x] A Google-bound account refuses a Microsoft sign-in for the same address, and a Microsoft-bound account refuses Google.
- [x] Every Microsoft refusal is byte-identical to the Google refusal.
- [x] Microsoft sign-ins and refusals are audited under the same actions as Google's and count towards the same lockout.
- [x] Unconfigured: routes answer unavailable, the boot line says so, and the app starts on a clean clone.
- [x] The boot line never prints the client secret.
- [x] Existing Google tests pass with no diff to them.

## Blocked by

- #259 — ADR-0018 and the spec and glossary amendments
- #261 — Prefactor: one shared sign-in tail

## Comment — 2026-10-18

A `@dona.co.il` address with a staff account can sign in through Microsoft's own start and callback. The start redirects to Dona Dom's tenant authority with an account chooser, scope `openid email`, and the same state-and-nonce cookie Google uses. The callback exchanges the code, checks the token's signature, audience, expiry and issuer against the tenant's published keys with the library already in the process, then applies the pure rule: nonce, tenant, issuer, and an address whose domain is exactly the configured one. The binding written on first sign-in is `ms:<tenant>:<object id>`. A foreign tenant, a personal Microsoft account, a look-alike domain, a missing address, a nonce mismatch, and a row already bound to the other provider are the same refusal Google already gives. Sign-ins and refusals share Google's audit actions and the one lockout counter; a token that has not been accepted does not spend that counter. Missing the client id, the secret, the tenant or the domain leaves both routes unavailable and the boot line `microsoft:unconfigured`, and that line does not contain the secret. The Google route and identity tests are unchanged. The full suite still fails on the pre-existing `building_address_unique` cases, plus a calls count and a screen-crawl cap that this change does not touch.
