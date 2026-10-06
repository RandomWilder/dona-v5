---
number: 191
title: The internal response goal
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [182]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The amber and red age thresholds of the internal response goal become rows at /settings, editable
without a deploy. Each open call in the list shows its age against them, and the list filters on
amber and red. The goal is internal and shown to no tenant; a promise to tenants is an SLA, and that
is the director's decision when one is made.

## Acceptance criteria

- [ ] Thresholds are editable at /settings and take effect without a deploy
- [ ] A call older than amber shows amber, older than red shows red; closed calls show neither
- [ ] The list filters on amber and red
- [ ] Clicked on `:3000`

## Blocked by

- #182 — Log a phone or walk-in call and see it in קריאות
