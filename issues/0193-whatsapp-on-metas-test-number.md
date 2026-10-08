---
number: 193
title: WhatsApp on Meta's test number
status: open
labels: [ready-for-human]
assignee:
blocked_by: [186]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The WhatsApp adapter, by the Cloud API with coexistence (ADR-0013). The webhook verifies Meta's
signature and rejects anything unsigned. It consumes inbound messages and `smb_message_echoes`, the
messages the receptionist sends from the phone: inbound messages go through the door with the
WhatsApp conversation as the thread, and echoes are stored on the conversation and the call's
timeline and never open a call. Media is fetched on receipt and stays on the Message. The `history`
webhook is acknowledged and discarded.

No echo for 7 days raises a warning in the tab, ahead of Meta disconnecting a primary device inactive
for about 14 days. Staging uses Meta's developer test number, so all of this is built and clickable
before App Review finishes. The adapter is tested on recorded webhook payloads.

## Acceptance criteria

- [x] An unsigned or wrongly signed webhook is rejected
- [x] Recorded inbound, echo, media and history payloads each land where SPEC-channel.md says
- [x] Seven days without an echo shows the warning; an echo clears it
- [ ] Clicked on staging: a message to Meta's test number appears in the tab, and a reply on the same conversation attaches to the call

## Comment — 2026-10-08

The adapter is in. An unsigned or wrongly signed webhook is refused. A recorded inbound message opens a call, an echo on that conversation attaches and does not open another, media is fetched onto the message, and a history payload is answered and not stored. Seven days without an echo warns on the קריאות list; an echo clears it. The process stays `whatsapp: unconfigured`, and the tab stays quiet, until all four settings are present.

Left for the director: Meta's developer test number, then `./infra/set-secret.sh staging` for whatsapp-app-secret, whatsapp-verify-token, whatsapp-access-token, and whatsapp-phone-number-id. The next staging deploy mounts whichever of those exist. The callback is `/webhooks/whatsapp`. Production is not mounted.

## Blocked by

- #186 — The intake door, with the sorter faked
