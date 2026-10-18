---
number: 256
title: Send the reply on Outlook
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [255]
parent: 247
created: 2026-10-16
closed: 2026-10-18
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

On an EMAIL call, a staff member with `calls.reply` can send the draft, edited or as written, as a
reply to the inbound message the call was opened from.

**Prefactor first**
- Generalise the channel's duty-reply sends into one Outlook reply send: a Graph reply on the
  inbound message. Its callers are the existing duty reply and this reply.
- Correct the SPEC-channel line that described the duty reply's send.
- The existing duty-reply tests stay green unchanged.

**Permission**
- `calls.reply` is added to the role matrix for ADMIN and OPERATOR, and to SPEC-staff.
- A VIEWER sees copy, not send.

**What the server refuses**
- The server refuses a send unless every one of these holds:
  - the actor holds `calls.reply`;
  - the call is IDENTIFIED or later and not closed;
  - the channel is EMAIL.
- Only one recipient is possible. The server resolves the recipient and the thread from the call's
  own inbound message. The page never supplies an address.

**Record**
- The send is a timeline row on the call and an audit row.
- Each send is marked edited or as written, and records the actor and the text sent.

**Production grant (the director's):** Mail.Send for production is the director's to request. Until
it is granted, this is verified against the development tenant only.

## Acceptance criteria

- [x] The duty-reply sends go through the generalised send, and their tests pass unchanged.
- [x] `calls.reply` is in the role matrix and SPEC-staff for ADMIN and OPERATOR only.
- [x] Each refusal has a policy case that was red first:
  - [x] no permission;
  - [x] before IDENTIFIED;
  - [x] a closed call;
  - [x] the wrong channel;
  - [x] a client-supplied recipient, which is ignored.
- [x] The timeline and audit carry the edited or as-written mark, the actor and the text.
- [x] Clicked on staging against the test mailbox. The reply lands in the inbound message's thread.

## Blocked by

- #255 — closed 2026-10-18

## Comment — 2026-10-18

The send is on the call page for an EMAIL call once it is identified and still open. ADMIN and OPERATOR see send. A viewer sees copy, and a post without `calls.reply` is refused. The five refusals were red first. The timeline and the audit name the actor, the text, and whether it matched the stored draft. The development mailbox is not configured in this environment (`GRAPH_MAILBOX` unset), so the click on `:3000` is still open.

## Comment — 2026-10-18

Closed from the staging click. On call `01a13209`, the caller was identified, a draft was written twice, and send at 05:48:49Z returned 303 in 1.4 seconds. The page that followed returned 200. Nothing on that call was a 4xx or a 5xx. The revision booted with Outlook configured. One inbox read timed out a few seconds before the send; the send itself did not. The reply arrived in the asafv inbox. #257 is next.
