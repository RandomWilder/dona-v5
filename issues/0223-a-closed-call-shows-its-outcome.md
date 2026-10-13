---
number: 223
title: A closed call shows its outcome
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [220]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

A call is closed only from its page. Success returns to that call with a receipt naming the exit.
The receipt appears only on that arrival. It links to the first call on the unfiltered open list,
and the link is absent when nothing is open.

The closed page shows an outcome card instead of the eight steps: who closed it, how long it was
open, the states it actually passed, and the reason for the exit. Every later call that continues
this one is listed, newest first, apart from the duplicates. The page shows the close time and the
time open, and never the goal words, a goal colour, or a goal mark, even when the call is older
than the red threshold.

A call that was ever an emergency says היה חירום, including when the flag is still stored. Closing
does not clear the flag. The page offers no flag, clear, return, exit, identify, or category
action. A posted flag or clear is refused and the flag is unchanged. Filing still works for someone
who may file. Saving the sender as a contact still works when it would have been offered before the
close, as one button titled שמירת איש קשר, with no next-step label. The line that the page has no
actions appears only when that button is absent.

The requester's name links to the profile under the same rule as on an open call. Back goes to the
closed list. The party profile still shows the stored flag as חירום or לא.

## Acceptance criteria

- [x] The calls spec records the receipt, the read-only closed page, and the flag refusal, before the code
- [x] Each exit lands on the call with a receipt naming that exit; a reload without the receipt shows none; the next-call link opens the first open call and is absent when none are open
- [x] The outcome card replaces the steps and shows the actor, the duration, the states actually passed, and that exit's reason
- [x] Later calls are listed newest first; duplicates stay on their own card
- [x] A closed call older than red shows none of the goal words, no goal colour, and no goal mark
- [x] היה חירום shows when the call was ever flagged, including while the flag is still stored; closing does not clear it
- [x] Flag, clear, return, exit, identify, and category are refused; a posted flag or clear leaves the flag unchanged
- [x] Filing still works; save-contact is offered under the same rule as before the close, titled שמירת איש קשר; the no-actions line appears only when that button is absent
- [x] The requester links to the profile only for someone who can open it; back goes to the closed list; the party profile's emergency words are unchanged
- [x] The route test covers each exit, the receipt, the next call, a refused flag, a closed call past the goal, and the duration boundaries around an hour and around a day
- [ ] Clicked on `:3000`

## Comment — 2026-10-13

A close returns to that call with a receipt naming the exit. The receipt is only on that arrival, and it links the first open call, or none when the open list is empty. The closed page shows the outcome instead of the steps, says היה חירום when the call was ever flagged, and refuses a posted flag or clear without changing the stored flag. Filing and save-contact still work. The route test covers it. On :3000, signed in, the calls tab and the empty closed list opened. A new close was not submitted.

## Blocked by

- #220 — The open call is worked from the aside
