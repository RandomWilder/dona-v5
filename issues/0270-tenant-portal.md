---
number: 270
title: "Tenant portal: sign in by phone, see my flat, my papers and my calls, report or ask"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-19
closed:
---

Decision of record: [ADR-0019](../docs/decisions/ADR-0019-the-tenant-portal-is-a-source-channel.md).
Research: [tenant-portal.md](../docs/research/tenant-portal.md),
[sms-gateway-israel.md](../docs/research/sms-gateway-israel.md). This spec covers phase 0 (the
mockup) and phase 1 (the first working portal). Phases 2–4 are out of scope below.

## Problem Statement

A tenant of Dona Dom has one way to reach the office that leaves them a record: none. They can send a
WhatsApp message, an email or call, and the office sees everything — the ServiceCall, its state, the
reply, the lease and the documents — but the tenant sees only the chat they happened to use. They
cannot look up whether their leak was received, whether anyone is handling it, what the office
answered last month, or what their lease says. Every one of those questions becomes another message,
which becomes another call for the office to sort.

WhatsApp is also the only door that would carry a sign-in code today (ADR-0013 §5), and it is now
paid past 1,000 service messages a month per number and stops delivering without a payment method.
Not every Israeli uses WhatsApp. A tenant surface that depends on it alone fails exactly the tenants
least able to work around it.

The office, for its part, measures how long a call has waited in minutes for every call. Minutes fit
an emergency; a regular repair or question is handled in days, and the office has no way to state,
or to measure, a reply time a tenant could be told.

## Solution

A **Portal**: a web application on its own tenant subdomain, installable on the phone, in Hebrew,
English and Russian. A tenant signs in with their phone number — a one-time code by WhatsApp, or by
SMS if they prefer, then a passkey on that device so later sign-ins need neither. Inside, a verified
active tenant of a **Portal-enabled building** sees their flat, their tenancy documents and their
ServiceCalls with a plain **Tenant status** word, reads the office's replies, writes back, and reports
an issue or asks a question. Anyone with a verified number can ask the office, without seeing any
tenancy data.

A report or question from the portal is an ordinary ServiceCall with Source channel `PORTAL`. It
enters through the same door as WhatsApp and email — dedupe, store, emergency check, thread, sort,
identify — and the office handles it in the same calls list. WhatsApp stays open; nothing is taken
away from a tenant who never opens the portal.

The office switches each Building into the portal, and cannot do so while any legal text is still a
placeholder. Non-emergency calls get a second clock in **Business days** beside the emergency clock
in minutes, and a **Reply target** — "we reply within X business days" — that tenants see only once
the office switches it on.

## User Stories

### Signing in

1. As a tenant, I want to sign in with the phone number the office already has for me, so that I do not need to create or remember a username.
2. As a tenant, I want to receive my one-time code by WhatsApp by default, so that it arrives where I already read messages.
3. As a tenant who does not use WhatsApp, I want to choose to receive my code by SMS, so that I am not locked out.
4. As a tenant with a kosher phone, I want the SMS code to work on a phone without internet, so that I can still sign in on another device.
5. As a tenant, I want to set up a passkey (fingerprint, face or device PIN) after my first sign-in, so that I do not need a code every time.
6. As a tenant, I want later sign-ins on the same device to use my passkey, so that signing in takes a second and costs the office nothing.
7. As a tenant, I want to be told by message on my number whenever a new device signs in to my portal, so that I notice if someone else did.
8. As a tenant, I want a clear message when I type a wrong or expired code, and a way to ask for a new one, so that I know what to do next.
9. As a tenant, I want to stay signed in on my own phone for a reasonable time, so that I am not asked to sign in at every visit.
10. As a tenant, I want to sign out, and to sign out of every device, so that I can protect my portal if I lose a phone.
11. As a tenant, I want sign-in to refuse a number that is not an Israeli mobile number, so that the system does not send codes to strangers abroad.
12. As the director, I want code sends capped per number, per network address and per day, and every send recorded, so that an attacker cannot run up SMS charges.
13. As the director, I want email never to be a way to sign in to the portal, so that a hijacked mailbox cannot open a tenant's records.

### First visit and legal texts

14. As a tenant signing in for the first time, I want to see the privacy notice and terms in my language, so that I know what the portal does with my data.
15. As a tenant, I want to acknowledge that I have read the privacy notice, without the service being made conditional on consent, so that my rights under the Privacy Protection Law are respected.
16. As a tenant, I want optional choices (such as receiving building notices later) to be off unless I turn them on, so that I am not opted in by default.
17. As a tenant, I want to be shown the notice again when its version changes, so that I am never held to text I have not seen.
18. As the director, I want every acknowledgement recorded with the text's version, language and time, so that the office can show what a tenant was shown.
19. As Dona Dom's legal team, I want the legal texts held as editable, versioned rows per language, so that we can replace the placeholder wording without a code change.

### Who sees what

20. As a verified active tenant of a portal-enabled building, I want to see my flat, my tenancy documents and my ServiceCalls, so that I have my own record.
21. As a tenant with two tenancies, I want to see each of my tenancies and choose between them once, so that the whole portal — my flat, my papers, my calls and a new report — shows the flat I chose.
22. As a co-tenant on the same lease, I want to see the same tenancy and its calls under my own number, so that either of us can follow up.
23. As a guarantor, I want to sign in and ask the office a question, and never see the tenancy's service information, so that the guarantor rule holds in the portal too.
24. As a tenant whose tenancy has ended, I want to still ask the office a question, and no longer see the tenancy's documents, so that past tenants are not shown a live letting.
25. As a person whose number the office does not know, I want to verify my number and ask the office a question, so that I can reach the office without being a tenant.
26. As a tenant of a building not yet in the portal, I want to sign in and ask the office, and be told my building's records are not in the portal yet, so that I understand why I see less.
27. As the director, I want access decided on every request from the verified number through the isolation join, so that a tenancy that ends today stops showing today.
28. As the director, I want a tenant who changes an identifier in a page address to get "not found" for anything that is not theirs, so that no tenant can read another tenant's data.
29. As the director, I want every tenant read of tenancy data recorded in the audit log, so that the office can answer who saw what and when.

### My flat and my papers

30. As a tenant, I want to see my flat's address, unit, and my tenancy's dates, so that I can answer basic questions myself.
31. As a tenant, I want to see the parking bay and storage assigned to my tenancy, so that I do not need to ask.
32. As a tenant, I want to open my lease and the other documents filed to my tenancy, so that I can read what I signed.
33. As a tenant, I want to download a document I can see, so that I can keep my own copy.
34. As a tenant, I want to see only documents filed to my tenancy, never office-only records of the flat or the building, so that the portal shows me what is mine.

### Reporting an issue and asking a question

35. As a tenant, I want a short "report an issue" flow — what, then details, then entry — so that I can open a ServiceCall without phoning and without facing one long form.
36. As a tenant, I want an "ask the office" form, so that a question reaches a person and is tracked like any call.
37. As a tenant, I want to pick a category for my report, so that I can say what kind of problem it is.
38. As the office, I want the tenant's category to be only a suggestion the sorter and the office may change, so that a wrong pick does not misroute the call.
39. As a tenant, I want to attach photos or a short video to a report, so that the office sees the problem.
40. As a tenant, I want to state whether the office may enter my flat when I am out, so that a repair is not delayed by that question.
41. As a tenant, I want the report to tell me first, before any question, to phone the duty number for an emergency, with a button that dials it, so that I do not wait on a form for a burst pipe.
42. As a tenant, I want an emergency word in my report to trigger the same emergency handling as on WhatsApp, so that the channel never weakens the emergency check.
43. As a tenant, I want to see that my report was received, with its call number, immediately after I send it, so that I know it arrived.
44. As a tenant, I want sending the form twice by accident to open one call, not two, so that I do not create duplicates.
45. As a tenant, I want to write in any language I choose, so that I can explain the problem in the words I have.
46. As the office, I want a portal report to arrive in the same calls list as every other channel, marked `PORTAL`, so that we work one list.
47. As the office, I want a portal call's sender to be the verified number, already identified when it matches a tenant, so that we skip a step.
48. As the office, I want a question from an unknown verified number to stay unidentified but marked as from a verified number, so that we know the number is real.
49. As the office, I want a verified non-tenant's call identified by number with no tenancy attached, so that we know who it is without implying a letting.

### My calls and replies

50. As a tenant, I want a list of my calls with the newest first, each with its date, category, short summary and Tenant status, so that I can follow them.
51. As a tenant, I want to see each call's status in a plain word — received, in progress, awaiting scheduling, visit scheduled, or how it was closed — so that I understand where it stands without the office's internal states.
52. As a tenant, I want to see calls I opened on WhatsApp, email or by phone in the same list, so that the portal shows my whole history, not only what I typed there.
53. As a tenant, I want to open a call and read the thread of my messages and the office's replies, so that I have the conversation in one place.
54. As a tenant, I want to write a follow-up message on an open call, so that I add information without opening a new one.
55. As a tenant, I want writing on a closed call to open a new call linked to it, as on WhatsApp, so that a recurring problem is tracked.
56. As a tenant, I want a call the office cancelled to show "cancelled" with the office's note, so that I know why it was closed.
57. As a tenant, I want never to see the office's internal clocks, bands, briefs or drafts, so that I see the office's replies, not its working notes.
58. As the office, I want to reply to a portal call from the call page and have the reply appear in the tenant's portal thread, so that we answer on the call's own channel.
59. As the office, I want to be unable to return a `PORTAL` call to the filtered list, and to cancel it with a note instead, so that the tenant sees what happened and the reply measurement stays honest.

### Language and accessibility

60. As a tenant, I want the menus, buttons and fixed texts in Hebrew, English or Russian, so that I can use the portal in my language.
61. As a tenant, I want the portal to open in my preferred language from my record, and to let me switch, so that I start in the right language.
62. As a tenant reading in English or Russian, I want the page laid out left to right, and in Hebrew right to left, so that it reads naturally.
63. As a tenant using a screen reader or keyboard only, I want every page usable, so that the portal meets IS 5568.
64. As a tenant on a small phone, I want every page to work at phone width without sideways scrolling, so that the portal is usable where I use it.
65. As the office, I want new UI languages added as rows of translated text, not code, so that adding one later is a translation job.

### Installing the portal

66. As a tenant, I want to add the portal to my home screen, so that it opens like an app.
67. As a tenant, I want the portal to open on its own address, separate from the office console, so that I never land on a staff page.

### Office: switching buildings in

68. As an administrator, I want a switch on each Building that puts it in the portal or takes it out, so that we choose which buildings are live.
69. As an administrator, I want the switch to refuse to turn on while any legal text in any portal language is a placeholder, so that no tenant is shown unapproved wording.
70. As the director, I want turning a building off to take effect on the tenant's very next request, so that the switch is a real guardrail.
71. As the director, I want every switch on or off recorded with who and when, so that the pilot's history is clear.
72. As the director, I want the switch to need its own staff permission, so that not every operator can change what tenants see.

### Office: two clocks and the reply target

73. As the office, I want emergency calls measured in minutes and every other call measured in business days, so that each clock fits its work.
74. As an administrator, I want to set the handling thresholds in business days at `/settings`, beside the existing emergency thresholds in minutes, so that the office manages both in one place.
75. As an administrator, I want to keep the list of non-working dates (holidays) at `/settings`, so that business days skip them.
76. As the office, I want the calls list to show each non-emergency call's handling band in business days, so that the handling time stays clear to us.
77. As an administrator, I want to set the reply target X in business days, so that the office's promise matches what it can do.
78. As the director, I want "reply" to mean a message a person sent, not the automatic acknowledgement, so that the target measures real replies.
79. As the director, I want a "show to tenants" setting, off by default, that puts "we reply within X business days" on the portal, so that we promise only once the pilot shows we keep it.
80. As the director, I want to see, over a chosen period, what share of calls got a person's reply within X business days, so that I can decide when to switch the promise on.

## Implementation Decisions

**The spec edits ride with the tickets.** Each ticket edits its module's `SPEC-<module>.md` first, in
the same change as its code, per this repo's rule. The edits this spec implies: SPEC-calls (the
`PORTAL` value, Tenant status, two clocks, Reply target, Business day, no return to filtered for
`PORTAL`); SPEC-channel (the portal intake and the SMS code sender); SPEC-scope (the Portal identity
read and access per request); SPEC.md (the tenant stance, the tenant host and cookie, the client
JavaScript exceptions, the third-party table, the building switch); SPEC-parties (the verified
number).

**Phase 0 comes first.** `mockups/tenant-portal.html`, served at `/dev/mockups/tenant-portal`, paints
sign-in, the first-visit notice, my flat, my papers, my calls, a call thread, report, ask, and the
office's building switch and reply-target settings. The director clicks it before any route is wired;
it is deleted when the flow is wired. Its tenant screens follow the director's design brief of
19 October 2026 (screens 1a–1o and 1g′): the paint is the reference each screen ticket names, and
its `--tp-*` tokens and components become the portal's design system, landed by #273.

### Modules

- **A new portal module** owns the tenant-facing routes, the tenant session, sign-in codes, passkeys,
  legal texts and their acknowledgements, and the tenant's UI strings. It reads other modules only
  through their contracts and writes only through their commands. It holds no copy of call, tenancy
  or document data.
- **channel** gains `PORTAL` as a Source channel. A portal submission enters the same intake function
  as every other channel. The portal supplies a per-submission idempotency key as the external
  message identifier, so a double submit dedupes; the external thread is the call, so a follow-up on
  an open call threads to it. The sender address is the verified number in E.164.
- **channel** gains a code sender with two implementations — WhatsApp authentication template and
  SMS gateway — behind one interface, injected like the WhatsApp fetch is today. We generate and
  check the code; the provider only delivers it.
- **calls** gains the Tenant status mapping, the handling clock in business days, the Reply target
  measure, and the refusal to return a `PORTAL` call to filtered. An office reply on a `PORTAL` call is
  sent on the call's own channel, which for `PORTAL` means it is stored on the call's thread and
  shown in the portal.
- **scope** gains one read: given a verified number and a date, the Parties it resolves to, their
  labels, and the active Tenancies (with Unit and Building) the isolation join reaches. It stays the
  only place the join is written.
- **estate** gains the per-Building portal switch.
- **staff** gains one permission for the switch.
- **app** gains a tenant stance vocabulary and serves the portal on its own host.

### Identity and sessions

- A **Portal identity** is a verified phone number, stored once with when it was first verified. It
  is not a Party and has no role. Every request resolves it afresh through the scope read; nothing
  about tenancy is cached in the session.
- A **Tenant session** is a server-side row; the browser holds an opaque identifier in an `HttpOnly`,
  `Secure`, `SameSite=Strict`, host-only cookie on the tenant host, never readable by script and
  never valid on the office host. Staff sessions are never valid on the tenant host.
- Codes: six digits, single use, short expiry (five minutes), a small attempt limit, stored hashed.
  Sends are capped per number, per network address and per day; every send and every verify is an
  audit row. SMS goes only to Israeli mobile numbers.
- Passkeys follow WebAuthn: registered after the first code sign-in, one or more per identity,
  removable by the tenant. A sign-in on a device with no passkey is a new-device sign-in and sends a
  notice to the number by the channel the tenant chose.
- A new device, a passkey added or removed, and "sign out everywhere" are audit rows.

### Access, per capability

Decided on every request, deny by default:

- **Tenancy data** (my flat, my papers, the tenancy's calls): only when the scope read returns an
  active Tenancy for the number **and** that Tenancy's Building is portal-enabled. A guarantor
  (`is_service_contact` false) never reaches it.
- **Ask the office**: every verified number. Resolved to a Party, the call is identified by number
  with no Tenancy attached; resolved to nobody, the call stays unidentified and is marked as from a
  verified number.
- A tenant's own calls list shows every ServiceCall whose requester is a Party the number resolves to
  and whose Tenancy is one the number reaches today, whatever its Source channel.
- An object the tenant may not see returns "not found", never "forbidden", so its existence is not
  revealed. Every tenant read of tenancy data is an audit row.

### Tenant status

Derived on read from the call's state, never stored:

| Call state | Tenant status |
|---|---|
| NEW, IDENTIFIED | התקבלה (received) |
| TRIAGED, RESPONSIBILITY SET | בטיפול (in progress) |
| WINDOWS COLLECTED, OFFERED | ממתין לתיאום (awaiting scheduling) |
| SCHEDULED | נקבע ביקור (visit scheduled) |
| Exit Answered / Forwarded / Duplicate / Cancelled | נענתה / הועברה / אוחדה / בוטלה |

Translated into English and Russian like any UI string. A state the table does not name maps to
בטיפול rather than leaking the internal name.

### Two clocks, the Reply target and Business days

- The existing Response goal thresholds in minutes apply to Emergency calls. Every other open call
  gets a handling band in business days, with its own thresholds at `/settings`. Both are office-only.
- A **Business day** is Sunday to Thursday, less the non-working dates an administrator keeps at
  `/settings`. Counting is a pure function of a start time, a now and that list.
- The **Reply target** X (business days) is a setting. A call counts as replied when a person's reply
  is sent on it; the automatic acknowledgement and the fixed emergency reply do not count.
- A "show to tenants" setting, off by default, puts "we reply within X business days" on the portal.
  The office sees the share of calls replied within X over a chosen period.

### Building switch and legal texts

- The switch is a boolean on Building, written only by a command that requires the new permission
  and writes an audit row. It is read on every tenant request.
- Legal texts (privacy notice, terms, entry-permission wording, optional opt-ins) are versioned rows
  per language with a placeholder flag. The switch command refuses while any current text in any
  portal language is a placeholder. Placeholder wording is written to best practice under Amendment
  13; Dona Dom's legal team replaces it.
- An acknowledgement is a row: identity, text, version, language, time. A new version re-asks.

### Pages

- Server-rendered, logical CSS properties, `dir` from the language. The client JavaScript allowed
  today (the copy control) is extended by exactly three things, each written into SPEC.md: the
  WebAuthn calls, the web app manifest, and a minimal service worker that caches no tenant data.
- **The portal design system** is the paint's: the `--tp-*` tokens and components in a stylesheet
  served on the tenant host, separate from the office shell's `/ui/tokens.css`, Heebo for all three
  languages, and Lucide icons through `kernel/ui/icons.ts`. Navigation is a bottom tab bar — בית ·
  קריאות · דיווח · הדירה · עוד — with report as the raised middle button. My papers are a section of
  the flat page, not a page of their own. The tenancy choice and the language choice are bottom
  sheets. The report is three steps and a confirmation.
- UI strings are rows keyed by language (`he`, `en`, `ru`); the starting language is the Party's
  `preferred_language` when it is one of the three, otherwise Hebrew; the tenant's choice is kept.
- Every form posts to a route that calls a module command; no route writes a table.

### Uploads

- Type allowlist (images, short video, PDF), size cap, server-chosen names, stored to a quarantine
  location, scanned for malware before an attachment is viewable by anyone. The scan applies to
  attachments from every channel, not only the portal.

### Third parties

The SMS gateway is added to SPEC.md's third-party table before it is first called, with what it
receives (a phone number and a code), where it processes, and the processor terms. Sender name: at
most 11 Latin characters.

## Testing Decisions

**A good test drives the portal the way a tenant does and asserts what a tenant or the office would
see** — the page, the status word, the call in the office's list — never a table, a helper or a
query's shape. Internal refactors must not break a test.

- **The main seam is the whole application over HTTP.** Tests build the app and inject requests,
  as the existing calls and channel route tests do. A new `asTenant(phone)` helper beside
  `asOperator` signs in through the real code flow with a fake code sender. This one seam covers
  sign-in, the first-visit notice, my flat, my papers, my calls, report, ask, follow-ups, office
  replies appearing in the portal, the building switch and the reply-target settings.
- **External edges stay injected:** the code sender (WhatsApp and SMS) is a fake that records what it
  was asked to send; the clock is the fixed clock; the sorter is injected, as in the door tests;
  the malware scanner is a fake that can return clean or infected.
- **Hard rules are policy cases, each red first:**
  1. A tenant changing an identifier in the address gets "not found" for another tenancy's flat,
     document or call.
  2. A tenant of a building switched off gets only "ask the office"; switching off takes effect on
     the next request.
  3. The building switch refuses while any legal text is a placeholder.
  4. A verified non-tenant, a guarantor and a past tenant see no tenancy data.
  5. Office-only clocks, bands, briefs and drafts never appear on a tenant page.
  6. A `PORTAL` call cannot be returned to the filtered list. (Ranked below the four access rules: it
     protects the tenant's view and the reply measure, not data.)
  7. A staff session is not valid on the tenant host, and a tenant session is not valid on the
     office host.
- **Small units only where HTTP cannot reach cheaply:** the business-day count and the Tenant status
  mapping, each a pure function with its own small test, like the response-goal test.
- **The native app adds no seam;** it will use the same routes.
- Prior art: the channel door test (intake against Postgres with the sorter injected), the channel and
  calls route tests (the office clicking through `buildApp`), the scope tests (the join), and the
  `tests/policy/` cases (isolation, call reply, call exit).

## Out of Scope

- AI answers in the portal (phase 2, its own ADR and golden set).
- The visit flow, choosing visit windows, ratings and building notices (phase 3).
- The native app and its PKCE sign-in (phase 4).
- Portal access with tenancy data for leads, past tenants and service providers — each a later
  decision.
- Onboarding a new tenant at move-in.
- Email notices of any kind.
- Payments, balances and invoices.
- Changing how WhatsApp, email or phone intake works, beyond the shared malware scan.

## Further Notes

**The director's, flagged, not decided here:**

- **A payment method on Meta's WhatsApp account.** Past 1,000 service messages a month per number,
  Meta charges, and without a payment method it stops delivering — sign-in codes included.
- **The SMS gateway and its spend.** InforU recommended (published processor annex, processing in
  Israel, audit rights, 24-hour incident notice; quote needed), Micropay runner-up. Sign the processor
  annex and choose the sender name.
- **How a tenant learns a reply arrived.** Phase 1 shows the reply in the portal. A notice by WhatsApp
  template or SMS costs money per message; a web push notice is free but needs the installed app.
  Until decided, no outbound notice is sent.
- **The legal texts** — Dona Dom's legal team approves the wording that replaces the placeholders.
- **Counsel on Amendment 13**, the database's data-security tier, and IS 5568 accessibility.
- **Two design proposals from the brief that no ticket builds:** topic chips on ask the office
  ("נושאים נפוצים. מוגדרים במשרד.", which needs an office-managed list), and a "ליומן" link that adds
  a visit to the tenant's calendar. Both are painted; each needs the director's yes before it becomes
  a ticket.
- **The value of X** and when to switch "show to tenants" on — the pilot's data, four weeks at ≥90%,
  is the agreed trigger.

**Where this was settled:** the grilling of 17–19 October 2026, recorded in ADR-0019 and the
CONTEXT.md terms Portal, Portal-enabled building, Portal identity, Tenant session, Tenant status,
Reply target and Business day.

## Comment — 2026-10-20

These tickets were written as #268–#286. Main had already used #268 and #269 for the lease reading, so the set moved up by two and is now #270–#288. The paint stays #271, closed. The next ticket to build is #272.
