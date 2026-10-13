---
number: 216
title: "The קריאות tab matches the approved screens"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 181
created: 2026-10-13
closed: 2026-10-13
---

## Problem Statement

The office already works ServiceCalls in the קריאות tab: four Source channels, a state machine, the
response goal, Emergency, Filtered messages, and the four Exits. The screens that hold that work
still read as a form stacked on a list. Logging a call pushes the list below the fold. An emergency
is red text. The response goal is the words כתום and אדום. Closing a call returns to the same page
with no receipt, and a closed call is drawn with the same goal language as an open one. The filtered
list is a wall of buttons.

The stakeholder screens for the tab were approved, including a later pass for closed calls. A
grilling session on 2026-10-13 settled the behaviour those screens imply. The vocabulary is in
`CONTEXT.md`: **ServiceCall**, **Sender** (נרשם), **Requester** (פונה), **Source channel**,
**Category**, **Emergency**, **Response goal**, **Exit**, **Filtered message**, **Predecessor**
(המשך של), **the sorter**. Where this spec and the screen notes disagree, this spec wins. In
particular the log dialog asks for the sender, the eight steps are an indicator, the open list has
no search, and the near-or-past segment is labeled לא בזמן.

## Solution

The three screens — the call list, the call page, and the filtered list — are rebuilt on the glass
language the assets screens already use. The list is the hero. Logging a call is a dialog on that
list. The tab opens as a split inbox, with a list view as the alternative and as the only layout on
a narrow screen. Open calls show the response goal as בזמן, קרוב ליעד, or מעבר ליעד. Emergencies,
and open calls past the goal, lead the list.

Closing stays a command from the call page only. Success returns to that call with a one-time
receipt and a link to the first open call. A closed call is read-only except for filing an
attachment and, when it would have been offered before the close, saving the sender as a contact.
The closed list shows the last 30 days, grouped by the day of the close, and can be narrowed by
Exit. The filtered list is the same list it is today, narrowed to what the sorter set aside or what
the office sent back.

Pages stay server-rendered. No client JavaScript is added. Routes, methods, and field names stay as
they are.

## User Stories

### The open list

1. As a receptionist, I want the call list to be the first thing on קריאות, so that I see the work before I see a form.
2. As a receptionist, I want קריאות to open as a split inbox, a list beside a preview of one call, so that I can read a call without leaving the list.
3. As a receptionist, I want a list view I can switch to, so that I can scan every open call as a card.
4. As a receptionist, I want a narrow screen to show only the list view, so that the split inbox is not crushed into one column.
5. As a receptionist, I want the open calls that need attention now grouped under דורש טיפול עכשיו, so that emergencies and calls past the goal are not mixed with ordinary work.
6. As a receptionist, I want every open emergency in that group, including one still inside the goal, so that an emergency is never buried because it is new.
7. As a receptionist, I want a non-emergency call past the goal in that same group, after the emergencies, so that a late call is visible without being treated as an emergency.
8. As a receptionist, I want calls near the goal to stay with the other open calls, so that "near" is not the same as "past" or "emergency".
9. As a receptionist, I want the urgent group ordered emergencies first, oldest first within the emergencies, then past-goal calls, oldest first, so that the call that has waited longest comes first inside each kind.
10. As a receptionist, I want the other open calls in the order the list uses today, newest first, so that ordinary work does not change its order.
11. As a receptionist, I want an empty group left out, so that I do not see a heading over nothing.
12. As a receptionist, I want each open call to show its age as בזמן, קרוב ליעד, or מעבר ליעד, so that the goal is words I can act on rather than the names of colours.
13. As a receptionist, I want an emergency to carry the word חירום as well as a red mark, so that the flag is not conveyed by colour alone.
14. As a receptionist, I want to filter the open list to emergencies, to calls that are near or past the goal, to calls marked for review, or to closed calls, so that each kind of work has one control.
15. As a receptionist, I want the near-or-past filter labeled לא בזמן, so that the control names both קרוב ליעד and מעבר ליעד.
16. As a receptionist, I want the existing amber filter to keep excluding calls past the goal, so that a link I already have still means what it meant.
17. As a receptionist, I want the existing red filter to keep meaning past the goal only, so that the new combined filter does not erase it.
18. As a receptionist, I want the counts on the segments, the summary, and the stat row to be every open call, ignoring the filter I am looking at, so that they mean the same thing as the count beside קריאות in the rail.
19. As a receptionist, I want the closed segment to show no count, so that an all-time total is not presented as a workload.
20. As a receptionist, I want the red stat titled מעבר ליעד המענה, with the near-goal count beside it, so that past and near stay distinct in the summary.
21. As a receptionist, I want a filtered list of two calls to still be allowed to say that seven calls are open, so that the summary is the book and the list is the filter.
22. As a receptionist, I want choosing a call in the split inbox to preview that call and keep my filter, so that selection does not clear the segment I am on.
23. As a receptionist, I want a selected call that is missing, closed, returned, or outside the filter to be skipped, and the first call in the current list previewed instead, so that the preview never shows a call the list does not contain.
24. As a receptionist, I want an empty list to have an empty preview, so that I am not shown a call from outside the filter.
25. As a receptionist, I want no search box on the open list, so that this work does not invent a query the spec does not have.
26. As a receptionist, I want the category menu and the state menu to keep my other filters when I pick one, so that narrowing by trade does not drop the segment I was on.
27. As a receptionist, I want an inactive category marked לא פעיל in that menu, so that I can see why a call still carries it and not choose it for a new one.
28. As a receptionist, I want the state menu to list the open states, so that closed calls stay on their own segment.
29. As a receptionist, I want a warning when the mailbox has not been read, when WhatsApp has had no echo, and when the mail secret is due or expired, each with a way to the settings, so that a stalled channel is visible above the list.
30. As a receptionist, I want the count of filtered rows on the way into the filtered list, so that I know there is something set aside before I open it.
31. As a receptionist, I want the list view to say that every channel is in this one place, so that the old line about phone and walk-in only is gone.
32. As a receptionist, I want the split inbox to summarise open calls, emergencies, and calls past the goal beside the title, so that the summary replaces the long lede and the stat row on that layout.
33. As a developer, I want the test intake control to remain, and only where it is offered today, so that a local check can still inject a message.

### Logging a call

34. As a receptionist, I want logging a call to open a dialog on the list, so that the list stays where it is.
35. As a receptionist, I want that dialog to offer only phone and walk-in, so that email and WhatsApp keep arriving on their own.
36. As a receptionist, I want the dialog to ask for a channel, what happened, and a sender, so that the three required fields stay the three required fields.
37. As a receptionist, I want the sender labeled נרשם, with שם ידוע and לא ידוע, so that I am not asked to identify the requester while logging.
38. As a receptionist, I want the name field's placeholder to be שם, so that the word פונה is reserved for the party identified later.
39. As a receptionist, I want a hint that the requester can be identified afterwards from the call page, so that "unknown" is not a dead end.
40. As a receptionist, I want a named sender with no name to be refused, and the dialog to stay open with what I typed, so that a mistake does not lose the description.
41. As a receptionist, I want a successful log to return to the open list, as it does today, so that the new call is in the work I just came from.
42. As a receptionist, I want to cancel the dialog and land back on the list with my filters kept, so that opening the form is not a commitment.

### The open call

43. As a receptionist, I want the call page to show where the call is among the eight states, so that I can see what has happened and what has not.
44. As a receptionist, I want those eight steps to do nothing when pressed, so that the strip is an indicator and the aside is the only place an action appears.
45. As a receptionist, I want a new call to offer identification of the requester, and only for this call, so that linking a party does not save a contact.
46. As a receptionist, I want an identified or triaged call to offer the category, so that the trade is chosen by a person.
47. As a receptionist, I want more than a short list of categories to fall back to the existing category control, so that a long catalogue still fits.
48. As a receptionist, I want saving the sender as a contact when that command is offered, so that the next message from that address can be identified by the door.
49. As a receptionist, I want a returned call to offer rescue back onto the list, so that a call the office sent to the filtered list can be restored from its own page.
50. As a receptionist, I want no next step from the point where responsibility would be set, so that the unbuilt visit flow is not pretended on the page.
51. As a receptionist, I want to close the call from this page, with the exit I choose and only the fields that exit needs, so that one form does not show every reason at once.
52. As a receptionist, I want the close control to say which exit I am about to use, and that closing is final and a new message opens a new call, so that I do not think the call can be reopened.
53. As a receptionist, I want a refused exit to keep the exit I chose and the values I entered, so that I can correct the reason without starting over.
54. As a receptionist, I want to flag or clear an emergency from the header while the call is open, so that the separate emergency card is gone and the command remains.
55. As a receptionist, I want to send an open call that is not a call back to the filtered list, so that spam leaves the list without becoming a closed call.
56. As a receptionist, I want the requester's name to link to that party's profile when I am allowed to open profiles, so that I can see who they are from the call.
57. As a receptionist, I want the sender and the requester shown as two facts, נרשם and פונה, so that a name typed at the desk is not mistaken for an identified party.
58. As a receptionist, I want the conversation to show the inbound message, the office echo, and the system events in the order they already have, so that the thread is the same record in a new shape.
59. As a receptionist, I want a translation shown apart from the original, so that I can read the Hebrew without losing the sender's words.
60. As a receptionist, I want to open an attachment, and to file it as a document when I am allowed to file, so that evidence work stays on the message.
61. As a receptionist, I want a filed attachment to say that it is filed and to open the document, so that the link no longer says it is not filed.
62. As a receptionist, I want the file size in ordinary units, so that I see 242 KB rather than a raw byte count.
63. As a receptionist, I want calls that repeat this one listed under it, so that a duplicate still points both ways.
64. As a receptionist, I want to go back to the open list, so that I return to the work queue.

### Closing

65. As a receptionist, I want to close a call only from its page, so that the list and the preview cannot close one by accident.
66. As a receptionist, I want a successful close to bring me back to that call with a receipt naming the exit, so that I can see it left the open list.
67. As a receptionist, I want that receipt only on the arrival after the close, so that a reload or a shared link does not keep announcing it.
68. As a receptionist, I want the receipt to offer the next open call, so that I move to the next piece of work.
69. As a receptionist, I want that next call to be the first row of the unfiltered open list, so that I am taken to the most urgent open call in the whole book, not to whatever filter I had on.
70. As a receptionist, I want no such link when nothing is open, so that I am not sent to a missing call.
71. As a receptionist, I want a closed call to show an outcome card instead of the eight steps, so that an exit before a visit does not draw work that never happened.
72. As a receptionist, I want the outcome to name who closed it, how long it was open, and the states it actually passed, so that a call closed while still new does not look as if it was scheduled.
73. As a receptionist, I want the outcome to show the reason for the exit I used, so that the note, the department, the other call, or the cancellation is on the card.
74. As a receptionist, I want every later call that continues this one listed on the outcome, newest first, so that more than one message after the close is visible.
75. As a receptionist, I want those later calls kept apart from the duplicates, so that המשך של and a duplicate exit stay two links.
76. As a receptionist, I want a closed call to show when it closed and how long it was open, and never בזמן, קרוב ליעד, מעבר ליעד, a goal colour, or a goal mark, so that a closed call has no response-goal band.
77. As a receptionist, I want a closed call that was ever an emergency to say היה חירום, including when the flag is still stored, so that the history is visible and the live chip is not.
78. As a receptionist, I want closing to leave the stored emergency flag as it is, so that close is not a silent clear.
79. As a receptionist, I want no flag, clear, return, exit, identify, or category action on a closed call, so that the page cannot change the call.
80. As a receptionist, I want a posted flag or clear on a closed call to be refused and the flag left unchanged, so that hiding the button is not the only guard.
81. As a receptionist, I want to keep filing an attachment on a closed call when I am allowed to file, so that filing stays evidence work and not a call action.
82. As a receptionist, I want to save the sender as a contact on a closed call when that command would have been offered before the close, so that the next message from that address is not left unidentified.
83. As a receptionist, I want that save control titled שמירת איש קשר, without a "next step" label, so that it is not presented as a step in a call that is over.
84. As a receptionist, I want a line that the closed page has no actions only when that save control is absent, so that the line is not on screen beside a button.
85. As a receptionist, I want the requester's name on the closed page to link to the profile under the same rule as the open page, so that both pages treat the party the same way.
86. As a receptionist, I want the name in the split preview to stay text, so that the profile link lives on the call page.
87. As a receptionist, I want back from a closed call to go to the closed list, so that I return to closed work rather than to the open queue.
88. As a receptionist, I want the party's profile to keep showing חירום or לא for the stored flag, so that this work does not change that list.

### The closed list

89. As a receptionist, I want the closed segment to show calls closed in the last 30 days, newest close first, so that the list is recent work and not the whole history.
90. As a receptionist, I want them grouped as today, yesterday, the rest of the Israeli week back to Sunday, and older, so that I can see when they were finished.
91. As a receptionist, I want an empty group left out, so that a Sunday or a Monday does not show a week heading with nothing under it.
92. As a receptionist, I want to load the previous 30 days, and only when a closed call exists before the window, so that I am not offered an empty page.
93. As a receptionist, I want to narrow the closed list by exit, with counts that match the calls on the page I am looking at, so that the numbers and the rows agree.
94. As a receptionist, I want the category menu to remain on the closed list, so that I can still narrow by trade.
95. As a receptionist, I want the open-call summary to stay about open calls while I am looking at closed ones, so that the counts do not change meaning with the segment.
96. As a receptionist, I want a closed row to show the exit and the close time, with no goal marker, so that a call that would have been past the goal is not painted as late.
97. As a receptionist, I want a closed call that was ever an emergency to carry היה חירום on the row, so that the history is on the list as well as the page.
98. As a receptionist, I want the split preview of a closed call to show the outcome and not a next step, a progress strip, or a message bubble, so that a finished call is not drawn as work in progress.
99. As a receptionist, I want an older closed call to remain on its own page and on the requester's profile, so that the 30-day window is only the list.
100. As a receptionist, I want an empty closed window to say there is nothing in the last 30 days, and a filtered empty window to say nothing matches, so that the two empties read differently.

### The filtered list

101. As a receptionist, I want the filtered list to keep one meaning, a message the sorter set aside or a ServiceCall the office sent back, so that the two origins are filters and not two new kinds of thing.
102. As a receptionist, I want to see all of them, only what the sorter set aside, or only what the office returned, so that I can work one origin at a time.
103. As a receptionist, I want each row to show the sorter's verdict, the channel, and when it arrived or was returned, so that I can tell a newsletter from a call the office sent back.
104. As a receptionist, I want a returned row to link to its call, so that I can open the ServiceCall that is still on record.
105. As a receptionist, I want to rescue either origin back onto the call list in one action, so that a mistake is undone from the card.
106. As a receptionist, I want the rescue control to say הצלה — זו קריאה, so that the action is the same words on the card and on the returned call.

### The whole tab

107. As a receptionist, I want every one of these screens to work with links, forms, and disclosure, and with no script, so that the tab stays server-rendered.
108. As a receptionist, I want the log dialog not to trap my keyboard, so that the lack of a script is honest about focus.
109. As a receptionist, I want phone numbers, email addresses, and file names to read left to right, so that they are not reversed in the Hebrew page.
110. As a receptionist, I want the existing marks the tests already rely on to remain on the new screens, so that a redesign does not silently drop a fact.
111. As the office, I want the pages to use the same glass language as the assets screens, so that קריאות does not invent a second visual system.

## Implementation Decisions

- The work is in the calls module, plus the shared visual language the assets screens already use. New colours, sizes, and elevations become shared tokens. The pages contain no raw colours, no font names, and no inline presentation.
- Routes, methods, and field names are unchanged. Logging still accepts a channel, a description, and a sender or unknown. A successful log still redirects to the open list. A refusal re-renders the list with the dialog open and the fields kept.
- The open list's default response is the split inbox. The list view is requested explicitly, and it is also the layout a narrow viewport shows. The default response includes both layouts so the server does not need to know the viewport; the list-view request includes only the list. The list rows keep the existing per-call marks. The split rows carry a different mark, so one call is not counted twice.
- The urgent group is a layout of two existing facts, Emergency and a past-goal band. It is not a new noun. Within it, emergencies come before past-goal calls, and each of those is oldest first. The other open calls stay newest first, which is the list's current order once emergencies are taken out of it.
- The response-goal words בזמן, קרוב ליעד, and מעבר ליעד apply only to an open call. Absence of a band on an open call means בזמן. Absence of a band on a closed call means the close-time cell. A closed call never takes the open-call helper.
- The segment labeled לא בזמן is the existing goal filter extended with one value, late, meaning near or past. Amber still excludes past. Amber and red remain valid and have no segment of their own.
- Counts of open calls, emergencies, near, past, late, and to-review are computed over every open call, ignoring the active filter. The closed segment is uncounted. The cheapest single read that already lists open calls is used, and the choice is recorded with the reason. The filtered badge is a count of that list.
- A selected call is previewed only when it is in the current rows. Otherwise the first row is previewed. The preview is loaded for the split inbox and not for the list-view request. Its excerpt is the first inbound message, truncated, then the summary, then the description.
- Identify matches stay name only. The parties contract is not widened for a role or an address.
- There is no search on the call list.
- The eight steps are drawn for an open call and are not controls. A closed call draws the outcome card instead. The path on that card is derived from the transitions the call already has. It is not a new stored field.
- The requester's name links to the party profile on the open call page and the closed call page, and only when this person can open that profile. The split preview does not link the name. The party profile's own call list is unchanged: it still shows the stored flag as חירום or לא.
- Closing redirects back to the call with a receipt parameter. The receipt renders only when that parameter is present and the call is closed. The next-call link is read only for that receipt, and it is the first row of the unfiltered open list under the new order.
- A closed call refuses flag and clear. Return, exit, identify, and category already refuse a closed call; they stay refused. The refusal is in the command the route already calls. No new database constraint is added for the flag. The emergency mark the tests already read continues to report the stored flag, including on a closed call whose visible chip says היה חירום.
- Save-contact on a closed call uses the same offer rule as on an open call. It is one aside button, titled שמירת איש קשר, with no next-step label. Filing stays available to someone who may file. The "no actions" line is rendered only when the save button is absent.
- The closed list is the same page and the same view toggle as the open list, filtered to closed, ordered by close time newest first, limited to a 30-day window, and paged by the previous 30 days. The older link is shown only when a close exists before the window. Exit counts match that window. Days are grouped in the office's zone: today, yesterday, the rest of the week back to the most recent Sunday, then older.
- An index on close time is added only if a measurement shows the planner chooses it. The plan and the timings are written into the calls spec, as the requester index was. An index the planner will not choose is not added.
- Later calls are the calls that name this one as predecessor, newest first, read on the call page. Duplicates stay the existing repeated-by list.
- The filtered list gains the channel and the time it already has on the message, and a filter by origin. Counts for those segments come from the same read.
- A filed attachment's link text becomes the filed state and a way to open the document. The link target is already the document.
- The calls spec's description of the tab is updated in the same change as the behaviour, and it is updated first. It records the dialog, the urgent group, the late filter, the unfiltered counts, the split inbox, the indicator, the filtered origins, the closed call's lack of a band, the receipt, the read-only closed page, and the 30-day closed list.
- No client script is added. The dialog does not trap focus.

## Testing Decisions

- One seam tests the behaviour: the existing calls route test. Sign in the way the office does, submit the form, and read the page or the redirect. A good test asserts what the office can see and what a post does — the words, the marks the tests already select, the filter, the redirect, and a refusal — and does not assert the structure of the markup beyond those marks.
- That seam covers the open list, the dialog, the call page, the close, the closed list, and the filtered list. A selected call outside the list, an empty list, the unfiltered counts, the late filter, the 30-day window, the older page, the receipt, the next open call, and a closed call that was past the goal are all asserted there.
- A closed call older than the red threshold is rendered and must not contain בזמן, קרוב ליעד, מעבר ליעד, or the goal mark.
- Flagging or clearing a closed call is a post through that same route. The response is a refusal and the stored flag is unchanged.
- Time-to-close, including the boundaries around an hour and around a day, is read off the closed page with the clock fixed. It does not get a second test surface.
- The existing check that rendered screens contain no raw colours, no font names, and no inline presentation continues to render these screens, and it asserts that any new token is defined. It guards the markup. It is not a second place where behaviour is specified.
- No new database policy test is added for the flag. The route post is the proof.
- Prior art is the calls route test, which already drives the tab as a form post and then the list, and the token check, which already renders the call list, a call, and the filtered list.

## Out of Scope

- Search on the open list.
- The visit flow, from responsibility onward. Those states appear on the indicator and have no command here.
- A tenant-facing reply, an acknowledgement, or any change to what a tenant sees.
- Changing the emergency words on the party profile.
- A role or an address under an identify match.
- Thumbnails of attachments.
- A focus trap on the dialog.
- A new database constraint that rejects a flag on a closed call.
- A production release tag. Staging follows a green merge, as it does for any other change.

## Further Notes

This is #181's tab, brought up to the screens approved after it shipped. The grilling on
2026-10-13 is the behaviour above. The screen notes remain the visual reference for spacing, type,
and the glass treatment, and they lose wherever they still say the dialog asks מי פנה, that the
current step is actionable, that the list may grow a search, or that the near-or-past segment is
labeled ליעד.

When this is split into work, the order that keeps each slice clickable is: the shared tokens and
pieces, with nothing visible changed yet; the list view; the log dialog; the open call's shell; the
open call's actions; the filtered list; the split inbox as the default; the closed call and the
closed list; then a pass for narrow screens and a click through every path on the local site. The
local server does not watch for edits. It is restarted, and the path is clicked, before the slice
is called done.

The calls spec is edited before the code in each slice that changes behaviour. A mockup painted
for this flow is deleted once the flow is wired.

## Comment — 2026-10-13

Closed. All nine slices are closed: #217 the urgent group and filters, #218 the log dialog, #219 the
indicator, #220 the aside, #221 the filtered origins, #222 the split inbox, #223 the closed call and
its receipt, #224 the thirty-day closed list, and #225 the narrow pass. SPEC-calls.md was edited
ahead of the code in each. The close-time index in migration 0067 was added only after the
measurement this spec asks for, and the plans and timings are in both the migration and the spec.

Four slices (#217, #218, #221, #223) left their own click box unticked, because the browser stopped
at Google sign-in or a close was not submitted. #225 then clicked every path in the tab on a server
built from the branch, including all four exits, a refusal, and a closed call with and without the
receipt, so the tab as a whole has been clicked. That run used an auto-assigned port because :3000
was held by a stale server.

On the closing branch, typecheck is clean and the code suite passes 1,131 of 1,131, with the hooks
suite passing 41 of 41. The vocabulary this spec names (Sender, Requester, Response goal,
Predecessor, and the Emergency flag surviving a close) is committed to CONTEXT.md with this file.
