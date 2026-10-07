---
number: 198
title: The Outlook secret warns before it expires
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 181
created: 2026-10-07
closed: 2026-10-07
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The Graph client secret lasts 24 months. Its expiry date is set alongside it, as a fifth setting
(`graph-secret-expires`), through `./infra/set-secret.sh` and mounted by the deploy like the other
four. From 30 days before that date the קריאות list shows a warning to renew the secret, in the same
place as the mailbox warning. Renewing is a new secret and a new date, nothing else. Without a date
the warning says the expiry is unknown, so a missing date is never silent.

## Acceptance criteria

- [x] No warning more than 30 days before the expiry date; a warning from 30 days before, and after it
- [x] A secret set without a date shows the expiry-unknown warning
- [x] The setting is in `.env.example`, `infra/bootstrap.sh` and the staging deploy beside the other four
- [x] Clicked on `:3000` with a date 10 days ahead: the warning shows on the קריאות list

## Comment — 2026-10-07

Done. `GRAPH_SECRET_EXPIRES` is read with the other four settings and kept only when it is a real
calendar date. The warning starts on the office's day 30 days before expiry (through `today(clock)`,
not a UTC instant), stays after the date with the wording changed to say it has expired, and says the
expiry is unknown when the mailbox is configured without a usable date. Nothing shows when no mailbox
is configured. Clicked on `:3000` with a date ten days ahead: the warning showed on /calls with
17.10.2026. The setting is in `.env.example`, bound by `infra/bootstrap.sh` and mounted by the staging
deploy, where its absence does not stop the mailbox.

## Blocked by

None.
