# SPEC: policy

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the responsibility matrix, SLA thresholds, escalation rules, and the emergency
  definitions. **Versioned data. No AI anywhere in it.**
- **Entities:** policy rows and their versions; `asset_in_warranty` is fed by estate's asset register.
- **Depends on:** estate, tenancy.
- **Builds:** week 6.
- **Carries:** **responsibility is ternary** — tenant / operator / contractor — because of תקופת
  הבדק, and a binary model of it is wrong. Rules supersede by `effective_from` and **never
  overwrite**; every resolved call snapshots the `policy_version_id` that decided it, and re-resolving
  after the policy changes must still return what the snapshot says. The agent *reads* this matrix and
  never decides responsibility. The emergency bypass is a row here plus a routing rule, live before
  the first real message.
