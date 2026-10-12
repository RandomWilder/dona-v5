---
number: 212
title: A flat's rental track — free market or regulated, and who a regulated flat is let to
status: open
labels: [needs-triage]
assignee:
blocked_by: []
parent:
created: 2026-10-12
closed:
---

## Problem

The Beit Shemesh developer sheet (project BSM-MSK, הרב קוק 48 / 50 / 52) marks every flat with a
rental track: `שוק חופשי`, `מפוקח`, `מפוקח בן מקום`, `מפוקח מילואים פעיל`. Ramle 103 had no such
column, but a דירה להשכיר tender fixes which flats are let at a regulated rent, so more buildings will
carry it. The system has no field for it; the seed of BSM-MSK on 12 Oct 2026 dropped the column.
Dona Dom works with this distinction today.

## What it should do

Two facts are mixed in the one column, and they likely live in different places:

- **The track** — free market or regulated — is fixed by the tender per flat. It belongs on the Unit,
  next to tenure, and the building page should be able to count and filter by it.
- **The eligibility group** — בן מקום, מילואים פעיל — says who a regulated flat was let to. That is a
  fact about the letting, so it belongs on the Tenancy, and a lease that is read should fill it.

The director agreed this split on 12 Oct 2026: the track on the Unit, the eligibility group on the
Tenancy. Then: a migration for the column(s), the
building plan file and `building-sheet-to-plan` gain the field, the flat tile and page show it, and
BSM-MSK is refilled with `infra/estate-seed.sh staging <file> --update`. Whether a regulated rent is
capped or checked against the tender is a separate rule and not part of this ticket.
