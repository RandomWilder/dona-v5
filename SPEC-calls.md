# SPEC: calls

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The vocabulary is
[CONTEXT.md](CONTEXT.md)'s; the build is tracked by #181.

- **Owns:** a ServiceCall from intake to close, and the visit it produces. Also the emergency terms,
  the duty contact, the Category list, the response-goal thresholds, and Filtered messages.
- **Entities:** ServiceCall · Visit · Category · Filtered message, plus the state machine: NEW ·
  IDENTIFIED · TRIAGED · RESPONSIBILITY SET · WINDOWS COLLECTED · OFFERED · SCHEDULED · CLOSED, and
  the four Exits.
- **Depends on:** scope, policy, parties.

## What is settled

**The state machine is deterministic and no model decides a transition** (foundation rule 3).
Every transition is a command a person issues, a timer this module owns, or the door
identifying exactly one party from the sender's address. The sorter's proposal
is stored on the call and displayed; no command reads it to decide anything. **"To review" is a
mark, not a state.** The door sets it when the sorter is unsure or fails, and when an emergency
term matched and the verdict was not a plain call. No command reads the mark to choose a
transition.

**An intake call** (EMAIL, WHATSAPP or PORTAL) is opened by the door with no staff account. The
list shows the raw sender address until the requester is identified. A call opened by hand still
names the staff account that logged it.

**A ServiceCall is any request that reached the office**, on any Source channel: `WHATSAPP · EMAIL ·
PHONE · WALK_IN · PORTAL`, set once at intake and never changed. A question is a ServiceCall, closed
by the Answered Exit. The requester is identified, never presumed. A call whose sender resolves to
no Party, or to more than one, waits in NEW with the raw sender address until a person identifies
it.

**Identifying a sender links that call and nothing else.** Adding the address to the Party as a
PartyContact is a separate, explicit act ("save this contact") through parties' contract. A
mistaken identification must not route the next message from that address to the wrong household.
A guarantor's contact never identifies a requester for service (foundation rule 7).

Hand identification is a command on that one call. It sets the requester and moves NEW →
IDENTIFIED, and it writes no PartyContact. The database rejects the link when the party is a
guarantor and is not a service contact on any tenancy. A party who is a service contact can be
the requester even if they also guarantee another lease, and a party on no lease can — an owner,
a neighbour, a contractor. Setting a Category is the next command and moves IDENTIFIED →
TRIAGED; a later change of Category stays on TRIAGED. Only an active Category can be chosen.
Deactivating a Category leaves it on the calls that already carry it. Both commands are audited
and appear on the call's timeline with the staff account that issued them.

**The door identifies from the address.** When the isolation join returns exactly one party, the
door moves that new call NEW → IDENTIFIED with no staff account. The timeline names the address
match, not a person. No party, or more than one, leaves the call in NEW. One party who is on two
units is one match: the requester is a party. A service provider's open contact identifies the
call the same way (#208): the join returns no unit, and the party on no lease is still a requester
this command already accepts.

**#252. The Call brief.** When a call reaches IDENTIFIED, by this command or by the door, the
office retrieval model writes one Call brief: what the paper says about the request. It is the
first turn of that call's Call thread (SPEC-evidence). It runs after the emergency path has
finished, and it does not delay it — the page already shows an emergency as escalating before
the model is called. The page shows the brief as being written until the turn lands. A refresh
while that first turn has not landed writes it. A refresh after it has landed appends another
turn and leaves the earlier ones. The brief proposes no command and moves no
state.

The bound is the requester's, and the stance is administrator. A live Tenancy is searched
together with that Building's own paper (documents linked to the Building, not a neighbour's
lease). With no live Tenancy, the bound is the Unit of the requester's latest letting — the
office Unit bound. A service provider is answered from their own provider record and from no
lease. A requester who is only a guarantor gets no brief; the page says so. A WHATSAPP call
gets no brief. A PORTAL call's brief does not search a live letting: the question is identified
by the number and is not attached to a Tenancy. The on/off switch (`calls.brief`) and the model id (`calls.brief.model`) are
settings rows. When the switch is off, no turn is written and the model is not called.

**#253. A follow-up.** Under the brief, anyone who can read the call can ask a question. The
question appends one turn on that call's Call thread. The turn records the staff account that
asked — the display name, or the address when there is none — and the time, and the page shows
the turns in that order, each with its asker. The follow-up uses the same bound and the same
exclusions as the brief. That bound includes the Policy library (SPEC-evidence).
The brief searches it as of today. A follow-up that names a date, or asks what
applied when the lease was signed, is searched as of that date, and the answer
states the date. It cites, or it is the frozen refusal. A question that names a unit
other than the bound unit, or a party who is not the requester and not on the bound tenancy, is
the record refusal. That other record is not searched, and the model is not called. A blank
question, or one longer than 2000 characters, is not a turn. Sending a reply is a different
command.

**#255. The Draft reply.** A person asks for it from the call page, once the brief's thread is
ready. It is one more turn on that thread, grounded in the passages the latest brief turn cited
and in no others. It is written in the language of the requester's last inbound message, or of
the description when the call has none: Hebrew when that text is Hebrew, and otherwise that
other language with a Hebrew rendering stored beside it so the office can read what it would
send. A Hebrew draft is one text. It opens with a greeting that uses the first word of the requester's name — שלום in Hebrew, Hello in the other language — which the code writes and the model does not. The model then writes one short sentence on what the requester asked about, naming the subject and not a day, a clock time, or a sum they asked for, and then the full answer from the cited passages. Passage numbers stay on the turn and are not written in the reply. When the draft is the frozen refusal, the greeting is followed by that sentence and there is no intro, because the model is not called. The page shows the draft in a field a staff member can edit.
A copy control copies that field, edits included, on every channel that has a draft. PHONE and
WALK_IN have nothing to send, and this command does not send on any channel. The draft never
promises an outcome the code has not decided — responsibility, a visit time, or money — and it
never states a fact the cited passages do not contain. When the brief cited nothing, the draft is
the frozen refusal and the model is not called: one Hebrew sentence, or, in another language,
“The papers on file do not answer this.” with that Hebrew sentence beside it. A requester who is only a guarantor gets
no draft. A WHATSAPP call gets no draft. When the brief's switch is off, no draft is written
and the model is not called. The copy control is the one inline script on a call that has a
draft, because the clipboard is not a form; a call with no draft has no script.

**#256. Send the reply.** On an EMAIL call, a person who holds `calls.reply` can send the draft,
edited or as written, as a reply to the inbound message the call was opened from. The server
refuses unless the actor holds `calls.reply`, the call is IDENTIFIED or later and not closed, and
the channel is EMAIL. Only one recipient is possible. The server resolves it, and the thread, from
that inbound message. The page never supplies an address, and a recipient a client posts is
ignored. The send is one Graph reply through the same Outlook send the duty reply uses. It is a
timeline row and an audit row. Each row names the actor, the text sent, and whether that text was
the stored draft or an edit of it. A viewer sees the copy control and not send. PHONE, WALK_IN and
WHATSAPP are not this command. Production `Mail.Send` is the director's to request; until it is
granted, the send is verified on the development mailbox only.

**Save this contact** is a command on a call a person identified, when the sender is an email
address or a WhatsApp number. It adds that address to the requester as a PartyContact, through
parties' contract, valid from today, and it is audited. The next message from that address is
then identified by the door. Identifying by hand does not do this, and a call the door identified
from an address already on file is not offered the command. An address that already belongs to
someone else today is refused. One the requester already holds is left as it is.

**The four Exits** close a call before a Visit, from any state before SCHEDULED, and each requires a
reason:
- **Answered**: a note.
- **Forwarded**: the department that owns it (finance, legal and the like) and a note.
- **Duplicate**: the call it repeats. The two are linked both ways. Its messages move onto that
  call when the intake door exists; a call logged by hand carries none, so the link is the whole
  of the exit until then.
- **Cancelled**: a note.

A call with no Exit reason is not closed.

**Return to filtered** is not an Exit. A call the office judges not to be a call at all (spam, an
advertisement, a misdirected message) becomes a Filtered message again. The call record is kept and
marked returned, so it counts in no closed-call figure. The sorter's original label is kept beside
the office's, as a labelled case for the golden set.

**A message on a thread whose call is closed opens a new call** linked to the closed one. A closed
call is never reopened.

**Emergency.** A call is flagged an emergency by a deterministic match against the emergency terms,
before any model reads the message (foundation rule 5), or by hand. A person can also clear a flag.
The flag records who or what set it: the terms, or the staff account that flagged it. Clearing a
flag records that staff account too. An emergency-flagged call leads the open list, including one
still inside the response goal, and the list filters on the flag. Within that lead the emergencies
are oldest first. A non-emergency call past the goal follows them, oldest first. A call near the
goal stays with the other open calls, newest first. The lead is the heading דורש טיפול עכשיו, and
the heading is left out when that group is empty. The flag is the word חירום as well as the red
mark.

The match is a substring, after case-folding and after niqqud and invisible marks are stripped.
Any one term is enough. A Hebrew term inside a longer word matches, because a prefix is not a word
boundary. A term in another language matches the same way. The match calls no model.

On EMAIL and WHATSAPP the flag sends one fixed reply with the duty phone number, composed from the
duty contact rows with no model involved. The composer is a pure function of those rows. The
sentence it returns is a placeholder until the director approves the text. Sending the reply is the
channel's. On WHATSAPP that send is one session message on the same conversation, inside the
24-hour window the inbound message opened, once for that call, and it happens before a model reads
the message. On EMAIL that send is one reply on the same thread, from the shared mailbox, once for
that call, before a model reads the message. It uses Mail.Send and lands in that mailbox's Sent
Items. A hand flag sends nothing. PHONE and WALK_IN send nothing. On PORTAL the same sentence is
shown to the sender on the confirmation, once, and nothing is sent: the portal has no conversation
to reply on. The reply is on the call's timeline and audited when a channel sent it.

**Category** is the trade a call needs. It is an admin-managed list of rows, deactivated and never
deleted, seeded with a placeholder list until Dona Dom supplies theirs. It is distinct from
`asset_type` and does not feed the responsibility matrix. A category a tenant picks on a portal
report is not this Category. It is a suggestion, stored beside the call. The sorter's proposal and
a person's Category command may name a different one. The suggestion does not move the state.

**Editable at /settings without a deploy:** the emergency terms (one per line, like verification
terms), the duty phone number and hours, the Category list, and the amber and red age thresholds of
the internal response goal. The goal is internal and is shown to no tenant. A promise to tenants is
an SLA, and it is the director's decision when one is made.

**The response goal** is two whole-minute thresholds, amber then red. Placeholders, until Dona Dom
supplies theirs, are 240 and 1440. Age is whole minutes since the call opened. A call older than
amber, and not older than red, is near the goal. A call older than red is past it. A call that has
passed neither is inside the goal. A call exactly as old as a threshold has not passed it. On an
open call those three are the words בזמן, קרוב ליעד, and מעבר ליעד. A closed call has no
response-goal band: none of those words, no goal colour, and no goal mark, on the list and on its
own page. The list filters on the band. The amber filter does not include red. Red means past the
goal only. A late filter, labeled לא בזמן, means near or past. Amber and red remain valid and have
no segment of their own. Red must be greater than amber. A threshold above a year of minutes is
refused. A save is audited and is read on the next request, so it takes effect with no deploy.

**Tenant status (#281).** Derived when the portal reads a call, never stored, and never a
response-goal band. The words are the portal's copy rows. A state this table does not name,
including a closed call with no exit, is בטיפול, so an internal name never reaches the tenant.

| Call state | Tenant status |
|---|---|
| NEW, IDENTIFIED | התקבלה |
| TRIAGED, RESPONSIBILITY SET | בטיפול |
| WINDOWS COLLECTED, OFFERED | ממתין לתיאום |
| SCHEDULED | נקבע ביקור |
| Exit Answered / Forwarded / Duplicate / Cancelled | נענתה / הועברה / אוחדה / בוטלה |

The portal's list is every ServiceCall whose requester is a party the number resolves to on a
tenancy the number reaches today, on any Source channel, newest first. A call returned to the
filtered list is not on it. Opening one shows the tenant's messages and the office's replies.
A brief, a draft, a band, a clock and an internal state name are not on any tenant page. Another
tenant's call, asked for by its identifier, is not found.

**A portal report (#282).** A tenant with tenancy access reports an issue on the tenancy chosen
for the session. It is a ServiceCall on `PORTAL` through the intake door, and nothing is a
ServiceCall until they send it. The same submission twice is one call. The description may be in
any language. The category they pick is the suggestion above. The entry permission is one of
three answers — the office may enter, only by arrangement, or only while the tenant is home —
stored on the call. The office's call page shows the suggestion, the permission and the flat.
The first step shows the duty phone from `/settings`, as a `tel:` link, before the first question.
An emergency term in the description flags the call the same way as any other intake. On `PORTAL`
the duty sentence is shown on the confirmation and nothing is sent. The reply-target line is
shown on that confirmation only when that setting is on.

A visit's time is two timestamps on the call, `visit_starts_at` and `visit_ends_at`, both set or
neither, and the end after the start. No command writes them yet; the visit flow will. The home
page shows the next visit only when an open call has both and the visit has not ended, and it
shows that time. With no such visit the card is absent.

**Filtered messages** are kept for 6 months and then deleted by a scheduled sweep, unless rescued
into a call. Six months is counted from when the message arrived. A message exactly that old is
kept. A call returned to filtered is a filtered message again, counted from the return: once that
return is older than 6 months the sweep deletes the call's messages, and the call record stays,
still marked returned. The sweep deletes nothing else. It reports how many messages it deleted,
and a second run deletes nothing. It runs once a day on staging. The originals stay in the mailbox
and on the phone whatever this module keeps. The document bucket has no delete, so a filtered
message's attachment bytes stay there until a person removes them.

**Every write is audited** with the staff account that made it. In V1 every signed-in staff member
may perform every action on calls.

## The tab

The קריאות page lists open calls with their Source channel, state, Category, requester, age against
the goal, emergency and "to review" marks. The open list is the hero, on the same glass language as
the assets screens. Logging a call is a dialog on that list, and the list stays underneath. A link,
רישום קריאה, opens it and keeps the filters already chosen. Cancelling, ביטול, returns to that same
list and those same filters. The dialog offers only PHONE and WALK_IN, a description, and a sender.
It does not offer email or WhatsApp. The sender is labeled נרשם, the choices are שם ידוע and לא
ידוע, and the name field's placeholder is שם. A hint says the requester can be identified later
from the call page: את הפונה אפשר לזהות אחר כך מעמוד הקריאה. A named sender with no name is
refused; the dialog stays open and what was typed is kept. A successful log redirects to the open
list, with the filters cleared. The dialog is not modal and does not trap the keyboard. The
open rows are one read of every open call. The counts of open calls, emergencies, calls near or
past the goal, and calls marked for review are taken from that read and ignore the filter on
screen, so a short list can sit under a larger open total. The same numbers are on the segments,
the summary, and the stat row. The red stat is titled מעבר ליעד המענה, with the near-goal count
beside it. The closed segment is a second read, because a closed call is not in the open read, and
that segment shows no count.

The segments are every open call, emergencies, לא בזמן, calls to review, and closed. The category
menu and the state menu keep the other filters when one is chosen. An inactive category is marked
לא פעיל. The state menu lists the open states. There is no search.

The default response is a split inbox: that same list beside a preview of one call. The list view
is the explicit request `view=list`, and that response is only the list. Below 64rem the default
response shows only the list, because both layouts are in that response and the server does not
read the viewport. The list rows keep the marks they already carry. A split row carries a different
mark, so one call is not counted twice. Choosing a row previews that call and keeps the filter. A
selection that is missing, closed, returned, or not in the current rows is skipped, and the first
row of the current list is previewed. An empty list has an empty preview. The preview is read only
for the split inbox. Its text is the first inbound message, cut after 240 characters, otherwise the
summary, otherwise the description. The split header summarises open calls, emergencies, and calls
past the goal, in place of the long lede and the stat row. The way into the filtered list stays on
that header. The split list is that same list: the same order, the same urgent heading, and the
same facts on each row. The warnings stay above both layouts.
Every call row, split and list, opens with an icon tile for its Source channel (#241): mail for
email, a phone, a speech bubble for WhatsApp, a door for a walk-in. The tile is decorative. The
channel's text chip stays, and it is what a screen reader hears.
The requester's name in the preview is text, and it does not link to the profile. A new call, or a
call still waiting on a category, offers a next step that links to the call page. From
RESPONSIBILITY SET on, and on a closed call, there is no such strip.

On a wide screen the line between the inbox and the preview is a separator (#267). Resting the
pointer on it shows a left-right resize cursor. Dragging it sets the inbox width, and the preview
takes the width that remains. The inbox does not go below 16rem, and the preview does not go below
20rem. That width is stored in the browser and restored the next time the split inbox is shown.
The arrow keys move the same line, by 1rem, or by 4rem while Shift is held. The list view has no
separator. Below 64rem the split inbox is not shown, so the separator is not used.

**A narrow screen (#225)** changes the layout and nothing else. Below 40rem the stat row is two
columns, the segments wrap rather than scroll so the current one is always in view, the eight steps
become one line of dots with only the current state named, the log dialog is a sheet on the bottom
edge, and the filtered cards are one column. The call page's aside is first in the markup, so on a
single column it sits above the record and the conversation. In the conversation the inbound message
sits on the start side and the office echo on the end side. A file name is marked left to right, and so
is a sender or an actor with no Hebrew in it, so an address is not reversed. A back link carries a
chevron pointing right and a forward link one pointing left. Targets are the touch height; segments
and small buttons keep the shorter control height the assets screens use. A list row is a target as
a whole. Focus on a radio is drawn on its label. The page never scrolls sideways at 320px.

A mailbox that has not been read, a WhatsApp echo that has gone quiet, and a mail secret that is
due, expired, or undated are warnings above the list, each with a way to the settings. The way into
the filtered list shows how many rows are set aside: the length of the noise messages and the
returned calls, the same two lists that page shows.

The filtered list is that one list. A row is a message the sorter set aside, or a ServiceCall the
office sent back. A returned row is still that ServiceCall, and it links to the call. The views are
הכל, המסווג, and המשרד. הכל shows both origins. המסווג shows only what the sorter set aside,
requested as `origin=sorter`. המשרד shows only what the office returned, requested as
`origin=office`. An origin the page does not know is הכל. Each view shows the three counts from
that same read, so a short list can sit under a larger total. The sentence אין הודעות מסוננות means
the book is empty. A view with none of its own rows does not use that sentence while another origin
still has rows. Each row shows the sorter's verdict, the Source channel, and the time: when the
message arrived, or when the office returned the call.
The rows are cards on the same glass language as the open list. Rescue from either origin is the
control הצלה — זו קריאה, the same words as on the returned call, and it puts the call back on the
open list. The page stays server-rendered, and the marks the list already carries stay.

The dialog is the manual entry for PHONE and WALK_IN, three required fields (channel,
description, and a sender or unknown) and no sorter, a call page with the full timeline of
messages, attachments and transitions, and a filtered list. The rail shows the open-call count
beside קריאות. A closed call leaves that count and the open list, and a closed filter shows it.
The page is server-rendered with no client JavaScript and follows the approved stakeholder mockup.

An open call's page shows the description, the Source channel, and the age against the response
goal, in the words בזמן, קרוב ליעד, or מעבר ליעד, and the word חירום when the call is flagged.
The eight states are an indicator of where the call is: the current state is the current step,
the states before it are behind it, and the states after it are ahead. The steps are not
controls, and pressing one does nothing. A closed call does not draw the indicator. The
conversation is the inbound message, the office echo, and the system events, in the order they
already have. A translation is shown apart from the original. An attachment that can be opened
opens. A person who may file can file it as a document. The size is shown in ordinary units of
1024 bytes — B below 1024, then KB, then MB — and the byte count stays on the size mark. A filed
attachment says תויק and opens the document; the document itself stays an Unassigned document.
The sender and the requester are two facts, נרשם and פונה. Calls that repeat this one stay
listed under it. Back from an open call returns to the open list.

The aside is the only place an action on the call appears, and only where that command exists.
A new call offers identification of the requester, for this call alone. A match is a name only.
An identified or triaged call offers the category. Six or fewer active categories are a set of
choices; more than six uses the select. Saving the sender as a contact uses the offer that
already exists, and the control is absent when that command would not be offered. A returned
call offers rescue back onto the list. The control says הצלה — זו קריאה. Rescue does not
replace identification or the category while those commands still apply. The four exits stay off until the call is back on the open
list. From RESPONSIBILITY SET on, there is no next step.
Closing offers the four exits. Each one shows only the fields it needs: a note for answered and
for cancelled, a note and a department for forwarded, and the other call for a duplicate. The
close control names the exit and says that closing is final and a new message opens a new call.
A refused exit keeps the exit and the values. Flagging and clearing an emergency, and sending
the call back to the filtered list, are in the header. They are absent when they do not apply:
a closed call has neither, and a call already returned is not sent back again. A posted flag or
clear on a closed call is refused by that same command, and the stored flag is unchanged. No new
database constraint is added for the flag. The requester's
name links to the party profile when this person holds `party.read`. The stacked cards those
actions used to live in are gone.

A call is closed only from its page. Success returns to that call with a receipt parameter.
The receipt is drawn only when that parameter is present and the call is closed, and it names
the exit. It links to the first call on the unfiltered open list, in that list's order, and the
link is absent when nothing is open. The next call is read only for that receipt. A request
without the parameter draws no receipt.

The closed page draws an outcome card instead of the eight steps. The card names who closed
the call, how long it was open, the states its transitions actually passed, and the reason for
that exit: the note, the department, the other call, or the cancellation. The path is taken
from the transitions already stored, in state order, and it is not a new field. A call closed
while still new does not show the states it never reached. Later calls that continue this one
are listed newest first, apart from the duplicates. The page shows the close time and the time
open, counted in whole minutes from open to close in the same words as an open call's age:
under an hour in minutes, one hour as שעה, under a day in hours, one day as יום. It never
shows בזמן, קרוב ליעד, or מעבר ליעד, a goal colour, or a goal mark, including when the call
is older than the red threshold.

A call that was ever an emergency says היה חירום, including while the flag is still stored.
The list, the split row, and the split preview show that same chip. An open call that is
flagged says חירום in those places, and an open call that is not flagged shows neither chip.
Closing does not clear the flag. The mark the page already reports stays the stored flag,
and the list and the split row report that same stored flag.
The page offers no flag, clear, return, exit, identify, or category action. Return, exit,
identify, and category stay refused. Filing still works for someone who may file. Saving the
sender as a contact still works when that command would have been offered before the close:
one button titled שמירת איש קשר, with no next-step label. The line אין פעולות appears only
when that button is absent. The requester's name links to the profile under the same rule as
an open call. Back goes to the closed list. The party profile still shows the stored flag as
חירום or לא.

**The closed list (#224)** is the closed segment, on the same split inbox and list view as the
open list. It shows the calls closed in the last 30 days: a close later than 30 days before now,
and not later than now. Newest close first. The rows are grouped by the day of the close in the
office's zone: היום, אתמול, השבוע for the rest of the week back to the most recent Sunday, and
קודם. An empty group is left out, so a Sunday or a Monday has no השבוע heading. A returned call
is not a closed call and is not on this list.

Older closes are the request `page=1`, then `page=2`, each a window of 30 days ending where the
one after it began. The link 30 הימים הקודמים is drawn only when a closed call matching the
category and the exit closed at or before the start of the window on screen. It leads to the
window holding the newest of those closes, so it never leads to an empty window: a gap of more
than 30 days with no close is skipped. A page that is not a whole number from 0 to 9999 is page 0.

The closed list can be narrowed by exit, requested as `exit=ANSWERED` and the other three. The
exit segments are הכל and the four exits, each with the number of calls of that exit in the window
on screen under the category chosen, so the count on the chosen exit is the number of rows below
it. An exit the page does not know is הכל. The category menu stays and keeps the exit and the page.
The emergency, review, and goal filters do not apply to a closed call, and the closed list's links
do not carry them. The open-call summary, the
segment counts, and the stat row still count open calls only.

A closed row shows the exit and the close time, and not the age, a goal word, or a goal mark. The
split preview of a closed call shows the requester, היה חירום when the call ever was an emergency,
and the outcome: the exit, who closed it, the close time, the reason, and the department of a
forwarded call. It shows no next step, no state strip, and no message excerpt. An empty window says אין
קריאות שנסגרו ב־30 הימים האלה. A window narrowed by category or exit that has no rows says אין
קריאות תואמות. A closed call outside the window is still on its own page and on the requester's
profile: the window is only the list.

The window is `listClosedCalls`: closed, not returned, a close inside the window, ordered by close
time newest first. The older link reads `newestCloseAtOrBefore` at the window's start. Both were
measured inside a transaction that was rolled back, with closed calls spread evenly over the past:
2,908 in one year, one for each party the portfolio holds, as the requester read was measured, and
29,080 over ten years. The last 30 days were 239 rows either way. Without an index the window is a
sequential scan and a sort: cost 179.90, 119 buffers, 0.296 ms at one year, and cost 1231.86, 713
buffers, 1.871 ms at ten. The older read is a sequential scan of every closed call before the
window: 0.367 ms and 3.040 ms. A btree on `closed_at`, restricted to a closed call, is a backward
index scan the planner chooses for both reads at both volumes: the window at cost 32.69 and 28.63,
9 and 11 buffers, under 0.1 ms; the older read at 3 buffers, 0.005 ms. That partial index is
added, so an open call pays nothing for it on write.

**A party's calls (#209).** The profile lists every call that names that party as requester, newest
first, including a closed call and one returned to the filtered list. Each row shows the day the
call opened, in the office's zone, the Category or that none is set yet, the state, and the
emergency mark — חירום, or לא — and it links to the call by its description. A party who opened none is told so. A call
that names another party, and a call that names nobody, are absent. The read is
`listCallsByRequester` on this module's contract. Parties does not import this module. The
composition root paints the section.

The read is `WHERE requester_party_id = $1`, ordered newest first. The generated register writes no
service calls, so the volume was measured as one call for each of the 2,908 parties that portfolio
holds (the count recorded at 2.6), 2,911 rows once the three calls already in the database were
counted, inside a transaction that was rolled back. Without an index the plan is a sequential scan
of `service_call`, 2,910 rows removed by the filter, 48 buffers, 0.139–0.155 ms. A btree on
`requester_party_id` is an index scan the planner chooses, cost 0.28..8.30 against the scan's
84.39, 5 buffers, 0.024–0.046 ms. The same column restricted to a non-null requester is chosen at
the same estimated cost, because every measured row had a requester. That partial index is the one
added: a call still in NEW names nobody, this read never asks for that row, and only a call that
names a party pays for the index on write. An index the planner will not choose is not added; this
one it does.

## Not yet

The states from RESPONSIBILITY SET on are the visit flow, and are not built by #181. **`WINDOWS
COLLECTED → OFFERED` is two-sided asynchronous negotiation between two people never online at once**,
roughly seventy percent of the engineering lives between those two states, and it photographs badly
(R5). The tenant-facing agent arrives later without changing anything in this module.
