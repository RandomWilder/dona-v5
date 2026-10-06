---
number: 193
title: WhatsApp on Meta's test number
status: open
labels: [ready-for-agent]
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

- [ ] An unsigned or wrongly signed webhook is rejected
- [ ] Recorded inbound, echo, media and history payloads each land where SPEC-channel.md says
- [ ] Seven days without an echo shows the warning; an echo clears it
- [ ] Clicked on staging: a message to Meta's test number appears in the tab, and a reply on the same conversation attaches to the call

## Blocked by

- #186 — The intake door, with the sorter faked
