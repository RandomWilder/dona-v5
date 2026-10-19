---
number: 266
title: Register the staging sign-in app and sign in for real
status: open
labels: [ready-for-human]
assignee:
blocked_by: [265]
parent: 258
created: 2026-10-18
closed:
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

The director's act: ask Dona Dom's Entra administrator to create "Dona Sign-in - Staging" from the
guide (#265), put the client secret into Secret Manager and the other values into the deploy, then
sign in once for real. This is the first time the Microsoft path meets Microsoft; everything before
it was proved against fakes.

## Acceptance criteria

- [ ] The registration exists in Dona Dom's tenant, single tenant, `openid email` only.
- [ ] Staging boots with Microsoft configured.
- [ ] An admin adds a `@dona.co.il` address on the staff page; that person signs in with Microsoft on staging and lands with their role.
- [ ] The same works on `127.0.0.1:3000` against the staging registration. Not `localhost`: the
      local callback is built from the Host header, and only the `127.0.0.1` URI is registered.
- [ ] An unlisted `@dona.co.il` address gets the frozen refusal; Google still signs in.

## Blocked by

- #265 — Hebrew guide for Dona Dom's Entra admin
