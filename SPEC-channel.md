# SPEC: channel

**Stub.** Content arrives when this module is built; a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the adapter and the conversation. WhatsApp Cloud API webhooks in both directions, tenant
  verification, and the tenant-facing agent's tools.
- **Entities:** Conversation · Message (`body_original` + `body_he`).
- **Depends on:** scope, calls.
- **Builds:** week 9 (binding and OTP), 10 (the tenant side), 11 (both sides of the switchboard), 14
  (voice notes and five languages).
- **Carries:** **the agent is a client, not a brain** — scoped tools only, every call audited, and it
  reaches data solely through `src/scope/`. **This bullet said "no tenant-facing price and no
  balance, ever, carried by two standing refusal cases in the golden set" and it now says neither
  half.** Foundation rule 2 is retired
  ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)) — an amount on a document is
  ordinary data, quotable like any other value — and the two refusal cases it claimed never existed:
  the golden set has three cases and none of them is about money. **What the agent says to a tenant
  about money is this module's to decide when it is built**, and it is undecided. What is settled:
  Priority is the system of record for what anybody owes, this platform holds no balance, and
  **rule 3 is untouched** — a captured amount is a model-derived value and may not move a call from
  one state to the next. An emergency never reaches this module. OTP goes over WhatsApp first with SMS as the fallback; Hebrew is missing from Twilio
  Verify's default locales, so tenant-facing copy needs custom templates
  ([docs/fuses.md](docs/fuses.md)).
