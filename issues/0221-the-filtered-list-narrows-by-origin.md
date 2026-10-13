---
number: 221
title: The filtered list narrows by origin
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

The filtered list becomes cards on the same glass language. It stays one list: a message the sorter
set aside, or a ServiceCall the office sent back. The receptionist can see all of them, only what
the sorter set aside, or only what the office returned.

Each row shows the sorter's verdict, the channel, and when it arrived or was returned. A returned
row links to its call. Either origin can be rescued back onto the call list, and the control says
הצלה — זו קריאה.

## Acceptance criteria

- [ ] The calls spec records the two filters on the one list, before the code
- [ ] All, sorter-set, and office-returned are three views, with counts, and a returned row is still a ServiceCall
- [ ] Each row shows the verdict, the channel, and the time; a returned row links to its call
- [ ] Rescue from either origin uses the words הצלה — זו קריאה and returns the call to the open list
- [ ] The page is server-rendered and the existing marks remain
- [ ] The route test covers both origins, both filters, and a rescue from each
- [ ] Clicked on `:3000`

## Blocked by

- #217 — The open list leads with what needs attention

## Comment — 2026-10-13

The filtered list stays one list. הכל shows both origins, המסווג only what the sorter set aside, המשרד only what the office returned. The three counts come from that same read. A returned row is still the ServiceCall and links to it. Each row shows the sorter's verdict when there is one, the channel, and the time it arrived or was returned. Rescue from either origin says הצלה — זו קריאה and puts the call back on the open list. An empty view does not claim the book is empty while the other origin still has rows.

The route test covers both origins, both filters, and a rescue from each. The full suite is green. The restarted server on :3000 serves the three views to a signed-in session. The browser itself stops at Google sign-in, so that check was the live process, not a click through the login screen.
