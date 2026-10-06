---
number: 194
title: The emergency reply by WhatsApp
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [185, 193]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

When a WhatsApp message is flagged an emergency, the system sends one fixed reply on the same
conversation with the duty phone number, composed from the duty contact rows with no model involved.
It is sent within the 24-hour customer-service window the inbound message opens, once per call, and
appears on the call's timeline. Its wording is the director's to approve; until then staging sends the
placeholder.

## Acceptance criteria

- [ ] A flagged inbound message produces exactly one reply, on staging's test number
- [ ] A second emergency message on the same open call does not send a second reply
- [ ] A call flagged by hand, or flagged on PHONE or WALK_IN, sends nothing
- [ ] The reply is on the timeline and audited; no model is called
- [ ] Clicked on staging

## Blocked by

- #185 — Emergency: the flag, the pin and the editable terms
- #193 — WhatsApp on Meta's test number
