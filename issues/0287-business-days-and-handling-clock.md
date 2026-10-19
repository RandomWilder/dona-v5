---
number: 287
title: "Business days and the handling clock"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

Office only. Emergency calls keep the Response goal in minutes. Every other open call gets a handling band in **Business days** — Sunday to Thursday, less the non-working dates an administrator keeps at `/settings` — with its own thresholds at `/settings`. The calls list shows each non-emergency call's band in business days.

## Acceptance criteria

- [ ] SPEC-calls is edited first: two clocks, business days, the non-working dates.
- [ ] The business-day count is a pure function with its own small test, covering weekends, a non-working date and a span across both.
- [ ] Administrators add and remove non-working dates at `/settings`; each change is an audit row.
- [ ] Thresholds in business days are validated like the minute thresholds (red greater than amber).
- [ ] Clicked on `:3000` before merge.

## Blocked by

None (can start immediately)
