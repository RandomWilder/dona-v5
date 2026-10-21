---
number: 261
title: Prefactor: one shared sign-in tail
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

Make the change easy before making it. Everything the Google callback does after it has accepted a
verified identity — look up the staff account by address, check it is usable, bind it to the identity
or refuse a mismatch, mint the session, write the audit row, set the cookie and redirect — becomes one
shared step that takes a provider-neutral identity (a binding id and an address). The Google callback
calls it. Nothing a user or a test can observe changes.

## Acceptance criteria

- [x] The Google sign-in, every refusal, the audit rows and the lockout behave exactly as before.
- [x] The existing staff route and identity tests pass with no diff to them.
- [x] The shared step knows nothing about Google; a second callback could call it unchanged.

## Blocked by

None (can start immediately).

## Comment — 2026-10-18

After Google accepts a verified identity, one step takes a binding id and an address. It looks up the account, checks it is usable, binds the first identity or refuses a mismatch, mints the session, writes the audit row, sets the cookie and redirects. The Google callback calls that step. Refusals before acceptance still clear the one-shot cookie and answer with the same sentence. Staff route and identity tests are unchanged and pass. The full suite still fails on the pre-existing `building_address_unique` cases, which this change does not touch.
