---
number: 247
title: The call copilot and the Policy library
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-16
closed:
---

## Problem Statement

When a call reaches the office, the person working it has to rebuild the requester's situation by
hand before they can answer:
- who the requester is;
- which letting they hold and what their lease says about the issue;
- whether they have called about it before;
- what the law and the company's own policy say.

That work repeats on every call, and it is slow. It is uneven between staff and leaves no record of
what was consulted. The office retrieval model can already answer cited questions about a lease, but
only from a separate office retrieval thread. Nothing ties it to the call being worked, and it knows
nothing about state law or company policy, because those texts have no home in the system.

Answering the tenant is also manual end to end. The office types a reply outside dona-v5, in
Outlook or on the phone. The call's timeline does not show what was said or who said it.

## Solution

**The call copilot.** It is the existing office retrieval model, given a new kind of thread
(ADR-0017). It is not a third model and not an early version of the agent.

- **The Call thread.** Each ServiceCall gets one, shared by everyone working the call.
- **The Call brief.** When a call reaches IDENTIFIED, the model writes a Call brief in Hebrew,
  with citations. The brief covers:
  - the requester;
  - their letting;
  - their related calls;
  - the relevant lease passages;
  - the relevant Policy documents in force today.
- **Follow-up questions.** Staff can ask follow-ups on the same thread. Each follow-up records who
  asked.
- **Refresh.** A refresh control rewrites the brief on request. Nothing rewrites it automatically.
- **The Draft reply.** The model writes it in the language of the tenant's last message, with a
  Hebrew rendering beside it for display. It never sends anything.
- **Sending.** A person who holds the new `calls.reply` permission sends the draft, edited or not.
  The send is limited three ways:
  - on the call's own channel;
  - to the address the call was identified by;
  - on the thread it arrived on.

  Where sending is impossible, the person copies the draft. Every send goes on the call's timeline
  with the sender, and with whether the text was the draft as written or edited.
- **The Policy library (מדיניות).** A new tab where the admin uploads state laws and company
  policies:
  - each upload is a versioned Policy document, filed in a section;
  - the sections are rows, State law and Company policy today, so a further kind of context can be
    added later with no migration;
  - the model reads and cites Policy documents and never decides anything from them;
  - deciding things (responsibility, thresholds, emergencies) stays with Policy rules, applied by
    code.

## User Stories

1. As an operator, I want a Call brief to appear on a call's page once the requester is identified,
   so that I start working the call already knowing the situation.
2. As an operator, I want the brief in Hebrew whatever language the tenant wrote in, so that every
   staff member can read it.
3. As an operator, I want the brief to name the requester and their letting (Unit, Building, the
   tenancy's dates), so that I know who I am dealing with.
4. As an operator, I want the brief to list the requester's related calls, so that I notice a
   repeat problem.
5. As an operator, I want the brief to quote the lease passages that bear on the message, each
   cited to its passage, so that I can check the source in one click.
6. As an operator, I want the brief to quote the Policy documents in force today that bear on the
   message, so that I see what the law and the company's policy say.
7. As an operator, I want each Policy citation labelled by its section (State law, Company policy),
   so that I know what kind of source I am reading.
8. As an operator, I want the brief to cite lease and policy sources on separate lines with no
   ranking between them, so that the model is never weighing law against contract for me.
9. As an operator, I want the brief to say so plainly when nothing relevant was found, rather than
   guess, so that I can trust what it does say.
10. As an operator, I want the brief written once, when the call reaches IDENTIFIED, so that I am
    not paying for, or confused by, a brief that changes under me.
11. As an operator, I want a refresh control that rewrites the brief, so that I can get a current
    one after the conversation has moved on.
12. As an operator, I want the brief to appear whether the door identified the call or a person
    did, so that both paths get the same help.
13. As an operator, I want a call still in NEW to have no brief, so that the model never reads
    records for an unidentified sender.
14. As an operator, I want a call identified to a service provider to get a brief from the policies
    and that provider's record only, so that no tenancy is read for a contractor.
15. As an operator, I want a requester who is only a guarantor never to receive service
    information in a brief, a follow-up, or a draft (foundation rule 7), so that the rule holds
    under the copilot too.
16. As an operator, I want an emergency-flagged call to have had its duty reply sent before any
    model reads the message (foundation rule 5), so that the copilot never delays the emergency path.
17. As an operator, I want to ask a follow-up question on the call's thread, so that I can dig
    deeper without leaving the call.
18. As an operator, I want the follow-up answered from the same records and policies as the brief,
    so that I cannot accidentally read another household's lease from this call.
19. As an operator, I want a follow-up that the records cannot answer refused with the frozen
    refusal sentence, so that I never act on an invented answer.
20. As an operator, I want to ask about the policy as of a specific date (for example the lease's
    signing date), so that I can see the law that applied when the lease was made.
21. As a colleague picking up a call, I want to see the whole thread, with who asked each question,
    so that I continue where the last person stopped.
22. As an operator, I want a Draft reply to the tenant on the call's page, so that I do not write
    the routine answer from scratch.
23. As an operator, I want the draft written in the language of the tenant's last message, so that
    the tenant reads it in their own language.
24. As an operator, I want a Hebrew rendering shown beside a draft that is not in Hebrew, so that I
    know what I am about to send.
25. As an operator, I want to edit the draft before sending, so that I stay the author of what the
    office says.
26. As an operator, I want to send the draft as a reply on the same Outlook thread the tenant wrote
    on, so that the tenant sees it in their conversation and it lands in the mailbox's Sent Items.
27. As an operator, I want to send the draft as a WhatsApp message on the same conversation while
    the 24-hour window is open, so that I answer where the tenant asked.
28. As an operator, I want the send control replaced by a copy control when the WhatsApp window has
    closed, so that I can paste it or phone instead.
29. As an operator, I want PHONE and WALK_IN calls to offer copy only, so that I can read the draft
    out or hand it over.
30. As an operator, I want a call still in NEW to offer copy only, so that nothing is sent to an
    address no one has identified.
31. As an operator, I want the server to choose the recipient from the identified address, never
    from anything I or the model typed, so that a reply cannot be misdirected.
32. As an operator, I want a send to an address that is not the one the call was identified by
    refused, so that a mistaken or hostile address cannot receive service information.
33. As an operator, I want every send on the call's timeline, with my name and whether I sent the
    draft as written or edited it, so that the office has a record of what was said.
34. As the director, I want the edited/as-written mark stored, so that the quality of the drafts can
    be measured over time.
35. As an admin, I want `calls.reply` held by ADMIN and OPERATOR and not by VIEWER, so that a
    read-only account cannot speak for the office.
36. As a viewer, I want to read the brief and the thread, so that I can follow calls without being
    able to send.
37. As an admin, I want to switch the copilot off at /settings without a deploy, so that I can stop
    it at once if it misbehaves or costs too much.
38. As an admin, I want the copilot's model id stored as a settings row, so that changing model is a
    row edit gated by the golden set, not a code change.
39. As an operator, I want the call page to work as it does today when the copilot is off or fails,
    so that a model outage never blocks the office.
40. As an admin, I want a מדיניות tab, so that laws and company policies live in the system and not
    in someone's drive.
41. As an admin, I want the tab split into sections, State law and Company policy today, so that
    each kind of source is kept apart.
42. As the director, I want a section to be a row, so that a further kind of context (not yet
    decided) can be added later without a migration or a code path.
43. As an admin, I want to upload a document into a section with its effective-from date, so that
    the library knows from when it applies.
44. As an admin, I want uploading a new version of a document to end the old one with an
    effective-to date and never overwrite it, so that an answer cited last year still points at the
    text it quoted.
45. As an admin, I want only `settings.write` holders to upload or supersede, so that the library is
    curated.
46. As any staff member, I want to read the library and open each document and its history, so that
    I can check a citation myself.
47. As an operator, I want the library searched as of today by default, so that the brief cites what
    is in force.
48. As the director, I want the library to hold no tenant data, so that it can be read for any call
    without crossing the isolation join.
49. As the director, I want the brief's retrieval capped at a fixed number of passages per section,
    so that the prompt does not grow as the library grows.
50. As the director, I want every change to the copilot's prompt, model, retrieval settings or tools
    to run the full golden set, so that a regression is caught before it ships.
51. As an operator, I want every brief, follow-up, draft and send audited, so that the copilot leaves
    the same trail as every other write.
52. As the director, I want the copilot never to move a call's state, set its Category, or decide
    responsibility, so that foundation rule 3 holds.

## Implementation Decisions

**Modules.** Four modules change and one is born. Spec edits go first, in the same change as the
code (SPEC-calls, SPEC-policy, SPEC-channel, SPEC-staff, SPEC-evidence). Plan mode applies: this
touches the policy layer and more than two modules.

- **calls** owns:
  - the Call thread's place on the call page;
  - the brief, the follow-up, the draft and the send commands;
  - the on/off switch and the model-id row;
  - the audit entries.

  The page continues to work with the copilot off, failed or absent.
- **evidence** owns retrieval and the office turn, as today:
  - The office turn gains a Call-thread mode. The bound is given by the caller, never by the model.
    The turn searches the bound plus the Policy library as of a date.
  - Evidence also stores each Policy document's bytes and passages, through the existing reading
    pipeline, under a Policy bound that carries no tenant data.
  - The office turn's frozen refusals, citation format and turn history are reused unchanged.
- **policy** is born:
  - it owns the Policy library, Policy sections, Policy documents and their versions, and the
    מדיניות tab;
  - it calls evidence's contract to store and read passages.

  SPEC-policy stops being a stub. It keeps the Policy rules it already describes and adds the
  library beside them, as a separate entity: a Policy document is never a Policy rule.
- **channel** owns the two new sends:
  - a reply on the inbound Outlook message, through Graph and `Mail.Send`;
  - a WhatsApp session message inside the 24-hour window.

  They generalise the duty-reply sends the door already has. They take a call and a body; the
  recipient comes from the call's identified address and the thread it arrived on, resolved on the
  server. SPEC-channel's statement that the pilot holds Mail.Read only is corrected: Mail.Send is
  granted on the test inbox. The production grant is still to be requested.
- **staff** gains `calls.reply` in the role matrix for ADMIN and OPERATOR.

**Where the bound comes from.** The bound is resolved from the identified requester:
- their live Tenancy, plus that Building's paper;
- otherwise their Unit or Building;
- for a service provider, their own record and nothing else.

The Policy library is added to every bound. The stance is administrator. A requester who is only a
guarantor gets no brief.

**The Call brief:**
- **When it runs.** It runs once, triggered by the transition to IDENTIFIED (by the door or by hand),
  after the emergency path has run. It runs only while the switch is on. It runs asynchronously, so
  identification never waits on a model.
- **What is stored.** It is stored as the first turn of the Call thread, with its citations. A
  refresh appends a new brief turn; it never edits the old one.
- **Language.** It is in Hebrew.
- **Retrieval.** It takes the top passages per source with a fixed cap per section, so the prompt
  stays the same size whatever the library holds.
- **Sources.** Each source is cited on its own line, labelled lease or by its Policy section. There
  is no ranking between sections; when ranking comes, it is a Policy rule.
- **Limits.** It proposes no command and moves no state.

**The Call thread** is one per ServiceCall. Turns record the staff account that asked, or "the
copilot" for the automatic brief. The thread is stored through staff's office-thread contract or
an equivalent keyed by the call, whichever keeps the shape of `OfficeRetrievalTurn`. It is distinct
from an office retrieval thread and from a Conversation.

**The Draft reply:**
- it is generated on request from the call page;
- it is written in the language of the tenant's last inbound message, with a Hebrew rendering
  stored beside it;
- it is stored on the call;
- it is never sent by the model.

**The send command.**
- It is refused unless every one of these holds:
  - the actor holds `calls.reply`;
  - the call is IDENTIFIED or later and not closed;
  - the channel is EMAIL or WHATSAPP;
  - for WhatsApp, the 24-hour window opened by the requester's last inbound message is still open.
- The recipient and the thread are resolved on the server from the call. No request field names
  them.
- The body is whatever the person submitted. The command stores whether it equals the stored draft.
- The send is audited and appears on the timeline with the sender.
- Everything else offers copy only.

**The Policy library.**
- **Sections:** `policy_section` is a row with a key, a Hebrew label and an order. It is seeded with
  State law and Company policy.
- **Documents:** a Policy document has a section, a title and effective-from. It gains effective-to
  when a new version supersedes it, in the same transaction that inserts the new one. A document is
  never updated in place and never deleted.
- **Search:** search takes an as-of date. A version is in force when effective-from ≤ date and
  (effective-to is null or date < effective-to).
- **Permissions:** upload and supersede require `settings.write`. Reading requires sign-in only.

**Settings rows.** The copilot's on/off switch and its model id are rows read on each request. This
follows `sorter.model`. Changing either is audited.

## Testing Decisions

A good test drives the system from outside, through a route or a contract command, and asserts what
a person or the database would see. It never asserts on a private function or a prompt string.
There are four seams, all of which exist today or follow an existing pattern.

1. **Calls routes.** The call page's POSTs for brief, refresh, follow-up, draft and send are tested
   in the style of the calls route tests and `office-turn.test.ts`:
   - Fakes: the fake extractor and embedder stand in for the model, and fake senders are injected
     the way the door's duty-reply senders are.
   - Behaviour: the brief appears after identification, not before, and is absent while the switch
     is off. A follow-up records its asker. The send reaches the fake sender with the server-resolved
     recipient. Copy-only is offered where it should be.
   - Records: the timeline and audit carry the sender and the edited/as-written mark.
2. **Policy routes.** The מדיניות tab is tested through HTTP. Upload is refused without
   `settings.write`. A new version sets effective-to on the old one and leaves its text intact.
   Reading the library works for a VIEWER. Search as of a past date returns the version then in
   force.
3. **Policy suite, red first.** Each new deterministic constraint gets a case in `tests/policy` that
   fails before the code exists:
   - send refused before IDENTIFIED;
   - send to an address other than the identified one refused;
   - WhatsApp send outside the 24-hour window refused;
   - send without `calls.reply` refused;
   - a superseded Policy document is never overwritten;
   - a guarantor-only requester gets no brief and no draft.

   Prior art: `call-requester.test.ts`, `emergency-term.test.ts`.
4. **Golden set.** New `evals/golden` cases. Prior art: `007-office-turn-refuses.json` and the
   building cases.
   - a brief cites a Policy document, labelled by section;
   - a brief cites a lease passage;
   - an off-scope follow-up is refused with no citations;
   - a draft to a tenant who wrote in English is in English, with a Hebrew rendering;
   - a policy question as of a past date cites the version then in force.

   The full set runs on any change to the copilot's prompt, model, retrieval settings or tools.

No new seam is opened inside evidence. The Call thread reaches the office turn through evidence's
contract.

## Out of Scope

- The additive AI emergency net: approved, in its own spec.
- Tenant-facing autonomy: the agent answering or acting without a person stays in SPEC-channel
  §Later.
- Proposed commands (category, responsibility, visit): these arrive with the visit flow. The thread
  should not make them hard to add.
- WhatsApp templates for sending outside the 24-hour window.
- Any ranking between state law, company policy and the lease.
- Automatic re-briefing on new messages.
- Sending on PHONE or WALK_IN.
- Further Policy sections beyond State law and Company policy. The design allows them; none is
  added here.

## Further Notes

- **Mail.Send in production.** Mail.Send is granted on the test inbox, and the emergency duty reply
  proves the path works. The production mailbox grant has not been confirmed, and requesting it is
  the director's. Sending on EMAIL in production waits on it. Copy works without it.
- **WhatsApp content and the model provider.** #249 recorded the check
  ([docs/research/whatsapp-openai-section-4-7.md](../docs/research/whatsapp-openai-section-4-7.md)):
  no. A WHATSAPP call gets no brief and no draft. ADR-0004's four decisions stand; the note adds a
  limit they did not contain, and the ADR points at it.
- **No real tenant documents.** The golden cases and fixtures use the specimen clauses and synthetic
  policy texts only.
- **Glossary and ADR.** The terms (Call thread, Call brief, Draft reply, Policy document, Policy
  library, Policy rule) are in CONTEXT.md. The decision is ADR-0017. The research behind it is
  `docs/research/calls-agent-landscape.md`.

## Comment — 2026-10-17

#249 is closed. The check is recorded in [docs/research/whatsapp-openai-section-4-7.md](../docs/research/whatsapp-openai-section-4-7.md): no. #257 is copy only on WhatsApp, with no brief and no draft. ADR-0004's four decisions stand. The note adds a limit they did not contain, and the ADR points at it.
