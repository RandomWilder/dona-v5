# SPEC: scope

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** **the isolation join, and nothing else.** The module exists so the guard has a target.
- **Entities:** none. It writes no tables; the current-occupancy VIEW is its only artefact.
- **Depends on:** parties, tenancy, estate.
- **Builds:** week 2, slice 2.3 — but its two policy cases are written **red in week 1, slice 1.7**,
  against tables that do not exist yet.
- **Carries:** the five hops, in SQL, in one file, resolved **before any model call**:
  `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`. Two
  temporal predicates, both asserted. **The scope is a view, never a column** — no `current_tenant`
  column exists anywhere, and a migration introducing one fails the build. A CI grep guard fails any
  build that writes the join's temporal predicate outside this module, because the way this constraint
  dies is not a rewrite, it is a second copy that drifts.
