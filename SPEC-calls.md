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

**An intake call** (EMAIL or WHATSAPP) is opened by the door with no staff account. The list shows
the raw sender address until the requester is identified. A call opened by hand still names
the staff account that logged it.

**A ServiceCall is any request that reached the office**, on any Source channel: `WHATSAPP · EMAIL ·
PHONE · WALK_IN`, set once at intake and never changed. A question is a ServiceCall, closed by the
Answered Exit. The requester is identified, never presumed. A call whose sender resolves to no Party,
or to more than one, waits in NEW with the raw sender address until a person identifies it.

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
Items. A hand flag sends nothing. PHONE and WALK_IN send nothing. The reply is on the call's
timeline and audited.

**Category** is the trade a call needs. It is an admin-managed list of rows, deactivated and never
deleted, seeded with a placeholder list until Dona Dom supplies theirs. It is distinct from
`asset_type` and does not feed the responsibility matrix.

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
that segment shows no count. The existing closed filter still lists closed calls. The thirty-day
window is later.

The segments are every open call, emergencies, לא בזמן, calls to review, and closed. The category
menu and the state menu keep the other filters when one is chosen. An inactive category is marked
לא פעיל. The state menu lists the open states. There is no search.

A mailbox that has not been read, a WhatsApp echo that has gone quiet, and a mail secret that is
due, expired, or undated are warnings above the list, each with a way to the settings. The way into
the filtered list shows how many rows are set aside: the length of the noise messages and the
returned calls, the same two lists that page shows.

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
listed under it. Back returns to the open list. Identify, category, save-contact, emergency,
return, and exit stay on this page.

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
