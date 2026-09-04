# SPEC: staff

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the admin edge — authentication, sessions, roles, the operator queue, approvals, settings.
  Not a domain module.
- **Entities:** none of E1–E16.
- **Depends on:** kernel.
- **Builds:** week 5 — lifted from v3 and extended ([docs/from-v3.md](docs/from-v3.md) Tier 2) with
  MFA, an invite flow, and the `national_id` field guard.
- **Carries:** **the role matrix is code, not a config row** — a deliberate exception to "policies are
  data", because an access-control matrix a database write could widen is a privilege-escalation path.
  Sessions store `token_hash`, never the token. The refusal says `not_allowed` and nothing more.
