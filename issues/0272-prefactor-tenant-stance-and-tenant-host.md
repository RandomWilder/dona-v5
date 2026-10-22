---
number: 272
title: "Prefactor: a tenant stance and the tenant host"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 270
created: 2026-10-19
closed: 2026-10-20
---

## Parent

#270 — Tenant portal.

## What to build

Today a route can only declare a staff stance, and anything undeclared is refused. Make the stance vocabulary carry a tenant audience as well, and serve tenant routes only on the tenant host and staff routes only on the office host. No tenant feature yet: the tenant host serves one placeholder page. A staff session is never valid on the tenant host, and a tenant session never valid on the office host. SPEC.md states the tenant stance, the tenant host and the default deny.

## Acceptance criteria

- [x] SPEC.md is edited first, in the same change: tenant stance, tenant host, default deny on both hosts.
- [x] A route that declares neither a staff nor a tenant stance still fails the build.
- [x] A staff route requested on the tenant host is not found; a tenant route requested on the office host is not found.
- [x] Policy case, red first: a staff session cookie presented on the tenant host is not a session there, and the reverse.
- [x] Every existing route test still passes unchanged.

## Blocked by

None (can start immediately)

## Comment — 2026-10-20

Staff routes answer only on the office host, tenant routes only on the tenant host (`tenant.localhost` unless `TENANT_HOST` is set). The tenant host's one page is a placeholder. A staff cookie on the tenant host is not a session: the staff page is not found and the session row is not touched. The tenant cookie `dona_portal` is not a session on the office host. The policy case was red first — a staff cookie on the tenant host still opened the office page. Clicked `http://tenant.localhost:3000/`; the office home still goes to the staff login. HTTP/2 reads `:authority` because Cloud Run does not send `Host`.
