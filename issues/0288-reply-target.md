---
number: 288
title: "Reply target"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [281, 287]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

An administrator sets the **Reply target** X in business days. A call counts as replied when a person's reply is sent on it; the automatic acknowledgement and the fixed emergency reply do not count. The office sees the share of calls replied within X over a chosen period. A "show to tenants" setting, off by default, puts "we reply within X business days" on the portal.

**Paint screens 1e and 1l** (`mockups/tenant-portal.html`). With show-to-tenants on, the home page shows a clock mark and "אנחנו עונים בתוך X ימי עסקים" under the greeting, and the report confirmation shows "אדם מהמשרד יענה בתוך X ימי עסקים" as a pill. The portal never explains why the line is there.

## Acceptance criteria

- [x] SPEC-calls is edited first: the Reply target, what counts as a reply, and the show-to-tenants setting.
- [x] The share is computed over a chosen period and shown to the office only.
- [x] With show-to-tenants off, no tenant page mentions a time.
- [x] Turning show-to-tenants on or off is an audit row and needs an administrator.
- [x] Clicked on `:3000` before merge.

## Comment — 2026-10-21

The portal home shows the clock and "אנחנו עונים בתוך 2 ימי עסקים" under the greeting when the switch is on, and the report confirmation shows the pill. Calls, the report form, and the office question do not. The switch is off again. Staff settings is Google sign-in, so the settings form itself was not clicked in the browser; the HTTP test covers the administrator save and the operator refusal. Filing the confirmation left call 29023 open on the demo flat. Full suite: 1379 pass, 3 fail, none in this change. The handling-clock failure expects the placeholder 2 while the local threshold is the saved 7. The other two moved between runs.

## Blocked by

- #281
- #287
