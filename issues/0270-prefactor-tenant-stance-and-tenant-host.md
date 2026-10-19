---
number: 270
title: "Prefactor: a tenant stance and the tenant host"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

Today a route can only declare a staff stance, and anything undeclared is refused. Make the stance vocabulary carry a tenant audience as well, and serve tenant routes only on the tenant host and staff routes only on the office host. No tenant feature yet: the tenant host serves one placeholder page. A staff session is never valid on the tenant host, and a tenant session never valid on the office host. SPEC.md states the tenant stance, the tenant host and the default deny.

## Acceptance criteria

- [ ] SPEC.md is edited first, in the same change: tenant stance, tenant host, default deny on both hosts.
- [ ] A route that declares neither a staff nor a tenant stance still fails the build.
- [ ] A staff route requested on the tenant host is not found; a tenant route requested on the office host is not found.
- [ ] Policy case, red first: a staff session cookie presented on the tenant host is not a session there, and the reverse.
- [ ] Every existing route test still passes unchanged.

## Blocked by

None (can start immediately)
