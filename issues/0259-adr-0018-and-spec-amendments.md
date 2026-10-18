---
number: 259
title: ADR-0018 and the spec and glossary amendments
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 258
created: 2026-10-18
closed: 2026-10-18
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

The written record says the staff credential is Google's **or Microsoft's** before any code says so.
A new ADR-0018 amends ADR-0005: the allowlist and the first-identity binding are unchanged and apply
to both providers; the Microsoft path is single-tenant (Dona Dom's Entra tenant) and `@dona.co.il`
only; one staff account binds to one provider; the sign-in app is registered separately from the
mailbox app. It records what was rejected and why: personal Microsoft accounts, widening the mailbox
app registration, a tenant of our own, self-service sign-up, two bindings per account, and a
Microsoft auth library as a new dependency.

The staff spec gains the Microsoft subsection (tenant, domain, why the address is trusted), the
extended refusal list, the binding format, the one-statement unbind an admin runs to switch a person's
provider, the configuration values and the two-button login. The foundation spec's Google-only
sentences become "Google or Microsoft". The glossary gains **Staff account** and **Sign-in
provider**, and notes that "operator" in the glossary means Dona Dom while the staff spec and the
`OPERATOR` role use it for a person.

## Acceptance criteria

- [x] ADR-0018 exists, is listed in the decisions index, and ADR-0005 is marked amended by it.
- [x] The staff spec states every refusal the Microsoft path makes, and each is the same frozen refusal as Google's.
- [x] The staff spec states the binding format for both providers and how an admin switches a person's provider.
- [x] The foundation spec has no sentence left that says staff sign in with Google only.
- [x] The glossary has both entries and the "operator" collision note, with no implementation detail.

## Blocked by

None (can start immediately).

## Comment — 2026-10-18

Written record only. ADR-0018 amends ADR-0005. Staff spec, foundation spec and glossary updated. No sign-in code.
