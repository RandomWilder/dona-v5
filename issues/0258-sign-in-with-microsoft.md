---
number: 258
title: Sign in with Microsoft beside Google
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-18
closed:
---

## Problem Statement

Dona Dom's team works from Microsoft 365 mailboxes at `dona.co.il`. The console only lets a staff
member sign in with a Google account, so somebody whose working identity is their Dona Dom mailbox
either cannot get in or has to keep a Google account just for this. The admin who manages staff
accounts can add an address, but there is no way for a `dona.co.il` address to sign in with the
Microsoft account it already belongs to.

## Solution

The login screen offers two equal ways in: Google, as today, and Microsoft, restricted to Dona Dom's
own Microsoft 365 tenant and to `@dona.co.il` addresses. Nothing about adding a staff account changes:
the admin adds an email and a role, and the person's first sign-in — with whichever provider —
binds the account to that identity. Google sign-in is unchanged in every respect. No self-service
sign-up, no new admin screen, no table change.

## User Stories

1. As an admin, I want to add a `@dona.co.il` address with a role on the staff page exactly as I add a Gmail address today, so that I learn nothing new to let a colleague in.
2. As a Dona Dom staff member, I want a "continue with Microsoft" button on the login screen, so that I sign in with the mailbox account I use all day.
3. As a Dona Dom staff member, I want Microsoft to show me an account chooser every time, so that a shared office laptop never signs me in as whoever was last there.
4. As a Dona Dom staff member signing in with Microsoft for the first time, I want my staff account bound to my Microsoft identity, so that nobody else can later sign in as me.
5. As a staff member, I want to land on the staff home with my role's permissions after a Microsoft sign-in, exactly as after a Google one, so that the provider makes no difference to my work.
6. As a staff member already signing in with Google, I want my sign-in to keep working with no change, so that this feature costs me nothing.
7. As a person whose `@dona.co.il` address has no staff account, I want the same refusal a stranger gets, so that the screen reveals nothing about who has access.
8. As the system's owner, I want a Microsoft account from any other organisation refused even if its email matches a staff account, so that another company's administrator cannot impersonate a staff member by setting an address on a user they control.
9. As the system's owner, I want personal Microsoft accounts (outlook.com, hotmail, live) refused, so that the Microsoft path is only ever Dona Dom's own directory.
10. As the system's owner, I want an address outside `dona.co.il` refused on the Microsoft path even if it has a staff account, so that the first stage is exactly Dona Dom's mail domain.
11. As the system's owner, I want a staff account bound to Google to refuse a Microsoft sign-in for the same address, and the reverse, so that one account has one credential and a second provider is never a silent second door.
12. As an admin, I want switching a person from one provider to the other to be a deliberate act, so that a provider change never happens as a side effect of a login.
13. As the system's owner, I want every Microsoft refusal to be byte-identical to the Google refusal, so that the login screen is not an enumeration oracle.
14. As the system's owner, I want Microsoft sign-ins and refusals in the audit log under the same actions as Google's, so that the record of who entered is one record.
15. As the system's owner, I want failed attempts on the Microsoft path to count towards the same lockout, so that a second provider is not a second budget of guesses.
16. As a developer on a clean clone, I want the app to start with Microsoft unconfigured, the button hidden and the routes answering "unavailable", so that local work needs no Entra registration.
17. As the operator of a deployed revision, I want the boot line to say whether Microsoft is configured, so that a revision that cannot sign Dona Dom in is visibly different from one that can.
18. As an admin, I want a warning on the staff home before the Microsoft client secret expires, so that sign-in does not stop on a date nobody remembered.
19. As the system's owner, I want the Microsoft sign-in app registered separately from the mailbox app, so that a change to sign-in can never stop inbound mail and the sign-in secret carries no mail access.
20. As Dona Dom's Entra administrator, I want a Hebrew guide listing exactly what to create and what to hand over, so that the registration is one short, correct sitting.
21. As the director, I want to click the two-button login screen as a mockup before it is wired, so that the copy and layout are agreed before code depends on them.

## Implementation Decisions

- **Amends ADR-0005** through a new **ADR-0018**: the staff credential is Google's or Microsoft's; the allowlist and the first-identity binding are unchanged and apply to both.
- **Staff module only.** A second identity provider beside the Google one, of the same port shape: an authorization URL builder and a code exchange returning verified claims. Google's provider, routes, cookie and refusal are not modified.
- **Microsoft identity platform v2, OIDC authorization-code flow, server-side, tenant-specific authority** (Dona Dom's tenant id, configured). Scope `openid email`; account chooser forced. No client JavaScript.
- **Acceptance rule (pure):** nonce matches the one this browser started with; `tid` equals the configured tenant; issuer equals that tenant's v2 issuer; `email` present, normalised to lower case, and its domain exactly equals the configured domain (`dona.co.il`). Anything else is the frozen `not_allowed`.
- **Token verification uses no new dependency:** the code exchange is a plain HTTPS POST; the ID token's signature, audience and expiry are checked by the already-present Google auth library's generic signed-JWT verifier against the tenant's published keys, cached and refetched on an unknown key id.
- **Binding:** the staff account's existing identity column holds `ms:<tid>:<oid>` for a Microsoft identity; Google identities keep their bare subject. No schema change, no migration, no data change. A mismatch in either direction is a refusal. Unbinding is a documented admin act (one SQL statement); no screen.
- **Routes:** a Microsoft start route and a Microsoft callback route, distinct from Google's, so each provider has its own redirect URI. The post-acceptance tail (allowlist lookup → usable-account check → bind or mismatch → session mint → audit → redirect) is shared between the two callbacks so the behaviour cannot drift.
- **Configuration:** client id, client secret, tenant id, domain and secret expiry date as environment values (secrets via Secret Manager, as Google's). Missing any of the first four → Microsoft unconfigured: button hidden, routes unavailable, boot line says so.
- **Login screen:** two equal buttons, Google then Microsoft, one note naming both. Painted as a mockup in the live shell first; the mockup is deleted when wired.
- **Registration:** a separate single-tenant app registration in Dona Dom's existing Entra tenant, one per environment, delegated `openid email` only. Staging's carries the local dev redirect as well.
- **Glossary:** `CONTEXT.md` gains **Staff account** and **Sign-in provider**, and notes that "operator" there means Dona Dom while the staff spec and the `OPERATOR` role use it for a person.

## Testing Decisions

- A good test drives the system from outside — an HTTP request in, a status, a cookie, a page or a row out — and never asserts how the provider is called internally. Identity providers are faked at their port; Postgres is real.
- **Primary seam: the app over HTTP with the identity port faked** — prior art: the staff routes test, its fake identity and its "every refusable shape answers with the same bytes" case, extended to the Microsoft routes and to cross-provider binding.
- **Secondary seam: the Microsoft provider alone** — prior art: the staff identity test. Authorization URL, the pure acceptance rule (including look-alike domains such as `x@evil-dona.co.il` and `x@dona.co.il.evil`), and the code exchange with a fake fetch and a fake verifier.
- **Policy gate:** one case in the policy suite, red before the code exists: a Microsoft sign-in with a foreign tenant or a non-`dona.co.il` address is refused even when a staff account names that address.
- Existing Google tests pass unmodified; a diff to them is a signal the Google flow was touched.
- The screen and the write path are clicked on `:3000` before merge.

## Out of Scope

- Personal Microsoft accounts and other organisations' tenants.
- Domains other than `dona.co.il`.
- Self-service sign-up or a pending-approval queue.
- More than one sign-in identity per staff account; an unbind screen.
- Any change to Google sign-in, the role matrix, or session handling.
- The production Entra registration (follows when prod exists).
- Any mail, calendar or Graph access through the sign-in app.

## Further Notes

- **Director's to do:** asking Dona Dom's Entra admin to create "Dona Sign-in - Staging". The Hebrew guide for that admin is written only after implementation is done and approved, as a section of the published Outlook admin guide, republished to the same URL.
- The branch this was planned on carries a pre-existing `building_address_unique` test failure unrelated to this work.
