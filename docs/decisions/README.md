# Decisions

One file per architectural decision, so agents and people cite a decision instead of relitigating it
([docs/pipeline.md](../pipeline.md) §10 — chat-driven architecture is the anti-pattern this exists to
prevent).

**ADR-0001–0004 are re-adopted from v3, not re-argued.** They were correct when they were decided and
nothing in v5 changes their reasoning ([from-v3.md](../from-v3.md)). Each file states the decision,
what carries into v5, and what changes — it does not reproduce the original argument. The originals
are at `github.com/RandomWilder/dona-v3` under `docs/decisions/`. **ADR-0005 and ADR-0006 are v5's
own** — 0005 decided at slice 5.1b against something this repository had already built and then took
out, 0006 at slice 6.4 against a conflict that was visible in ADR-0004's own text before either half
of it was built.

**ADR-0004's status row said `proposed` until 6.4.** The ADR's own body moved it to `accepted` on
6 Sep 2026 and set out why: a decision is accepted when it has been taken and is being followed, and
an outstanding deliverable belongs on the fuse table. This table had not been updated to match, so
for a week the register and the decision disagreed about whether three of four decisions bound today.

| ADR | Decision | Status |
|---|---|---|
| [0001](ADR-0001-prod-database-isolation.md) | Prod gets its own Cloud SQL instance | accepted |
| [0002](ADR-0002-ocr-is-required.md) | Scanned documents are read by OCR; manual entry is not a fallback | accepted |
| [0003](ADR-0003-api-keys-stay-in-secret-manager.md) | API keys stay in Secret Manager; the admin controls the reference, never the value | accepted |
| [0004](ADR-0004-personal-data-reaches-the-model-provider.md) | Personal data reaches the model provider, and that is a decision rather than an accident | accepted — decision 3's deliverable is fuse **F6** |
| [0005](ADR-0005-the-credential-is-google-s.md) | The staff credential is Google's; the allowlist replaces the assertable second factor | accepted |
| [0006](ADR-0006-the-extractor-may-read-a-declared-identifier.md) | The extractor may read a **declared** identifier; masking binds the embedder and any tenant-facing model call | accepted |

**A1–A10 in [tasks/plan.md](../../tasks/plan.md) are numbered as they will become ADRs.** They are
decisions of record already; they become files here as the slices that implement them land, so an ADR
is written against something that exists rather than something intended.
