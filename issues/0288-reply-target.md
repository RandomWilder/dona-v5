---
number: 288
title: "Reply target"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [281, 287]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

An administrator sets the **Reply target** X in business days. A call counts as replied when a person's reply is sent on it; the automatic acknowledgement and the fixed emergency reply do not count. The office sees the share of calls replied within X over a chosen period. A "show to tenants" setting, off by default, puts "we reply within X business days" on the portal.

**Paint screens 1e and 1l** (`mockups/tenant-portal.html`). With show-to-tenants on, the home page shows a clock mark and "אנחנו עונים בתוך X ימי עסקים" under the greeting, and the report confirmation shows "אדם מהמשרד יענה בתוך X ימי עסקים" as a pill. The portal never explains why the line is there.

## Acceptance criteria

- [ ] SPEC-calls is edited first: the Reply target, what counts as a reply, and the show-to-tenants setting.
- [ ] The share is computed over a chosen period and shown to the office only.
- [ ] With show-to-tenants off, no tenant page mentions a time.
- [ ] Turning show-to-tenants on or off is an audit row and needs an administrator.
- [ ] Clicked on `:3000` before merge.

## Blocked by

- #281
- #287
