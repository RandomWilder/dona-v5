# ADR-0020: Staging serves the portal from a second service; production serves both hosts from one service

- **Status:** accepted
- **Date:** 22 Oct 2026
- **Spec:** #289

## Context

The app tells the office from the portal by the request's hostname. A request whose hostname is a
tenant host gets tenant routes; every other request gets the office (SPEC.md, the foundation rule on
hosts). One process can therefore serve both audiences, as long as two names reach it.

On staging there are no names of our own. A Cloud Run service is reachable only at the `run.app`
hostnames Google gives it, and the office service `dona-staging` already answers as the office on
both of its hostnames. Region `me-west1` (Tel Aviv) does not support mapping a domain we own
directly onto a Cloud Run service; a load balancer is the supported way to put our own names in
front of it.

Production already has one service, `dona-prod`, deployed only by a version tag.

## Decision

1. **Staging gets a second service, `dona-staging-portal`,** deployed from the same image and in
   the same workflow as `dona-staging`, against the same database, and given only what the portal
   reads. Its tenant host is the list of its own `run.app` hostnames. The office service keeps the
   default tenant host and is unchanged.
2. **Production stays one service.** When the domains exist, a load balancer gives `dona-prod`
   two names, the office domain and the tenant domain. Its tenant host is the tenant domain. DNS
   for both names points at the load balancer, and the certificates are Google's. There is no
   `dona-prod-portal`.

## Alternatives

- **Point the office service's second `run.app` hostname at the portal.** One service, no second
  deploy step. Rejected: the office's staff base URL lives on one of those two names today, which
  of the two Google reports as primary is not ours to decide, and "the office is whichever of two
  similar addresses you happen to type" is a trap for every person who opens staging.
- **A load balancer on staging too.** Same shape as production. Rejected for now: it costs money
  every month for a staging environment, and it needs a domain we do not have yet.
- **`dona-prod-portal` in production.** Rejected: two production services mean two revisions, two
  rollbacks and two release steps for one image, and the hostname rule already lets one process
  serve both audiences. The second service on staging exists only because staging has no names of
  its own.

## Consequences

- Staging and production differ in shape on purpose. A reader who sees two services on staging and
  one in production should find this file, not "fix" production to match.
- The staging deploy, the smoke check and the staging rollback each handle two services, and must
  keep them on one image, because they share one schema.
- A passkey is bound to the hostname it was made on. A passkey made on a staging `run.app` hostname
  never works on the production tenant domain. Signing in by code on the real domain is the
  production sign-in.
- The tenant host became a list (#289), so that both `run.app` hostnames of the staging portal
  serve the portal. Production needs only one entry.
