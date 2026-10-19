---
number: 284
title: "Installable on the phone"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [271]
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

The tenant can add the portal to their phone's home screen and it opens like an app. A web app manifest and a minimal service worker that caches no tenant data.

## Acceptance criteria

- [ ] SPEC.md's client-JavaScript rule is edited first: the manifest and the service worker are named exceptions.
- [ ] The service worker caches only static assets, never a page or a response containing tenant data.
- [ ] Installs from current mobile Safari and Chrome.
- [ ] Clicked on a phone-width `:3000` before merge.

## Blocked by

- #271
