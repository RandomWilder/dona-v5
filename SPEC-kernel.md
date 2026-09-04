# SPEC: kernel

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** ids · injected clock · the one error shape · config · db · the migration runner ·
  idempotency · events · durable work · object storage · pdf · embeddings · validate · `pg-support` ·
  audit · the RTL UI token layer. **No business logic.**
- **Entities:** none.
- **Depends on:** nothing. **It imports from no domain module, and a grep in CI proves it.**
- **Builds:** week 1, slice 1.4 — lifted verbatim from v3, renaming nothing
  ([docs/from-v3.md](docs/from-v3.md) Tier 1). v3's *migrations* do not come with it.
- **Carries:** injected time. No `Date.now()` in logic, no `DEFAULT now()` in SQL — a column default is
  a second source of truth no test can see.
