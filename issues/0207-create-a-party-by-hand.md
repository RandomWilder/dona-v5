---
number: 207
title: Create a party by hand from the אנשי קשר tab
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [205, 206]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

An operator creates a person (family name, optional given name, language) or a company (legal name,
language) from the tab, with at least one contact or a ת.ז., and lands on the new party's profile. A
party with neither is refused: a record that can never be identified or reached is not kept. The
contact follows the rules #206 set — normalised, and refused if another party holds it — and a ת.ז.
follows #204's — ADMIN only, refused if another party holds it. The lease flow keeps creating parties
from a name alone, because there the lease is the evidence.

SPEC-parties is amended first with the new create command and its rule.

## Acceptance criteria

- [x] Creating a person with a family name and one phone succeeds and redirects to the profile.
- [x] Creating a company with a legal name and one email succeeds.
- [x] Creating either with neither a contact nor a ת.ז. is refused with the reason, and nothing is written.
- [x] A contact another party holds, or a ת.ז. another party holds, refuses the whole create; no half-written party remains.
- [x] An operator cannot supply a ת.ז. on create; an administrator can.
- [x] The create writes one audit row with the actor, role and new party id, and no `national_id` value.
- [x] The lease flow's creation of a party from a name alone is unchanged and its tests pass.
- [x] Route tests cover each of the above.
- [x] The create screen is removed from the mockup; clicked on `:3000`.

## Comment — 2026-10-11

Closed. An operator creates a person or a company from אנשי קשר, with one contact or, for an administrator, a ת.ז. A party with neither is refused and nothing is written. A contact or a ת.ז. another party holds refuses the whole create. The lease path still creates a party from a name alone. The create paint is gone. On the restarted server at `:3000`, a person with a phone redirected to the profile and a party with neither came back with the reason. The browser itself stopped at Google sign-in.

## Blocked by

- #205 — the identity fields and their validation.
- #206 — the first contact is added under the contact rules.
