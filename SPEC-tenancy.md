# SPEC: tenancy

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** who holds which unit, when, and under what obligations.
- **Entities:** E7–E10 — Tenancy · TenancyParty · Obligation · ObligationType, plus an append-only
  `TenancyEvent` beside the mutable row.
- **Depends on:** estate, parties.
- **Builds:** week 2, slice 2.2; Obligation, ObligationType and `TenancyEvent` in week 5.
- **Carries:** **a guarantor never receives service information.** `is_service_contact` is forced
  false when `role = GUARANTOR` by a database constraint — no toggle, no import path, no agent
  override, and the policy case asserts the insert is *rejected*. `ObligationType` is an
  admin-managed catalogue, deactivated never deleted, with `responsible_party` copied onto the
  obligation at creation so editing the catalogue cannot rewrite history. Natural key
  `(unit_id, starts_on)`, so a re-run of the importer is a no-op rather than a duplicate.
