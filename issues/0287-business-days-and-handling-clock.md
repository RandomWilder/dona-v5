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

- [x] SPEC-calls is edited first: two clocks, business days, the non-working dates.
- [x] The business-day count is a pure function with its own small test, covering weekends, a non-working date and a span across both.
- [x] Administrators add and remove non-working dates at `/settings`; each change is an audit row.
- [x] Thresholds in business days are validated like the minute thresholds (red greater than amber).
- [ ] Clicked on `:3000` before merge.

## Comment — 2026-10-21

The two clocks, the settings and the list are in. Placeholders are 2 and 5 business days, until Dona Dom supplies theirs. The red stat is titled מעבר ליעד, because that count is no longer only the minute clock. `:3000` is up, and `/settings` redirects to Google sign-in, so the click is still the director's.

## Blocked by

None (can start immediately)
