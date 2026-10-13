---
number: 217
title: The open list leads with what needs attention
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

The open call list becomes the hero of קריאות, on the glass language the assets screens already use.
Emergencies lead, including one still inside the response goal, oldest first. Open calls past the
goal follow them, oldest first. Calls near the goal stay with the other open calls, newest first.
An empty group is left out.

An open call shows its age as בזמן, קרוב ליעד, or מעבר ליעד. An emergency also carries the word
חירום. The near-or-past filter is labeled לא בזמן. The counts on the segments, the summary, and the
stat row are every open call, whatever filter is on screen. The closed segment has no count. The
red stat is titled מעבר ליעד המענה, with the near-goal count beside it.

The existing closed filter still lists closed calls, and a closed call shows no goal words, no goal
colour, and no goal mark. The thirty-day closed list is a later ticket. There is no search on this
list. Logging a call stays where it is until the dialog ticket.

## Acceptance criteria

- [ ] The calls spec records the urgent group, the late filter, the unfiltered counts, and that a closed call has no response-goal band, before the code
- [ ] Emergencies lead, oldest first, then past-goal calls, oldest first; near-goal calls stay with the other open calls, newest first; an empty group is omitted
- [ ] Open calls show בזמן, קרוב ליעד, or מעבר ליעד; an emergency also shows the word חירום
- [ ] לא בזמן means near or past; the amber filter still excludes past; the red filter still means past only; neither amber nor red has its own segment
- [ ] Counts of open, emergency, late, and to-review ignore the active filter; the closed segment has no count; a short list can sit under a larger open total
- [ ] The red stat is מעבר ליעד המענה, with the near-goal count beside it
- [ ] Category and state menus keep the other filters; an inactive category is marked לא פעיל; the state menu lists the open states
- [ ] Mailbox, WhatsApp, and secret warnings sit above the list, each with a way to settings; the filtered-list control shows how many rows are set aside
- [ ] A closed call reached through the existing closed filter shows none of the goal words, no goal colour, and no goal mark
- [ ] The list has no search
- [ ] The page is server-rendered, the existing marks the tests select on are still present, and the route test covers the group, the filters, the counts, and a closed call past the goal
- [ ] Clicked on `:3000`

## Blocked by

None (can start immediately).

## Comment — 2026-10-13

The open list leads with emergencies, oldest first, then calls past the goal, oldest first. Calls near the goal stay with the other open calls, newest first, and an empty group has no heading. Open calls read בזמן, קרוב ליעד, or מעבר ליעד, and an emergency also reads חירום. לא בזמן is near or past. Amber still excludes past, red is past only, and neither has a segment. The open, emergency, late, and to-review counts ignore the filter. The closed segment has no count. The red stat is מעבר ליעד המענה, with the near-goal count beside it. A closed call on the existing closed filter has none of the goal words, no goal colour, and no goal mark. There is no search. Logging stays a form on the page.

The route test covers the group, the filters, the counts, and a closed call past the goal. The full suite is green. The restarted server on :3000 serves that page to a signed-in session. The browser itself stops at Google sign-in, so that check was the live process, not a click through the login screen.
