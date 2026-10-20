---
number: 274
title: "Real code senders: WhatsApp template and SMS"
status: open
labels: [ready-for-human]
assignee:
blocked_by: [273]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

Two real implementations of the code sender, each off until it is configured: a WhatsApp **authentication template** sender on Dona Dom's WhatsApp Business account, and an SMS sender through the Israeli gateway (InforU recommended in the research; its HTTP API, a code we generate, IP allowlist). When one is configured the tenant gets that one; when both are, WhatsApp is the default and the tenant may choose SMS on the code screen. The SMS gateway is added to SPEC.md's third-party table before it is ever called. Neither needs the provider account to exist to merge: both are tested against injected fetches, as the WhatsApp reply is today.

**Paint screens 1a and 1b** (`mockups/tenant-portal.html`). The SMS choice is not a toggle at the top of the code screen. It is a card at the bottom: "לא הגיע בוואטסאפ?" with "שלחו במסרון. עובד גם בלי אינטרנט." and a מסרון action. After an SMS send, the card offers WhatsApp again. The code screen's line says which channel the code went to.

## Acceptance criteria

- [x] SPEC.md's third-party table gains the SMS gateway row (what it receives: a phone number and a code; where it processes; processor terms) before any call to it.
- [x] SPEC-channel and ADR-0013 §5's supersession are consistent: a tenant code may go by SMS.
- [x] With no real sender configured, staging refuses to start the sign-in flow rather than silently falling back to the dev sender.
- [x] With one sender configured, no choice is shown; with both, WhatsApp is sent first and SMS is offered from the code screen's fallback card.
- [x] The SMS sender name is at most 11 Latin characters and is configuration.
- [x] SMS is sent only to Israeli mobile numbers; the send caps from #273 apply to both senders.
- [x] A provider error shows the tenant a retry message and is an audit row; it never reveals the provider's response.
- [ ] Turning either sender on in staging is the director's step (Meta template and payment method; gateway contract and processor annex), recorded as a comment here when done.
- [x] With both senders, the code screen offers SMS only as the bottom fallback card; choosing it sends a new code by SMS and the screen's line names SMS.
- [x] With one sender configured, the fallback card is absent and the phone screen's caption does not mention the other channel.

## Blocked by

- #273

## Comment — 2026-10-20

Both senders are in, and both stay off until configured. WhatsApp is the authentication template (`PORTAL_WHATSAPP_TEMPLATE` plus the existing Cloud API token and phone-number id). SMS is InforU's client-generated endpoint, Basic auth, `SMS_SENDER` at most 11 Latin characters. A half-set sender refuses to boot. A revision with neither does not fall back to the log. With both, WhatsApp goes first and the code screen's bottom card sends a new code by SMS, then offers WhatsApp again. A provider failure is "נסו שוב" and an audit row whose message is `sender`; the provider body is not in the page or the row. Not called against a live account. Staging stays off until the director mounts the template and the gateway (contract, processor annex, IP allowlist, payment method).

## Comment — 2026-10-20

The build is done and stays as it is. This ticket stays open because the last criterion is turning a sender on in staging, and that has not happened. It does not block the next portal tickets: #275, #276 and #278 wait only on #273, which is closed.

Confirmed with the director: staging has no practice sender. With nothing configured, the sign-in form is not shown. The log that prints a code exists only on a laptop. A new session must not add a staging stand-in.

The first live path is SMS alone, before the WhatsApp template. The director has asked InforU to open the account. When the details arrive, mount all three of `INFORU_USERNAME`, `INFORU_TOKEN` and `SMS_SENDER`, and leave `PORTAL_WHATSAPP_TEMPLATE` unset. One or two of the three refuses to boot. The token goes through `./infra/set-secret.sh staging`, never into the repo or a chat. The username and the sender name are settings. The sender name is at most 11 Latin letters or digits, chosen by the director, and it has to be the name InforU has whitelisted. The deploy does not mount these three yet, on purpose. The existing WhatsApp inbox secrets do not start this flow.

InforU's IP allowlist is still open. Staging has no fixed outbound address, and a fixed address is a separate paid change, not part of this ticket. Ask InforU whether this account can send without one.

Then click staging on the director's own Israeli mobile. The phone screen names SMS only, and there is no WhatsApp card. The comment that records that click is what checks the last box.
