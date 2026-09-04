# SPEC: parties

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** people and organisations, and how to reach them. The agent's front door.
- **Entities:** E5, E6 — Party · PartyContact.
- **Depends on:** kernel.
- **Builds:** week 2, slice 2.1.
- **Carries:** **`PartyContact` is temporally dated** — `valid_from` / `valid_to` — and a phone number
  is never a primary key. Israeli mobile numbers get recycled; a tenancy ends, the number is
  reassigned, and the new holder must resolve to *nobody*. v3's model made that case unrepresentable
  and it was a security defect, not a modelling preference ([docs/from-v3.md](docs/from-v3.md) Tier 3).
  `national_id` is admin-only, unreachable by any agent tool, and access-logged.
