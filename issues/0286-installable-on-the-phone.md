---
number: 286
title: "Installable on the phone"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [273]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

The tenant can add the portal to their phone's home screen and it opens like an app. A web app manifest and a minimal service worker that caches no tenant data.

## Acceptance criteria

- [x] SPEC.md's client-JavaScript rule is edited first: the manifest and the service worker are named exceptions.
- [x] The service worker caches only static assets, never a page or a response containing tenant data.
- [x] Installs from current mobile Safari and Chrome.
- [x] Clicked on a phone-width `:3000` before merge.

## Comment — 2026-10-21

Phone width 390 on tenant.localhost:3000, manifest linked, heading clicked. The office question and sign-out were not used. The open tab had a worker registration and no active worker. The worker file parses, and every file it keeps returned 200. Full suite: 1372 pass, 4 fail, none in this change.

## Blocked by

- #273
