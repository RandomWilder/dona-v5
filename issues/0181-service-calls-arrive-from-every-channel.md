---
number: 181
title: Service calls arrive from every channel into one קריאות tab
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-06
closed:
---

## Problem Statement

Dona Dom's office takes service calls from tenants on four routes, and none of them reaches the
system. A receptionist in the rent department holds a dedicated office phone whose WhatsApp number
tenants know, and answers every message on it by hand. Tenants also write to a shared Outlook inbox,
ring the office, and walk in. Nothing ties a message to the tenancy it is about, nothing shows the
office one list of what is open, and an urgent message reads the same as a question about a
receipt. The קריאות tab in the system today is a stub.

The design was settled in a grilling session on 2026-10-06. Its vocabulary is in `CONTEXT.md`
(**ServiceCall**, **Source channel**, **Category**, **Exit**, **Filtered message**, **the sorter**), and the
WhatsApp route is [ADR-0013](../docs/decisions/ADR-0013-whatsapp-arrives-by-coexistence.md). The
stakeholder mockup of the tab was approved the same week.

## Solution

Every incoming message, whatever its channel, goes through one intake door. Each becomes a
ServiceCall the office works in the קריאות tab, or a Filtered message the office can rescue.

- **The office can enter phone and walk-in calls on a short form.**
- **The shared Outlook inbox is read by the system**, read-only. Gmail is built as a standby adapter
  behind the same interface and is not wired to a mailbox.
- **The office WhatsApp number is connected by coexistence.** The receptionist keeps the phone, and
  every 1-on-1 chat on it also reaches the system.
- **The sorter (a model) proposes**: is this a ServiceCall or noise, which Category, a Hebrew summary,
  and a Hebrew translation of a message in another language. **People decide.** A model never moves a
  call from one state to the next, and the deterministic **emergency flag** runs before any model
  sees the message.
- **The sender is identified through the contacts the system already holds** (PartyContact, phone or
  email). An unknown sender's call waits in NEW for the office to identify by hand, and saving a new
  contact is a deliberate act.
- **Each call shows its Source channel**, how old it is against an internal response goal, and the
  thread of messages behind it. A count of open calls sits beside קריאות in the rail.

The tenant-facing agent replying on WhatsApp, replying to email from inside the system, the tenant
acknowledgement and post-close feedback are later work, and will get their own grilling once
WhatsApp intake runs on real traffic.

## User Stories

### Intake: every channel, one door

1. As a receptionist, I want every new email in the shared Outlook inbox to appear in קריאות within
   a few minutes, so that I stop watching the inbox and the tab side by side.
2. As a receptionist, I want every new WhatsApp message on the office phone to appear in קריאות, so
   that a message answered on the phone is still on record.
3. As a receptionist, I want to keep using the office phone exactly as today, so that the system
   joins my work rather than replacing it on day one.
4. As a receptionist, I want to log a phone call in under thirty seconds with a channel, a
   description and a sender or "unknown", so that I stop writing calls on paper.
5. As a receptionist, I want to log a walk-in the same way, so that a tenant at the desk is on record
   like any other.
6. As a receptionist, I want each call to show the channel it arrived on, so that I know where to
   answer it.
7. As a receptionist, I want a reply in the same email thread to land on the call it belongs to, so
   that one problem is one call.
8. As a receptionist, I want a further WhatsApp message in the same conversation to land on the open
   call from that conversation, so that a tenant's follow-up photo does not open a second call.
9. As a receptionist, I want a message arriving on a thread whose call is closed to open a new call
   linked to the old one, so that a closed call stays closed and the history is still one click
   away.
10. As a receptionist, I want messages and calls from before the connection day left out, so that the
    tab starts clean and old, handled matters do not flood it.
11. As the office, I want the system never to delete, move or mark an email as read in the shared
    inbox, so that the mailbox stays the record it is today.
12. As the office, I want the originals to stay in the phone and in the mailbox regardless of what
    the system keeps, so that nothing the system does can lose a message.

### The sorter

13. As a receptionist, I want obvious noise (advertising, newsletters, out-of-office replies,
    delivery notices) kept out of the call list, so that the list is only work.
14. As a receptionist, I want a message the sorter is unsure about to arrive as a call marked "to
    review", so that a real call is never lost among the filtered.
15. As a receptionist, I want each call to carry a proposed Category, so that I can see the trade at
    a glance and change it in one click.
16. As a receptionist, I want a short Hebrew summary on each call, so that I can scan the list
    without opening every message.
17. As a receptionist, I want a message written in Russian, Arabic, English or another language
    translated in full into Hebrew beside the original, so that I can work it without a translator.
18. As the office, I want the sorter's proposal shown as a proposal and never acted on by itself, so
    that no model decides where a call goes.
19. As the office, I want a Filtered message kept and readable, so that I can check what the sorter
    put aside.
20. As a receptionist, I want to turn a Filtered message into a ServiceCall in one action, so that a
    sorter mistake costs seconds.
21. As a receptionist, I want to send a call that turns out to be spam back to the filtered list, so
    that it leaves the list without becoming a closed call in the statistics.
22. As the developer, I want every rescue and every return recorded with the sorter's original
    label, so that the sorter's mistakes become labelled cases for its golden set.

### Emergencies

23. As the duty manager, I want a message that contains an emergency term (flood, fire, gas, a
    person stuck in a lift, a short circuit and the like) flagged before any model reads it, so that
    an emergency is never delayed by, or left to, a model.
24. As a receptionist, I want an emergency-flagged call pinned at the top of the tab in red, so that I
    see it before anything else.
25. As a tenant writing an emergency on email or WhatsApp, I want an immediate fixed reply with the
    duty phone number, so that I know whom to ring now.
26. As an administrator, I want to edit the emergency terms at /settings without a deploy, so that a
    missed word is fixed the same day.
27. As an administrator, I want to set the duty phone number and hours in one place, so that the
    automatic reply and the tab show the same number.
28. As a receptionist, I want to flag or unflag an emergency by hand, so that a call the terms missed,
    or a false alarm, is corrected by a person.

### Identifying the sender

29. As a receptionist, I want a call whose sender's phone or email is a known contact to show the
    Party, the Tenancy and the Unit straight away, so that I do not look them up.
30. As a receptionist, I want a call from an unknown sender to wait in NEW with an "identify" action,
    so that I can find the person by name, phone or flat.
31. As a receptionist, I want identifying a sender to link only this call unless I choose "save this
    contact", so that a wrong guess does not route the next household's message to someone else.
32. As a receptionist, I want "save this contact" to add the phone or email to that Party from today,
    so that the next message from it is identified automatically.
33. As the office, I want a sender who is a guarantor never treated as a service contact, so that
    foundation rule 7 holds on every channel.
34. As a receptionist, I want a call from a non-tenant (an owner, a neighbour, a contractor, someone
    asking to rent) kept as a call I can identify or close by an Exit, so that every sender has a
    path.

### Working a call

35. As a receptionist, I want to set or change a call's Category, so that the trade is right before
    anyone is sent.
36. As a receptionist, I want to move a call through its states by hand, so that the tab shows where
    every call stands.
37. As a receptionist, I want to close a question as **Answered** with a short note, so that a
    question does not sit in the list with no visit coming.
38. As a receptionist, I want to close a call as **Forwarded** and name the department (finance,
    legal and the like), so that a legitimate request that is not ours is closed with its
    destination on record.
39. As a receptionist, I want to close a call as **Duplicate** of another call I pick, so that one
    problem stays one call and its messages move with it.
40. As a receptionist, I want to close a call as **Cancelled** when the tenant withdraws, so that the
    withdrawal is recorded.
41. As the office, I want an Exit to require a reason, so that no call is closed silently.
42. As a receptionist, I want to see every message, attachment and state change on a call in one
    timeline, so that whoever picks it up next knows its history.
43. As a receptionist, I want an attachment (a photo, a PDF) to show on the call, so that I can see
    the leak without opening the mailbox.
44. As a receptionist, I want to file an attachment that is paper (a lease, a signed form) as an
    Unassigned document in one action, so that it joins the filing path the office already uses.

### The tab

45. As a receptionist, I want to filter the list by Source channel, state, Category, emergency and
    "to review", so that I can work one kind of call at a time.
46. As a receptionist, I want each call's age shown against an internal goal, amber then red, so that
    I see what is getting late.
47. As an administrator, I want the amber and red thresholds set at /settings, so that the goal is
    the office's to tune.
48. As a receptionist, I want a count of open calls beside קריאות in the rail, so that I see new work
    from any screen.
49. As a receptionist, I want a separate view of the filtered list, so that I can review it in one
    sitting.
50. As any signed-in staff member, I want every action on calls available to me, so that the office
    works the tab without a permission scheme it does not have.
51. As a receptionist on a phone-sized screen, I want the tab usable at phone width, so that I can
    work it away from the desk.

### Health and retention

52. As the office, I want a warning in the tab when no message has been sent from the office phone
    for 7 days, so that the WhatsApp connection is not dropped by Meta's 14-day inactivity rule.
53. As the office, I want a warning when the mailbox has not been read successfully for an hour, so
    that a broken connection does not look like a quiet day.
54. As the office, I want Filtered messages deleted from the system after 6 months unless rescued, so
    that we do not hoard tenant mail with no purpose.

### Staging

55. As the director, I want every step of this built so it can be clicked on staging the day it
    merges, against a test mailbox and Meta's test number, so that I can check progress without
    waiting for the client's accounts.

## Implementation Decisions

### Modules

- **`calls` is built for real** (stub today). It owns ServiceCall, its state machine, Exits, the
  emergency flag and terms, the duty contact, the response-goal thresholds, Filtered message, and
  the reads behind the tab. It depends on scope, policy and parties' contract.
- **`channel` is built for real** (stub today). It owns Conversation, Message, the intake door, the
  adapters, the sorter port and the connection-health facts. It depends on calls, scope, parties and
  evidence's contracts.
- **`scope`** gains the email form of the isolation join: an email contact valid today resolves to
  Party, TenancyParty and the Tenancy active today, through the same single file as the phone form.
  Whoever a contact reaches is still `scope`'s answer and nobody else's.
- **`parties`** gains nothing new in kind: "save this contact" calls its existing command to add a
  PartyContact from today.
- **`evidence`** gains nothing new in kind: "file as document" creates an Unassigned document through
  the existing filing path.
- **The module map changes**: `channel` depends on scope, calls, parties and evidence; `calls`
  depends on scope, policy and parties. No cycles.

### The intake door

- **One entry point** in channel's contract takes a normalised incoming message: Source channel,
  the external message id, the external thread or conversation id, sender address (phone or email),
  received time, subject, body text, attachments and an outbound/echo flag. **Every adapter's only
  job is to produce that shape.** The door does the rest, in this order:
  1. **De-duplicate** on the external message id. An adapter may deliver the same message twice.
  2. **Store the Message** with `body_original`.
  3. **Emergency check**: a deterministic match against the emergency terms, before any model call
     (foundation rule 5). A match flags the call, and on EMAIL and WHATSAPP sends the fixed duty
     reply.
  4. **Thread**: if the thread or conversation has an open ServiceCall, attach the message to it and
     stop there. If its call is closed, open a new call linked to the old one.
  5. **Identify**: resolve the sender through `scope`. One match sets the Party, the Tenancy and the
     Unit. None, or more than one, leaves the requester unidentified.
  6. **Sort**: the sorter returns a label (call, unsure or noise), a Category from the list, a Hebrew
     summary, and a full Hebrew translation into `body_he` when the language is not Hebrew. Noise
     becomes a Filtered message. Call and unsure become a ServiceCall in NEW, with unsure marked
     "to review".
- **Echoes** (messages the receptionist sends from the phone) are stored on the conversation and the
  call timeline and never open a call. They feed the 7-day health check.
- **Manual entry** (PHONE, WALK_IN) goes straight to calls' open command and skips the sorter.
  Required: channel, description, and either a sender or "unknown". Optional: Category, emergency.

### The sorter and translation port

- One port with two operations, **sort** and **translate**. **A fake in tests. OpenAI on staging and
  in production**, through the provider already named in SPEC.md, with the model id held in
  configuration rather than in code.
- The sorter sees the message text and subject only, and no store, tenancy or party data. Its output
  reaches the office only, so identifiers are not masked (ADR-0006 binds masking to output that can
  reach a tenant).
- Its output is stored on the call as a proposal, with the model id and the prompt version. **No
  command reads it to decide a transition.**
- If the port fails or times out, the message becomes a ServiceCall marked "to review" with no
  summary. A sorter outage never drops a message.

### Adapters

- **Outlook first, through Microsoft Graph.**
  - An app registration in Dona Dom's Microsoft 365 tenant, with the application permission
    `Mail.Read` limited to the one shared mailbox. **Read-only by construction**: the system cannot
    delete, move or mark mail as read.
  - Polled with a delta query on a short schedule, every one to two minutes. Webhooks are not used in
    V1.
  - Threading comes from the conversation id. Attachments are fetched with the message.
  - The delta cursor is stored, so a restart neither re-reads nor skips.
  - **Staging reads a separate test mailbox. Production reads the real one.**
- **Gmail**: the same adapter interface, implemented against the Gmail API with the `gmail.readonly`
  scope, with tests over recorded payloads. **Not wired to any mailbox.** It is the standby if the
  client's inbox is ever Gmail.
- **WhatsApp**: the Cloud API webhook with coexistence (ADR-0013).
  - Inbound messages and `smb_message_echoes`. `history` is acknowledged and not imported.
  - Webhook signatures are verified. Media is fetched on receipt.
  - **Staging uses Meta's developer test number**, so the adapter is built and clickable before
    Dona Dom's business verification and App Review finish. Production waits on ADR-0013's director
    steps.

### Calls

- ServiceCall gains `source_channel` (`WHATSAPP · EMAIL · PHONE · WALK_IN`, set once), an emergency
  flag with who set it and why, a "to review" mark, a Category, the requester (a Party, or
  unidentified with the raw sender address), the Tenancy and Unit when known, the sorter's proposal,
  a link to a predecessor call, and an Exit with its reason.
- States are as `SPEC-calls.md` lists them. In this work the office drives NEW → IDENTIFIED →
  TRIAGED by hand, and the four Exits are reachable from any state before SCHEDULED. States beyond
  TRIAGED are the visit flow and are not built here.
- **Exits**: Answered (note), Forwarded (department, note), Duplicate (the call it repeats; its
  messages move to that call), Cancelled (note). A reason is required on all four.
- **Return to filtered** turns a call into a Filtered message. The call record is kept, marked
  returned, and counted as no Exit.
- **Category** is an admin-managed list of rows, deactivated and never deleted, seeded with a
  placeholder trade list until Dona Dom supplies theirs. It is not `asset_type` and does not drive
  responsibility.
- **Emergency terms, the duty phone and hours, and the amber/red thresholds** are editable rows at
  /settings, with seeded placeholders.
- **Filtered-message retention**: a scheduled sweep deletes Filtered messages older than 6 months
  that were never rescued.
- Every write is audited with the staff account that made it.

### The tab

- The קריאות page replaces the stub, following the approved mockup and the existing glass-stage
  tokens. It is server-rendered with no client JavaScript, like every other screen.
- It has a list with filters, a call page with the timeline, the manual-entry form, the filtered
  list, and the two health warnings.
- The rail shows the open-call count.

### Third parties (SPEC.md table, ADR-0004 decision 4)

- **OpenAI**: widened to cover incoming email and WhatsApp text, for sorting and translation.
- **Meta**: unchanged in kind. It now also carries every message the receptionist sends from the
  phone (echoes).
- **Microsoft 365**: added as **Dona Dom's own provider**. The system reads the shared mailbox
  through Graph. It is not a new processor of tenant text, because the mail is already there.
- **Twilio**: removed (ADR-0013). Tenant OTP will go by WhatsApp authentication template only.

### Build sequence (each step merges green and is clickable on staging)

1. **Calls core and the real tab.** ServiceCall with `source_channel`, manual entry (PHONE,
   WALK_IN), identify (link only), Category rows, the four Exits, the list with filters, the call
   page and the rail count. *Staging: log and close calls by hand.*
2. **Emergency.** Terms, duty phone and hours rows at /settings, manual flag, pinned red.
   *Staging: a manual call with a term is flagged.*
3. **The intake door and the sorter.** Normalised message, de-duplication, emergency check, the
   sorter port on OpenAI, Filtered messages with rescue and return, translation, the golden set.
   *Not clickable alone. Proved by tests and evals.*
4. **Outlook.** The Graph adapter on the staging test mailbox, threading, attachments, mailbox
   health, the fixed emergency reply by email. *Staging: send an email to the test mailbox and watch
   it arrive.*
5. **Sender identification by contact.** The email form of the isolation join, automatic
   identification, "save this contact", the guarantor rule. *Staging: a seeded tenant's address is
   identified.*
6. **Attachments to evidence and the response goal.** "File as document", amber/red thresholds,
   retention sweep. *Staging: file a test attachment; age a call.*
7. **WhatsApp on Meta's test number.** Webhook, conversations, echoes, the 7-day health warning, the
   emergency reply by WhatsApp. *Staging: message the test number from a developer phone.*
8. **Gmail standby adapter.** Recorded-payload tests only, wired to nothing.
9. **Production connection.** The real mailbox, then the real WhatsApp number once ADR-0013's
   director steps are done. A configuration and onboarding step, not new behaviour.

Steps 1 and 2 have no external blocker. Step 4 needs the staging test mailbox and the Graph app
registration. Step 7 needs a Meta developer app in Dona Dom's Business Manager. Production in step 9
needs the client's admin consent, business verification and App Review.

## Testing Decisions

- **A good test asserts what the office or a tenant can observe**: what the tab lists, what a call
  records, what message is sent. It never asserts how a module stores something internally.
- **The `calls` contract** is the main seam. Every command and read is tested against a real
  Postgres, the way `src/tenancy/*.test.ts` and `src/parties/commands.test.ts` are.
- **The intake door** in `channel`'s contract is the second seam. Tests feed normalised messages with
  the sorter port faked, and assert the resulting calls and Filtered messages. This covers threading,
  de-duplication, echoes, closed-thread successors, emergency-before-sorter and sorter failure.
- **Adapters** are tested only for parsing recorded, fabricated payloads into the normalised shape,
  plus the delta cursor's restart behaviour. There are no tests against live Graph, Gmail or Meta.
- **HTTP and screens**: the קריאות routes in the style of `src/app.test.ts`, covering the list,
  filters, the manual form, the Exits, rescue and return, the rail count and the CSRF field. Then a
  click-through on `npm run dev` before each merge, as `CLAUDE.md` requires.
- **The policy suite** (`tests/policy`) gains cases, each red first:
  - The sorter's output never moves a call between states.
  - An emergency term is flagged with no model call before the flag.
  - Identification without "save this contact" writes no PartyContact.
  - A guarantor's contact never identifies a requester for service.
  - A call cannot be closed without an Exit reason.
  - The email form of the isolation join returns nothing for a contact not valid today.
- **The golden set** (`evals`) gains the sorter's cases: call versus unsure versus noise, Category,
  and translation into Hebrew. **The messages are fabricated, never a real tenant's.** A change to
  the sorter's prompt, model id or Category list runs the full set.
- **Prior art**: `tests/policy/isolation.test.ts` for the join, `tests/policy/guarantor.test.ts` for
  rule 7, `evals/golden` for the model cases, and `src/settings.test.ts` for editable rows.

## Out of Scope

- The tenant-facing agent replying on WhatsApp, its takeover rules with the receptionist, templates,
  OTP, the acknowledgement on a new call and feedback after close. This gets a separate grilling once
  step 7 runs on real traffic.
- Replying to email or WhatsApp from inside the system. The office replies from Outlook and from the
  phone.
- The visit flow: RESPONSIBILITY SET, WINDOWS COLLECTED, OFFERED, SCHEDULED, contractors.
- A response-time promise to tenants (an SLA). The goal is internal.
- Importing WhatsApp or mailbox history.
- Push, sound or email alerts to the office, other than the rail count and the duty reply.
- Roles and per-building visibility on calls.
- An automatic "probably the same as" suggestion between calls.
- A Gmail mailbox in production.

## Further Notes

- **Owed by Dona Dom**, entered as placeholders until they arrive: the Category list, the duty phone
  and hours, the amber/red thresholds, the shared mailbox address, a staging test mailbox in their
  Microsoft 365 tenant, and whether there is more than one receptionist.
- **Owed by the director**, flagged rather than decided here:
  - Admin consent for the Graph app registration.
  - ADR-0013's Meta steps.
  - The wording of the emergency auto-reply.
  - The 6-month retention.
  - OpenAI's DPA (fuse F6).
- **Tenant text reaches staging** only through the test mailbox and the test number, both written to
  by us. Real tenant messages reach production only.
- The approved stakeholder mockup is a published artifact and is not in this repository. If a flow
  in it needs painting before wiring, it goes to `mockups/<flow>.html` per `CLAUDE.md`.
