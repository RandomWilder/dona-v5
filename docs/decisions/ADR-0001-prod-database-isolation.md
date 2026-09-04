# ADR-0001 — Prod gets its own Cloud SQL instance

- **Date:** 2026-09-04 · **re-adopted from v3**, where it was decided 2026-08-23
- **Status:** accepted
- **Context slice:** 1.1 — re-adopted by reference, not re-argued
- **Original:** `docs/decisions/ADR-0001-prod-database-isolation.md` in `RandomWilder/dona-v3`

## The decision

Staging and prod each get their own Cloud SQL instance in `me-west1` — their own database user, their
own Secret Manager secret, and their own runtime service account, which is the only identity granted
`secretAccessor` on that secret. Not two databases on one instance.

## Why it carries into v5 unchanged

The four reasons hold exactly as written: **blast radius** (staging exists to be wiped and
load-tested, and a shared core makes a runaway staging query a prod outage), **restores are
instance-level** (restoring staging to yesterday would take prod with it, which makes the one recovery
path unusable), **credential isolation is real rather than nominal**, and **names that lie become
incidents**.

v5 strengthens the case rather than weakening it. Prod will hold tenant national IDs, signed leases
and the phone numbers the isolation join resolves against — and `SPEC.md` binds every scoped read of
that data to an audit record. A staging connection URL that could reach it is a hole in a constraint
the client called absolute.

## What changes for v5

- New project, new instance names. `infra/bootstrap.sh` takes the environment as an argument, which is
  what keeps the two from drifting; it is run against the new project in slice 1.5.
- **`--edition=ENTERPRISE` stays.** me-west1 defaults new instances to `ENTERPRISE_PLUS`, which rejects
  shared-core tiers.
- The project is created **under an organisation** this time (R8), so the eventual move into Dona Dom's
  organisation is routine.
- The cost line is unchanged in shape: roughly $10/month for the second db-f1-micro, plus automated
  backups on prod only. Isolation of tenant PII is worth more than $10.

## Consequences

Migrations run per environment at boot, so both instances converge on the same schema without extra
machinery. Private IP, a VPC connector and point-in-time recovery on prod are deliberately deferred to
a hardening slice, exactly as in v3 — and in v5 that slice is owed before week 12, when real tenants
arrive, not before the pilot building is seeded.
