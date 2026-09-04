# Decisions

One file per architectural decision, so agents and people cite a decision instead of relitigating it
([docs/pipeline.md](../pipeline.md) §10 — chat-driven architecture is the anti-pattern this exists to
prevent).

**ADR-0001–0004 are re-adopted from v3, not re-argued.** They were correct when they were decided and
nothing in v5 changes their reasoning ([from-v3.md](../from-v3.md)). Each file states the decision,
what carries into v5, and what changes — it does not reproduce the original argument. The originals
are at `github.com/RandomWilder/dona-v3` under `docs/decisions/`.

| ADR | Decision | Status |
|---|---|---|
| [0001](ADR-0001-prod-database-isolation.md) | Prod gets its own Cloud SQL instance | accepted |
| [0002](ADR-0002-ocr-is-required.md) | Scanned documents are read by OCR; manual entry is not a fallback | accepted |
| [0003](ADR-0003-api-keys-stay-in-secret-manager.md) | API keys stay in Secret Manager; the admin controls the reference, never the value | accepted |
| [0004](ADR-0004-personal-data-reaches-the-model-provider.md) | Personal data reaches the model provider, and that is a decision rather than an accident | proposed — legal basis owed |

**A1–A10 in [tasks/plan.md](../../tasks/plan.md) are numbered as they will become ADRs.** They are
decisions of record already; they become files here as the slices that implement them land, so an ADR
is written against something that exists rather than something intended.
