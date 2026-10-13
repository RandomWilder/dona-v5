---
number: 220
title: The open call is worked from the aside
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [219]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

The open call is worked from the aside, and only where a command exists. A new call offers
identification of the requester, for this call alone. An identified or triaged call offers the
category. A long category list falls back to the existing category control. Saving the sender as a
contact is offered when that command is already offered. A returned call offers rescue back onto
the list. From the point where responsibility would be set, there is no next step.

Closing offers the four exits, and only the fields the chosen exit needs. The control names the
exit and says that closing is final and a new message opens a new call. A refused exit keeps the
exit and the values. Flagging and clearing an emergency, and sending a call back to the filtered
list, move to the header. The requester's name links to the party profile when this person can
open profiles.

The stacked cards those actions used to live in are gone.

## Acceptance criteria

- [x] The calls spec records that the aside is the only place an action appears, before the code
- [x] A new call can be identified; an identified or triaged call can take a category; save-contact appears only when it would have been offered; a returned call can be rescued; later states offer no next step
- [x] Each exit shows only its own fields; the control names the exit and says closing is final; a refusal keeps the exit and the values
- [x] Emergency and return to the filtered list are in the header, and absent when they do not apply
- [x] The requester's name links to the profile only for someone who can open profiles
- [x] Identify matches stay a name only
- [x] The route test covers identify, category, save-contact, flag, clear, return, each exit, and a refused exit
- [x] Clicked on `:3000`

## Blocked by

- #219 — The open call shows where it is

## Comment — 2026-10-13

The aside is the only place an action on an open call appears. A new call offers identification for this call alone, and a match is a name only. An identified or triaged call offers the category: six or fewer active categories are choices, and more than six is the select. Saving the sender as a contact appears only when that command would already have been offered. A returned call offers rescue. Rescue does not replace identification or the category while those commands still apply, and the four exits stay off until the call is back on the open list. From responsibility onward there is no next step. Each exit shows only its own fields, the close control names the exit and says that closing is final and a new message opens a new call, and a refused exit keeps the exit and the values. Flagging, clearing, and sending the call back to the filtered list are in the header, and they are absent when they do not apply. The requester's name links to the profile only for someone who can open profiles. The stacked cards are gone.

The route test covers identify, category, save-contact, flag, clear, return, each exit, and a refused exit. The full suite is green. Clicked on :3000: a new call, the flag and the return in the header, identification in the aside, and an answered exit that asks only for the reason.
