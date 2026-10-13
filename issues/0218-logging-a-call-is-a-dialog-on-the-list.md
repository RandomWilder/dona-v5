---
number: 218
title: Logging a call is a dialog on the list
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

Logging a phone or walk-in call opens a dialog on the list, and the list stays underneath. The
dialog asks for a channel, what happened, and a sender. The sender is labeled נרשם, with שם ידוע
and לא ידוע. The name field's placeholder is שם. A hint says the requester can be identified later
from the call page.

A named sender with no name is refused. The dialog stays open and what was typed is kept. A
successful log returns to the open list, as it does today. Cancelling returns to the list with the
filters kept. Email and WhatsApp are not offered. The page stays server-rendered, and the dialog
does not trap the keyboard.

## Acceptance criteria

- [ ] The calls spec records the dialog before the code
- [ ] The dialog offers only phone and walk-in, a description, and a sender or unknown
- [ ] The sender control is labeled נרשם, the choices are שם ידוע and לא ידוע, the placeholder is שם, and the hint says the requester is identified later from the call page
- [ ] A named sender with no name is refused, the dialog stays open, and the typed fields are kept
- [ ] A successful log redirects to the open list
- [ ] Cancel returns to the list with the current filters kept
- [ ] No client script is added
- [ ] The route test covers phone and walk-in, named and unknown, and a refusal
- [ ] Clicked on `:3000`

## Blocked by

- #217 — The open list leads with what needs attention

## Comment — 2026-10-13

Logging a call opens a dialog on the list, and the list stays underneath. The dialog offers only phone and walk-in, a description, and a sender labeled נרשם, with שם ידוע and לא ידוע. The name field's placeholder is שם, and a hint says the requester can be identified later from the call page. A named sender with no name is refused, the dialog stays open, and what was typed is kept. Cancel returns to the same list and the same filters. A successful log redirects to the open list. The page stays server-rendered, and the dialog does not trap the keyboard.

The route test covers phone and walk-in, named and unknown, and a refusal. The full suite is green. On :3000 the dialog was opened from the emergency filter, a nameless sender was refused with the description kept, and cancel returned to that filter.
