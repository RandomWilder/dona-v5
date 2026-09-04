# SPEC: estate

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the spine — where everything is.
- **Entities:** E1–E4, E11 — Project · Building · Space · Unit · Asset. `Building.project_id` is
  nullable; `project_code` lives on Project, never on Building.
- **Depends on:** kernel.
- **Builds:** week 1, slice 1.9 (Project · Building · Space · Unit); Asset in week 3, slice 3.5,
  seeded from handover protocols.
- **Carries:** **a building is a set of Spaces** — `UNIT · COMMON · TECHNICAL · EXTERIOR · PARKING ·
  STORAGE` — and a Unit is the leasable kind (`Unit.unit_id = Space.space_id`). Every Asset sits in
  exactly one Space, so **responsibility falls out of location** and `UNIT` is the only kind that can
  ever be the tenant's. `asset_type` is guarded, not admin-editable: the responsibility matrix keys on
  it, so editing it edits policy.
