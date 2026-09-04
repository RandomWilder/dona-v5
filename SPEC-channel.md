# SPEC: channel

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** the adapter and the conversation. WhatsApp Cloud API webhooks in both directions, tenant
  verification, and the tenant-facing agent's tools.
- **Entities:** Conversation · Message (`body_original` + `body_he`).
- **Depends on:** scope, calls.
- **Builds:** week 9 (binding and OTP), 10 (the tenant side), 11 (both sides of the switchboard), 14
  (voice notes and five languages).
- **Carries:** **the agent is a client, not a brain** — scoped tools only, every call audited, and it
  reaches data solely through `src/scope/`. **No tenant-facing price and no balance, ever**, carried by
  two standing refusal cases in the golden set that are never relaxed. An emergency never reaches this
  module. OTP goes over WhatsApp first with SMS as the fallback; Hebrew is missing from Twilio
  Verify's default locales, so tenant-facing copy needs custom templates
  ([tasks/fuses.md](tasks/fuses.md)).
