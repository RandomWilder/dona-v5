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
Every transition is a command a person issues, or a timer this module owns. The sorter's proposal
is stored on the call and displayed; no command reads it to decide anything.

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

**The four Exits** close a call before a Visit, from any state before SCHEDULED, and each requires a
reason:
- **Answered**: a note.
- **Forwarded**: the department that owns it (finance, legal and the like) and a note.
- **Duplicate**: the call it repeats. Its messages move to that call.
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
The flag records who or what set it. An emergency-flagged call is pinned first in the tab. On EMAIL
and WHATSAPP the flag sends one fixed reply with the duty phone number, composed from the duty
contact rows with no model involved. Its wording is the director's to approve.

**Category** is the trade a call needs. It is an admin-managed list of rows, deactivated and never
deleted, seeded with a placeholder list until Dona Dom supplies theirs. It is distinct from
`asset_type` and does not feed the responsibility matrix.

**Editable at /settings without a deploy:** the emergency terms (one per line, like verification
terms), the duty phone number and hours, the Category list, and the amber and red age thresholds of
the internal response goal. The goal is internal and is shown to no tenant. A promise to tenants is
an SLA, and it is the director's decision when one is made.

**Filtered messages** are kept for 6 months and then deleted by a scheduled sweep, unless rescued
into a call. The originals stay in the mailbox and on the phone whatever this module keeps.

**Every write is audited** with the staff account that made it. In V1 every signed-in staff member
may perform every action on calls.

## The tab

The קריאות page lists open calls with their Source channel, state, Category, requester, age against
the goal, emergency and "to review" marks. It filters on each of those. It has a manual-entry form
for PHONE and WALK_IN with three required fields (channel, description, and a sender or "unknown")
and no sorter, a call page with the full timeline of messages, attachments and transitions, and a
filtered list. The rail shows the open-call count beside קריאות. The page is server-rendered with no
client JavaScript and follows the approved stakeholder mockup.

## Not yet

The states from RESPONSIBILITY SET on are the visit flow, and are not built by #181. **`WINDOWS
COLLECTED → OFFERED` is two-sided asynchronous negotiation between two people never online at once**,
roughly seventy percent of the engineering lives between those two states, and it photographs badly
(R5). The tenant-facing agent arrives later without changing anything in this module.
