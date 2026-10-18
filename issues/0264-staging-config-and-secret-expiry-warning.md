---
number: 264
title: Staging config and the secret-expiry warning
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [262]
parent: 258
created: 2026-10-18
closed: 2026-10-18
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

A deploy carries the five Microsoft values to staging the way it carries Google's: client id, client
secret (Secret Manager), tenant id, domain and the secret's expiry date. Until the values exist the
deployed revision runs with Microsoft unconfigured and says so on its boot line. The bootstrap script
names the manual Entra step and the secrets it expects. An admin's staff home warns ahead of the
Microsoft client secret's expiry, the same way the mailbox secret's expiry is warned.

## Acceptance criteria

- [x] A deploy with no Microsoft values set succeeds and boots `microsoft:unconfigured`.
- [x] A deploy with the values set boots with Microsoft configured, secret not printed.
- [x] The bootstrap script lists the Microsoft secrets and the manual registration step.
- [x] An admin sees the expiry warning inside the warning window; operators and viewers do not.
- [x] No expiry date configured means no warning and no error.

## Blocked by

- #262 — Microsoft sign-in end to end

## Comment — 2026-10-18

Staging mounts the Microsoft client id, client secret, tenant id and expiry date only when those secrets exist, and always sets the domain to dona.co.il, so a deploy before the Entra registration still rolls and the boot line says `microsoft:unconfigured`. The secret is not on that line. Bootstrap names the separate single-tenant registration, delegated `openid email`, both redirect URIs, and the four secrets. From 30 days before the expiry date, and after it, an admin's staff home warns to renew; an operator or a viewer does not, and a missing or unusable date is silence. Production is not mounted. The full suite still fails on the pre-existing `building_address_unique` cases and the screen-crawl cap. The signed-in home was not clicked: the restarted local server answers the login screen, and Google sign-in needs the director.
