# ADR-0003 — API keys stay in Secret Manager; the admin controls the reference, never the value

- **Date:** 2026-09-04 · **re-adopted from v3**, where it was decided 2026-09-01
- **Status:** accepted
- **Context slice:** 1.1 — re-adopted by reference, not re-argued
- **Original:** `docs/decisions/ADR-0003-api-keys-stay-in-secret-manager.md` in `RandomWilder/dona-v3`

## The decision

1. **Secret material stays in Secret Manager. Permanently.** No API key is ever stored in a settings
   table, in any other table, or accepted through an admin form. `infra/set-secret.sh` is the only way
   a credential enters this system, and rotation is "add a version".
2. **The admin controls the *reference*, not the value.** A settings row holds a **secret name**. An
   operator may point the system at a different secret without a deploy; what they can never do
   through a screen is read or set a key.
3. **The key is read per call with a short cache**, not at instance start — which is what actually
   makes rotation take effect without rolling a revision.

## Why it carries into v5 unchanged

The question behind it was the right one — *the admin should be able to plug in and modify this, not
have it hard-coded* — and the answer separates two things that sound alike and have opposite
consequences. Rotation without a deploy is a real operational requirement. A key typed into a browser
form is a downgrade: it crosses the browser, the request path and the error handling, and comes to
rest in a database column where per-secret IAM and per-environment isolation no longer exist. Staging
cannot read prod's key today, and a settings row erases that boundary.

v5 raises the stakes rather than lowering them. `SPEC.md` binds IAM per secret and per bucket and
never at project level, precisely so the staging runtime cannot read prod's connection URL — the same
boundary this ADR protects.

## What changes for v5

- **Read-per-call with a cache is the design from the start**, not a week-6 correction of a
  read-at-boot implementation. There is no legacy resolution path to retire.
- The reference row lands with the settings screen in week 5, alongside the `ObligationType` and
  `DocumentType` catalogues, and inherits that screen's answer on **who may change a reference** —
  pointing production at a different secret is a privileged act even when the value never appears.
- **Three keys, deliberately distinct**, as in v3: staging's, prod's, and a CI-only key set on the
  evals job, so a compromised Actions secret revokes without touching either environment.

## What this still does not settle

Multiple model providers (the seam exists — the adapter is a port and the model id is a config row),
and a customer-supplied key, if Dona Dom ever brings their own account. The reference row is the right
shape for it; the onboarding path is not designed here.
