---
number: 211
title: Change a flat's tenure on screen (for rent, for sale, sold)
status: open
labels: [needs-triage]
assignee:
blocked_by: []
parent:
created: 2026-10-12
closed:
---

## Problem

0064 gave a Unit a tenure: `FOR_RENT`, `FOR_SALE` (still lettable, reversible) or `SOLD` (terminal;
no `DRAFT` or `ACTIVE` letting, and a let flat cannot become sold). The rules are triggers, so every
writer is held to them. The only writer today is the building plan file, through
`npm run estate:seed` and `--update`. A flat that sells after its building was seeded needs a
developer to edit a JSON file and rerun it.

## What it should do

An `estate.write` holder changes a flat's tenure from the flat's page. Sold asks for confirmation
and says it cannot be undone; the trigger's refusal (an active letting, or a flat already sold) is
shown in words, not as an error page. Each change is recorded — who, when, old → new — in
`estate_event` or `audit_log`, decided in this ticket's spec.
