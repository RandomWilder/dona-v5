---
number: 291
title: The tenant host is a list of hostnames
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 289
created: 2026-10-22
closed: 2026-10-22
---

## Parent

#289 — Staging portal service. Decision of record: ADR-0020.

## What to build

Today the tenant host is one hostname. A Cloud Run service answers on two `run.app` hostnames, so a
portal service told only one of them still answers as the office on the other. After this ticket the
tenant host setting takes one or more hostnames, separated by commas. A request whose hostname is any
of them is on the tenant audience, and every other request is the office, exactly as now.

The SPEC.md foundation rule on hosts is edited first and says this. Each entry is normalised the way
a single hostname is today (lower case, port dropped, IPv6 brackets handled), empty entries are
ignored, and an absent or empty setting means the default `tenant.localhost`. The boot line prints
the whole list.

## Acceptance criteria

- [x] SPEC.md's host rule names the list form, the normalisation and the default, in the same change and before the code.
- [x] A policy case, red first, shows that a staff route requested on the second hostname of a two-entry tenant host is not found.
- [x] Through `buildApp`: with two tenant hostnames, a tenant route answers on each and a staff route is not found on either. A third hostname answers as the office.
- [x] A single hostname and the default behave exactly as before. The existing two-hosts tests pass unchanged.
- [x] Entries with upper case, a port or surrounding spaces still match. An empty entry between two commas matches nothing.
- [x] The boot line reads `tenant host: <a>, <b>` for a two-entry list.
- [x] Clicked: with `npm run dev` restarted and a two-entry tenant host (`tenant.localhost` and one more `.localhost` name), both names show the portal on `:3000`, and `localhost` shows the office.

## Comment — 2026-10-22

The policy case was red first: a staff page on the second hostname came back as the office sign-in redirect, status 303, and then as not found. The boot line on the restarted server read `tenant host: tenant.localhost, portal.localhost`. `tenant.localhost:3000` showed the portal home, `portal.localhost:3000` showed the portal sign-in, and `localhost:3000` showed the office sign-in. Full suite: 1388 pass, hooks 41 pass.

## Blocked by

- None (can start immediately).
