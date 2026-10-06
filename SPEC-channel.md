# SPEC: channel

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The vocabulary is
[CONTEXT.md](CONTEXT.md)'s; the build is tracked by #181, and the WhatsApp route is
[ADR-0013](docs/decisions/ADR-0013-whatsapp-arrives-by-coexistence.md).

- **Owns:** the adapters, the intake door, the conversation, and the sorter port. Later, tenant
  verification and the tenant-facing agent's tools.
- **Entities:** Conversation · Message (`body_original` + `body_he`).
- **Depends on:** scope, calls, parties, evidence.

## The intake door

**Every channel enters through one door**, and an adapter's only job is to turn what its provider
delivers into one normalised incoming message: Source channel, external message id, external thread
or conversation id, sender address, received time, subject, body, attachments, and whether it is an
echo of something the office sent. The door then runs in this order:

1. **De-duplicate** on the external message id.
2. **Store the Message.**
3. **Check for an emergency**, deterministically and before any model call (foundation rule 5). The
   flag and the fixed duty reply are calls' to perform.
4. **Thread.** A message on a thread with an open ServiceCall attaches to it and stops. A thread
   whose call is closed opens a new call linked to the old one.
5. **Identify** the sender through `scope`'s isolation join: phone or email, valid today.
   **Not in #186.** That step is #189. Until then the door leaves every call in NEW with the raw
   sender address and no Party.
6. **Sort.** Noise becomes a Filtered message. A call, or an unsure verdict, becomes a ServiceCall in
   NEW, with an unsure verdict marked "to review".

**A match is never filtered.** The emergency check has already run. When the text matches, a noise
verdict or a sorter failure still opens a flagged ServiceCall in NEW, marked "to review" unless the
verdict was a plain call. An emergency does not become a Filtered message.

**An echo** (a message the receptionist sent from the phone) is stored on the conversation and, when
the thread has an open call, on that call's timeline. It is not an incoming request: the door does
not check it for an emergency, does not sort it, and never opens a call from it. Manual PHONE and
WALK_IN entries are calls' own and do not pass through this door.

**A dev-only form** pushes a fabricated message through this door, and the person at the form picks
the verdict the fake sorter returns, so the path can be clicked before a mailbox or a number is
connected. The form is registered only on a `-dev` process. A stamped revision does not serve it.

**Nothing from before the connection day is imported.** Coexistence's history webhook is
acknowledged and discarded. A mailbox is read from the cursor it starts at.

## The sorter port

**The sorter proposes and decides nothing.** One port, two operations:
- **sort** returns call, unsure or noise, a Category from calls' list, and a Hebrew summary.
- **translate** fills `body_he` when the message is not in Hebrew. The translation is for display
  and is never input to a decision.

**A fake in tests; OpenAI on staging and in production**, with the model id in configuration. The
sorter sees the message's subject and text only, and no store. Its output reaches the office only,
so identifiers are not masked (ADR-0006).

**A sorter failure never drops a message.** It becomes a ServiceCall marked "to review", with no
summary.

**Any change to the sorter's prompt, model id or the Category list runs the full golden set.** The
golden set's messages are fabricated, never a real tenant's.

## Adapters

**Outlook is the client's inbox and is built first**, through Microsoft Graph:
- An app registration in Dona Dom's Microsoft 365 tenant, holding the application permissions
  `Mail.Read` and `Mail.Send`, both limited to the one shared mailbox by Exchange Online's RBAC for
  Applications. **Nothing here can delete, move or mark mail as read.** `Mail.Send` exists for one
  message only: the fixed emergency reply, which lands in that mailbox's Sent Items like any reply
  the office sends (decided 6 Oct 2026).
- Polled with a delta query every one to two minutes, with the cursor stored.
- Threading comes from the conversation id.
- Staging reads a test mailbox. Production reads the real one. Granting admin consent is the
  director's act.

**Gmail is a standby**: the same interface, the Gmail API with the `gmail.readonly` scope, tested on
recorded payloads, and wired to no mailbox.

**WhatsApp is the Cloud API with coexistence** (ADR-0013):
- The office number stays on the receptionist's phone in the WhatsApp Business app, and every 1-on-1
  chat on it reaches the door.
- Inbound messages and `smb_message_echoes` are consumed. Webhook signatures are verified, and media
  is fetched on receipt.
- **Staging uses Meta's developer test number**, so the adapter is built before App Review finishes.
- **Connection health**: no echo for 7 days raises a warning in the tab, ahead of Meta disconnecting
  a primary device inactive for about 14 days. A mailbox that has not been read successfully for an
  hour raises a warning too.

**Attachments** stay on their Message and show on the call. The office may file one as an Unassigned
document through evidence's filing path, which is the only way an attachment becomes a Document.

## Later

**The agent is a client, not a brain**: scoped tools only, every call audited, and it reaches data
solely through `src/scope/`. Its rules get their own grilling once WhatsApp intake runs on real
traffic, and until then are undecided:
- when it replies and when the receptionist does, and how one takes over from the other on the
  shared number;
- the acknowledgement on a new call, and feedback after close;
- the 24-hour window and templates;
- what it says about money.

What is settled for that work:
- **Tenant OTP goes by WhatsApp authentication template only.** There is no SMS fallback and no SMS
  provider (ADR-0013).
- **An acknowledgement or feedback message goes only to an identified sender**, and never moves a
  call (foundation rule 3).
- **Foundation rule 2 is retired** ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)).
  Priority is the system of record for what anybody owes, and this platform holds no balance.
- **An emergency never reaches the agent.**
