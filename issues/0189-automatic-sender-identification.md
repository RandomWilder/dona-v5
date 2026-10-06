---
number: 189
title: Automatic sender identification and "save this contact"
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

The door's identify step. `scope` gains the email form of the isolation join beside the phone form:
a sender address resolves to a Party through a PartyContact valid today. One match identifies the call
and moves it to IDENTIFIED. None, or more than one, leaves it in NEW with the raw address for a
person. A guarantor's contact never identifies a requester for service (foundation rule 7).

On a call identified by hand, the worker can "save this contact": an explicit act, through parties'
contract, that adds the sender's address to the Party as a PartyContact. Identifying by hand alone
still saves nothing, so a mistake cannot route the next message to the wrong household.

## Acceptance criteria

- [ ] The email join resolves only contacts valid today, and has policy cases red first, beside the phone join's
- [ ] One match identifies; no match and two matches leave the call in NEW
- [ ] A guarantor-only match does not identify; a policy case covers it
- [ ] "Save this contact" creates a PartyContact, is audited, and the next message from that address is identified automatically
- [ ] Identifying by hand without saving leaves the next message from that address in NEW
- [ ] Clicked on `:3000` with a fabricated message

## Blocked by

- #186 — The intake door, with the sorter faked
