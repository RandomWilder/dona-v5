---
number: 203
title: Party labels on the directory and the profile, and filters by label
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [202]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

Each party carries its labels — what it is to us today — computed on every load and never stored:
current tenant, past tenant, draft tenancy (each with the role: primary tenant, co-tenant,
occupant), guarantor (with its tenancy's state), and no relationship. The directory shows the labels
with their unit and filters by them; the profile shows them, each linked to its tenancy.

Labels come from the tenancy contract — each party's roles with each tenancy's status, dates and unit
— composed with the parties read at the composition root. "Current" means the same thing the
occupancy view and the isolation join mean by active today; a second definition is not written.

The service-provider label arrives with #208.

## Acceptance criteria

- [x] A party on a tenancy active today is labelled current tenant with its unit and role; the day after the tenancy ends it is labelled past tenant, with no write to the party.
- [x] A party on a tenancy that ended early is labelled past tenant.
- [x] A party on a draft tenancy is labelled draft tenancy.
- [x] A guarantor is labelled guarantor and never tenant, on any tenancy state.
- [x] An occupant is labelled distinctly from a primary tenant or co-tenant.
- [x] A party with roles on several tenancies carries every label that applies.
- [x] A party on no tenancy is labelled no relationship and found by that filter.
- [x] Each label filter returns exactly the parties carrying that label, combined with a search.
- [x] Each label on the profile links to its tenancy.
- [x] No column, view or table stores a label or a tenancy state on the party; guard one passes.
- [x] Route tests use a fixed clock to cover each label and the transition from current to past.
- [x] Clicked on `:3000`.

## Comment — 2026-10-11

Closed. Labels are computed on each load from the party's roles and the clock, and nothing is stored on the party. A letting that still counts today is a current tenant with the unit and the role; the next morning it is a past tenant while the letting row is still active. Ended early is past, a draft is a draft, a guarantor is a guarantor on every state and never a tenant, and an occupant is named apart from a primary or a co-tenant. A party on no tenancy is אין קשר. Each filter combines with the search. Each label on the profile opens its tenancy. Clicked on `:3000` after a restart: searching נכנס with שוכר נוכחי returned one row, שוכר נוכחי · שוכר ראשי · דירה 1, and that label opened the letting. Searching בדפדפן with אין קשר returned נועה בדפדפן labelled אין קשר.

## Blocked by

- #202 — the tab and the profile exist.
