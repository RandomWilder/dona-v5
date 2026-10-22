---
number: 293
title: The staging deploy creates and keeps the portal service current
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [290, 291, 292]
parent: 289
created: 2026-10-22
closed:
---

## Parent

#289 — Staging portal service. Decision of record: ADR-0020.

## What to build

Every green merge to `main` updates two staging services from one image: the office, `dona-staging`,
exactly as today, and the portal, `dona-staging-portal`, which the first such deploy creates. After
the merge, the portal's addresses open the portal on a phone and the office address is unchanged.

The workflow builds and pushes once, migrates once with the office's existing migration job, deploys
the office, deploys the portal, takes traffic to latest on both, smokes both, and then runs the
existing scheduled-job steps for the office only. The portal's tenant host is worked out on every
deploy from the service's own address list. Before the service exists, it is the fixed form
`dona-staging-portal-<project number>.me-west1.run.app`. Once it exists, it is every hostname the
service reports, with no scheme and no path.

The portal service gets:

- runtime account `app-staging` and Cloud SQL instance `dona-staging`
- the staging database URL and the staging model key
- version, document bucket, Google Cloud project, Document AI location and processor, the pool maximum and the tenant host list
- HTTP/2, 2Gi of memory, public access, minimum 0 and maximum 1 instances

It gets no Google sign-in, Outlook, WhatsApp or InforU values, no migration job and no scheduled job.

The smoke script gains a portal mode. It keeps the `/health` and `db:up` check, and also requires
the web app manifest to answer 200, which only the tenant audience serves. The staging rollback moves
each of the two services to its own previous ready revision and pins it, and it reports and skips a
portal service that does not exist yet. The production rollback and the release workflow are
unchanged.

Without a code sender the portal shows no phone form. That is the expected end state here (SPEC-channel).

## Acceptance criteria

- [x] The smoke script's portal mode, run by hand against `npm run dev`, passes on `tenant.localhost` and fails on `localhost`.
- [x] The workflow comments carry their reasons the way the existing steps do, including why the portal gets no Outlook or WhatsApp values (one poller per mailbox) and why it gets max 1 instance (the connection budget).
- [x] PR opened. The director merges it. Merging is the deploy.
- [ ] First run after merge: `dona-staging-portal` exists, both smokes pass, and the step summary lists both services, their addresses and their health.
- [ ] Second run (any later merge, or a re-run): the portal's tenant host contains both of its `run.app` hostnames, and both pass the portal smoke.
- [ ] The office address shows the office, and staff sign-in with Google works there.
- [ ] Both portal addresses show the portal on a phone on mobile data, the portal installs to the home screen, it shows no phone form, and its boot log reads `portal codes: unavailable`.
- [ ] The portal service lists no Graph, WhatsApp, Google OAuth or InforU environment values, and Cloud Scheduler has no job aimed at it.
- [ ] One staging rollback pins both services to their previous revisions. The next deploy takes traffic on both.

## Blocked by

- #290 — the branch runs green (the deploy runs only after green CI).
- #291 — the tenant host is a list (without it, the portal's second address is an office).
- #292 — the pool has a stated maximum (without it, two services can exhaust the connections).

## Comment — 2026-10-22

Portal smoke, by hand, against the running dev server: `tenant.localhost:3000` passed (health `db:up`, manifest 200). `localhost:3000` failed (manifest 404). Plain smoke on `localhost` still passes. The staging workflow deploys the portal after the office, from the same image, and the release workflow is untouched. What remains is the director merging, then the first staging run, the second run, the phone click-through and one rollback.

## Comment — 2026-10-22

The commit is on pull request 152. Merging that is the staging deploy.
