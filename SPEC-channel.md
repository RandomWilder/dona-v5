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

1. **De-duplicate** on the external message id. A message already stored and finished is the same
   message again. A message stored and not yet finished — the emergency check threw, or the process
   stopped before a verdict — is finished by this delivery, not stored a second time.
2. **Store the Message.** This happens before the emergency check and before the sorter, so a
   failure there leaves the message held.
3. **Check for an emergency**, deterministically and before any model call (foundation rule 5). The
   flag is calls' to perform. The fixed duty reply is composed by calls, and the channel sends it
   before a model is asked to read the message.
4. **Thread.** A message on a thread with an open ServiceCall attaches to it and stops. A thread
   whose call is closed opens a new call linked to the old one.
5. **Sort.** Noise becomes a Filtered message. A call, or an unsure verdict, becomes a ServiceCall
   in NEW, with an unsure verdict marked "to review".
6. **Identify** that new call through `scope`'s isolation join: phone or email, valid today.
   Exactly one party moves it to IDENTIFIED. No party, or more than one, leaves it in NEW with the
   raw address. A guarantor's contact is not a match. A message that attaches to an open call does
   not identify again. An address the join cannot read — a phone that is not a number, an email
   with no `@` — is no match, and the message is still kept. Identification follows the sort
   because only a new call has a state to move. **A service provider is the one party the join
   does not return who is still identified (#208).** When the join returns nobody, the door asks
   scope who holds that open contact today — a party, and no unit — and estate whether that party
   is a provider. Exactly
   one provider moves the call to IDENTIFIED. The join still returns no unit. A guarantor stays
   unmatched even when that party is also a provider: the call stays NEW and the message is kept.
   A contact that is not a provider, and not a service contact on an active tenancy, leaves the
   call in NEW.

**A match is never filtered.** The emergency check has already run. When the text matches, a noise
verdict or a sorter failure still opens a flagged ServiceCall, marked "to review" unless the
verdict was a plain call. Identification then runs as on any new call. An emergency does not
become a Filtered message.

**An echo** (a message the receptionist sent from the phone) is stored on the conversation and, when
the thread has an open call, on that call's timeline. It is not an incoming request: the door does
not check it for an emergency, does not sort it, and never opens a call from it. Manual PHONE and
WALK_IN entries are calls' own and do not pass through this door.

**A dev-only form** pushes a fabricated message through this door. When no sorter is
configured, the person at the form picks the verdict, so the path can be clicked before a key is
present. When the sorter is configured, the form sends the message through it. The form is
registered only on a `-dev` process. A stamped revision does not serve it.

**Nothing from before the connection day is imported.** Coexistence's history webhook is
acknowledged and discarded. A mailbox is read from the cursor it starts at.

## The sorter port

**The sorter proposes and decides nothing.** One port, two operations:
- **sort** returns call, unsure or noise, a Category from calls' list, and a Hebrew summary.
- **translate** fills `body_he` when the message is not in Hebrew. The translation is for display
  and is never input to a decision.

**A fake in tests; OpenAI on staging and in production**, with the model id in the `sorter.model`
row, read per call. The prompt version sits beside the prompt. The sorter sees the message's
subject and text only, and no store: the door hands it the active Category list, and it does not
read one. Its output reaches the office only, so identifiers are not masked (ADR-0006).

A Category the model names that is not on the active list is stored as no Category. The model id
and the prompt version are stored on the verdict, on the call and on the message.

**A sorter failure never drops a message.** Sort timing out, or any error from it, becomes a
ServiceCall marked "to review", with no summary. Translate timing out leaves `body_he` empty and
does not change that verdict.

**A translation is checked against the letters, not taken on the model's word.** A reply that calls
a message Hebrew when under half its letters are Hebrew, or hands back a translation under half
Hebrew letters, is asked for once more; a second such reply counts as a failure, and `body_he`
stays empty. The model judges which language a message is in; the code only refuses a judgement
the text contradicts.

**Any change to the sorter's prompt, model id or the Category list runs the full golden set.** The
golden set's messages are fabricated, never a real tenant's.

## Adapters

**Outlook is the client's inbox and is built first**, through Microsoft Graph:
- An app registration in Dona Dom's Microsoft 365 tenant, holding the application permissions
  `Mail.Read` and `Mail.Send`, both limited to the one shared mailbox by Exchange Online's RBAC for
  Applications. **Nothing here can delete, move or mark mail as read.** `Mail.Send` is one Graph
  reply on an inbound message. It lands in that mailbox's Sent Items. Its callers are the fixed
  duty reply and the office's reply on an EMAIL call (#256). The test mailbox holds `Mail.Send`.
  Production `Mail.Send` is still for Dona Dom's administrator to grant. No mail permission is granted
  in Entra: access is the Exchange role assignment alone, which reaches the mailbox's folders but not
  the directory, so the adapter never looks up a user.
- Polled with a delta query every one to two minutes, with the cursor stored. The first read
  asks for a cursor as of now and imports nothing earlier. The cursor is stored only after that
  page has been handed to the door. Graph names the inbox by its folder id in the link it returns,
  in path form or as `mailfolders('…')`, and that link is what is stored. It must still be an inbox
  message delta on `graph.microsoft.com` for this mailbox. Any other link is refused and not requested.
  When the link names the user by id, the inbox's folder id is the check, since a folder id belongs
  to one mailbox.
- Threading comes from the conversation id.
- Staging reads a test mailbox. Production reads the real one. The app registration and the
  Exchange role assignment are done by Dona Dom's Microsoft 365 administrator. The process polls
  only when the tenant, the application, its secret and the mailbox are all set; otherwise it
  boots unconfigured and the tab stays quiet. An hour without a successful read, once it is
  polling, shows a warning on the קריאות list, and a successful read clears it.
- The client secret lasts 24 months. Its expiry date is stored with it, and from 30 days before
  that date the קריאות list shows a warning to renew it. Renewing is a new secret and its new date,
  nothing else.
  A configured mailbox with no expiry date, or one that is not a date, shows a warning that the
  expiry is unknown, so a missing date is never silent.

**Gmail is a standby**: the same interface, the Gmail API with the `gmail.readonly` scope, tested on
recorded payloads, and wired to no mailbox.

**WhatsApp is the Cloud API with coexistence** (ADR-0013):
- The office number stays on the receptionist's phone in the WhatsApp Business app, and every 1-on-1
  chat on it reaches the door.
- Inbound messages and `smb_message_echoes` are consumed. Webhook signatures are verified, and an
  unsigned or wrongly signed webhook is rejected. Media is fetched on receipt and stays on the
  Message. The `history` webhook is acknowledged and discarded.
- The process accepts webhooks only when the app secret, the verify token, the access token and the
  phone number id are all set. Otherwise it boots unconfigured and the tab stays quiet.
- **Staging uses Meta's developer test number**, so the adapter is built before App Review finishes.
- **Connection health**: no echo for 7 days raises a warning in the tab, ahead of Meta disconnecting
  a primary device inactive for about 14 days. The clock starts when the adapter is configured, and
  an echo clears the warning. A mailbox that has not been read successfully for an hour raises a
  warning too.
- **Emergency reply.** When the terms flag a WhatsApp call, the channel sends one session message
  on that conversation — the fixed duty reply calls composed — inside the 24-hour window the
  inbound message opened. It is not a template. No model writes it. It is stored on the call's
  timeline and audited. A second emergency message on the same open call does not send another. A
  call flagged by hand sends nothing. PHONE and WALK_IN send nothing. The sentence stays the
  placeholder until the director approves the wording.

**Attachments** stay on their Message and show on the call. The bytes are kept with the message, so
the call shows the file's name, type and size and the office can open it without the mailbox. A file
the mailbox marks as embedded in the message is an attachment when it is 64 KB or larger, and is not
one below that. A phone photo pasted into the body is the evidence a tenant sends, and mail programs
embed it rather than attach it; signature logos and icons sit below the line (on the pilot mailbox a
signature logo was 51 KB and pasted images 87 KB and 2.5 MB). The channel asks the mailbox for a
message's files on every message, because a mailbox may report a message with only embedded files as
having none. The office may file an attachment as an Unassigned document through evidence's filing
path, which is the only way an attachment becomes a Document. Filing declares the type and anchors
the file to the unit the isolation join names, when that address is exactly one household, and
leaves the document with no tenancy link. A guarantor's contact is not a match. Filing that same
attachment again is that document, not a second one. A file this system does not store is refused.

## Sign-in codes

The portal asks the channel to deliver a one-time code. The channel does not choose the code,
store it or check it. A **code sender** is that delivery: `send({ to, code, channel })`, injected
the way the WhatsApp fetch is. `channel` is `whatsapp` or `sms`. ADR-0013 §5's ban on an SMS code
is superseded by ADR-0019: a tenant code may go by SMS. Twilio is not the provider.

Two real senders, each off until it is configured:

- **WhatsApp** posts an authentication template on Dona Dom's WhatsApp Business account, using the
  same Cloud API access token and phone-number id as the adapter. It is on when
  `PORTAL_WHATSAPP_TEMPLATE`, `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are all set.
  The template name is the first of those; the language is Hebrew (`he`). The code is the
  template's body parameter and its copy-code button parameter. Setting the template name without
  the other two refuses to boot.
- **SMS** posts to InforU, where we generate the code
  (`https://cloud.inforu.co.il/api/v2/Otp/Message/Send`), with HTTP Basic auth. It is on when
  `INFORU_USERNAME`, `INFORU_TOKEN` and `SMS_SENDER` are all set, and off when none of them is.
  Setting some but not all refuses to boot. `SMS_SENDER` is at most 11 Latin letters or digits
  and contains no spaces; anything else refuses to boot. The text is one Hebrew SMS, at most 70
  characters once the code is filled in. The number is an Israeli mobile in national form
  (`05` and eight digits); anything else is refused before the request. InforU's IP allowlist is
  how the gateway rejects a caller it was not told about. That list is configured at InforU, not
  stored here.

A provider error, from either, is a refusal the tenant can retry. The provider's response is not
shown and not written to the audit row or the log.

Neither sender is called from a test. Tests inject the fetch. With neither configured, `npm run dev`
uses a log sender that writes the code, and not the number, to the server log, so the flow can be
clicked. That sender is built only when `K_SERVICE` is unset. Setting `PORTAL_CODE_LOG=1` where
`K_SERVICE` is set — staging and production — refuses to boot. A revision with neither real sender
configured does not fall back to that log: sending is refused.

When only one real sender is configured, that is the only channel, the phone screen does not
mention the other, and the code screen has no fallback card. When both are, WhatsApp is sent
first. Once the minute before another code has passed, the code screen offers SMS as a card at
the bottom, not as a switch at the top. Choosing it sends a new code by SMS, and the screen's
line names SMS. After an SMS send, and once that minute has passed again, the card offers
WhatsApp. A revision with no sender configured does not show the phone form. The caps below count a code row whichever channel delivered it.

What the portal enforces, and the sender never sees:

- Six digits, one use, five minutes, five wrong attempts, then the code is dead. Stored as a
  salted hash. The row holds no column a person could type back in.
- Sixty seconds before another code to the same number. The page says how long is left, rendered
  by the server. The control that asks for a new code is on the page only after that wait.
- Five sends per number and twenty per network address, each in a rolling day, counted from the
  code rows. A refusal at the cap is still an audit row.
- An Israeli mobile only: `+972`, then `5`, then eight digits. Anything else is refused before a
  send, and nothing is stored.
- Every send and every verify, passed or failed, is an audit row. The row carries neither the
  number nor the code.
- Email is not a way to ask for a code.

The phone screen names the channel the code will use. With both senders configured it names
WhatsApp and says the next screen can send an SMS instead.

## New-device notice

A code that verifies for a portal identity that already exists is a new-device sign-in. The portal
asks the code sender once: `notify({ to, channel })`, on the channel that just delivered the code.
The first code, which creates the identity, is not one of these, and a passkey sign-in is not one
either. A failure to deliver does not undo the sign-in. The sender does not retry.

The sentence is fixed, and it is this one, in both channels:

`כניסה חדשה לפורטל דונה דום. לא אתם? פנו למשרד.`

Forty-six characters, so the SMS is one unit. The sender never accepts a sentence from the caller,
which is what keeps a notice from becoming a second channel for whatever a route wants to say.

- **WhatsApp** posts a utility template named by `PORTAL_WHATSAPP_NOTICE_TEMPLATE`, Hebrew, with no
  parameters: the sentence above is the template body, approved in Meta's console. The same access
  token and phone-number id as the code. When the name is unset, this sender refuses the notice.
  That refusal does not refuse to boot, and it does not refuse the sign-in.
- **SMS** posts to InforU's SMS send (`https://cloud.inforu.co.il/api/v2/SMS/SendSms`), not the OTP
  endpoint, with the same Basic auth and the same sender name. The number is the Israeli mobile in
  national form. Anything else is refused before the request.

The log sender writes `portal new-device notice` and not the number. A test injects the fetch.
Neither real sender is called from a test.

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
- **A tenant code goes by WhatsApp authentication template, or by SMS when the tenant chooses it**
  (ADR-0019, which supersedes ADR-0013 §5). The sign-in section above is that rule. There is no
  email fallback.
- **An acknowledgement or feedback message goes only to an identified sender**, and never moves a
  call (foundation rule 3).
- **Foundation rule 2 is retired** ([ADR-0008](docs/decisions/ADR-0008-money-is-ordinary-data.md)).
  Priority is the system of record for what anybody owes, and this platform holds no balance.
- **An emergency never reaches the agent.**
