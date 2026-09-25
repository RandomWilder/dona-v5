---
number: 160
title: "Flag a handover date outside the lease term"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [157]
parent: 152
created: 2026-09-24
closed: 2026-09-25
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

The director ruled on 24 September 2026 that a Unit is occupied from the lease `start_date`, not
from the keys. The handover date the protocol carries is still a fact worth seeing. Once #157 makes
A6's confirmed handover date the protocol's approval, the tenancy page prints it beside the lease
dates, and `activationGate` returns a flag — `handover_outside_term` — when it falls before
`start_date` minus 30 days or after `end_date`.

It is a **flag**, the same standing as `lapsed_document`: it never darkens the button and never
moves a status. The 30 days are one named constant, because keys handed over a few weeks early is
ordinary.

## Screen

Approved on the second look, 24 September 2026. The flag is one alert-coloured line under the
lease dates on the tenancy page. It is not a row in מה נבדק, and it does not darken the button.

## Acceptance criteria

- [x] Handover date printed beside the lease dates on the tenancy page
- [x] Gate flag, never a check; button unaffected
- [x] Seam test over both edges
- [x] SPEC-flows.md A5 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart

## Comment — 2026-09-25

Closed. The confirmed handover date is printed beside the lease dates. More than 30 days before the start, or after the end, is a flag: an alert line under those dates, not a row in מה נבדק, and the activate button is unchanged. Exactly 30 days early, and the end date itself, raise nothing. Dev restarted. Google login blocked the browser tab; the restarted server was driven with a session. The draft whose protocol is confirmed for 2027-02-01 shows that date beside 2027-02-01 — 2028-02-01 and no flag, and the button stays dark because the lease has not started. The confirm was pointed at 2026-12-01 and at 2028-02-02 long enough to read both flag lines, then put back.
