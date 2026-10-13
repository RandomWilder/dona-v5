---
number: 219
title: The open call shows where it is
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [217]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

The open call page shows the description, the channel, the age against the response goal, and the
word חירום when the call is flagged. Eight steps show where the call is. Pressing a step does
nothing.

The conversation shows the inbound message, the office echo, and the system events in the order
they already have. A translation sits apart from the original. An attachment can be opened, and
filed as a document when the person may file. Its size is in ordinary units. A filed attachment
says that it is filed and opens the document. Calls that repeat this one stay listed under it.
The sender and the requester are two facts, נרשם and פונה. Back returns to the open list.

The identify, category, save-contact, emergency, return, and exit actions that already exist keep
working on this page. Moving them into the aside is the next ticket.

## Acceptance criteria

- [x] The calls spec records the eight steps as an indicator, before the code
- [x] The header shows the description, the channel, the age with its band words, and חירום when the call is flagged
- [x] The eight steps are visible and do nothing when pressed
- [x] The conversation keeps the current order, and a translation is separate from the original
- [x] An openable attachment opens; a person who may file can file it; the size is in ordinary units; a filed attachment says it is filed and opens the document
- [x] נרשם and פונה are shown as two facts; duplicates stay listed; back returns to the open list
- [x] Identify, category, save-contact, emergency, return, and exit still work
- [x] The page is server-rendered and the existing marks remain
- [x] The route test covers the indicator, the conversation, and a filed attachment
- [x] Clicked on `:3000`

## Blocked by

- #217 — The open list leads with what needs attention

## Comment — 2026-10-13

An open call shows its description, channel, and age as בזמן, קרוב ליעד, or מעבר ליעד, and חירום when it is flagged. The eight states are an indicator: the current step is current, earlier steps are behind it, and later steps are ahead. Pressing a step does nothing. A closed call does not draw the indicator. The conversation keeps its order. A translation sits apart from the original and is still labeled תרגום. An attachment opens, a person who may file can file it, the size is in B, KB, or MB, and a filed attachment says תויק and opens the document. נרשם and פונה stay two facts. Duplicates stay listed. Back returns to the open list. Identify, category, save-contact, emergency, return, and exit stay on the page.

The route test covers the indicator, the conversation, a filed attachment of 242 KB, and a closed call with no indicator. The full suite is green. Clicked on :3000: a flagged call past the goal, a new call with its message, a step that does not move, and back to the open list.
