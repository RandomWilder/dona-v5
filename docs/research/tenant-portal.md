# Tenant portal: how proven products do it, and what dona-v5 can support

Research note, 19 October 2026. **Status: research, not a decision.** Prepared for the director's
request for a tenant portal: tenants read their own data, ask questions and report issues, web first
with a native app to follow. The working premise under test is that **reporting through the portal
is one more Source channel into the existing ServiceCall flow**, not a parallel ticket system.

Conventions: as in [calls-agent-landscape.md](calls-agent-landscape.md). Every external claim carries
a source key in brackets, resolved in the Sources list. "(vendor)" marks a vendor's own unaudited
claim. "(secondary)" marks a claim found only in a law-firm note, press or a third-party page.
**"Unverified"** marks a claim that no primary source read for this note confirms. Repo claims cite
`file:line`. Nothing here is legal advice; §7 is a list of questions for counsel.

---

## Summary

1. **The premise holds, and the repo is already shaped for it.** One intake door, a Source channel
   set once at intake, a question that is itself a ServiceCall, and identification through the
   isolation join (`SPEC-channel.md:14-17`, `SPEC-calls.md:27-30`). A `PORTAL` channel is an adapter
   plus one enum value; no new state, no second queue.
2. **It reverses a recorded scope line.** `docs/ideas/dona-dom-platform.md:143` says "No tenant app
   and no provider portal. WhatsApp is the app." The portal needs an ADR that supersedes that line
   explicitly, not a quiet drift.
3. **Every vendor reviewed converges on the same form.** A category, a location in the unit, free
   text, photos, permission to enter, availability windows. Emergencies go to a phone number before
   or instead of the form [PM2][PM3][E1][FX1][H1].
4. **Tenants see fewer, plainer statuses than staff.** HappyCo maps Yardi's internal states onto a
   shorter resident list [H2]. dona-v5 already forbids showing the response goal to a tenant
   (`SPEC-calls.md:179-180`), so the portal needs its own tenant-facing status words.
5. **Sign-in: WhatsApp OTP is already the decided factor** (`SPEC-channel.md:171`, ADR-0013 §5).
   Meta's authentication templates support it, with codes that expire after 1–90 minutes [WA1].
   SMS is a NIST "restricted" authenticator [N1 §3.1.3.3]. Email SHALL NOT be used for out-of-band
   authentication [N1 §3.1.3.1]. Passkeys are the second factor worth adding [WD1].
6. **The session holds a Party, never a scope.** Re-resolving the isolation join on every request
   means access ends the day after the lease ends with no extra code. A guarantor never gets in,
   because `is_service_contact` is already the join's fourth hop (`SPEC-tenancy.md:123-137`).
7. **One phone reaches one Party** (`SPEC-parties.md:79-81`), so each adult in a household signs in
   with their own number. A shared family phone is one person.
8. **Q&A has its retrieval half built.** Tenant stance plus a Tenancy bound exists, and "there is no
   tenant-facing surface on this command yet" (`SPEC-evidence.md:1331-1345`). What a tenant may read
   beyond `TENANCY` links is still open (#125). A self-serving answer to a tenant is "the agent", and
   ADR-0017 left that undecided.
9. **Backend: the portal is a BFF, as the house style already is.** Server-rendered pages, an
   `HttpOnly` cookie session, and tokens never in the browser. RFC 10017 calls this pattern "strongly
   recommended for business applications" [IETF1]. A later native app uses OAuth with PKCE through
   an external user agent [RFC8252].
10. **Gap found: no malware scanning exists anywhere.** Inbound WhatsApp media and email attachments
    are stored as received (`SPEC-channel.md:146-157`, no scanner in `src/`). A portal upload makes
    this a front-door problem. Use the GCS quarantine pattern [GC1] and re-encode images [OW1].
11. **PWA is enough for phase one.** iOS has delivered web push since 16.4, but only to Home Screen
    web apps and only after a user gesture [WK1]. In iOS 26 every site added to the Home Screen opens
    as a web app by default [WK2]. The no-client-JS rule (`SPEC.md:134`) needs one more exception for
    a service worker if push is wanted.
12. **Cost changed under ADR-0013.** Since 1 Oct 2026 Meta charges for service messages beyond 1,000
    a month per number, and stops delivering them when no payment method is set [WA2]. ADR-0013
    still says replies inside the window are free. The portal moves conversation off paid WhatsApp
    messages, but OTP and notification templates cost money. Spending that is the director's call.
13. **Israel: three obligations need counsel before real tenants log in.** A privacy notice under
    Amendment 13 (in force 14 Aug 2025) [PC1]. The data-security tier, which may change if tenants
    count as "credential holders" (unverified) [LAW2]. Accessibility to IS 5568, which builds on
    WCAG 2.0, with statutory damages up to ₪50,000 [LAW1].
14. **Adoption evidence is thin and mostly vendor-made.** In Israel WhatsApp is the incumbent: 98% of
    Israelis use it (secondary) [GL1]. Design the portal to be reached from WhatsApp (a link in the
    acknowledgement), not to replace it.
15. **Recommended path:** ADR and paint first. Then an MVP (sign in, my lease papers, my calls,
    report or ask, on PORTAL). Then self-serve Q&A as a narrow agent. Then the visit flow's tenant
    side (windows, permission to enter, close-out). A native app comes last, as a Capacitor shell or
    Expo app over the same commands.

---

## 0. What the repo already decides for a portal

| Constraint | Where | What it means for the portal |
|---|---|---|
| Source channel is `WHATSAPP · EMAIL · PHONE · WALK_IN`, set once at intake and never changed | `CONTEXT.md:134`, `SPEC-calls.md:27-28`, `src/kernel/migrations/0045_service_call.sql:14` | `PORTAL` is a fifth value. That means a glossary edit, a spec edit and an append-only migration that widens the CHECK. "Set once" still holds. |
| Door-opened calls carry no staff account; PHONE/WALK_IN must | `SPEC-calls.md:23-25`, `0050_intake_door.sql:12` | PORTAL is door-opened, like EMAIL and WHATSAPP. The CHECK already allows it, because it only constrains PHONE/WALK_IN. |
| One door: de-duplicate, store, emergency check, thread, sort, identify | `SPEC-channel.md:14-43` | The portal adapter turns a form post into one normalised message. Everything after that is unchanged. |
| The door identifies when the isolation join returns exactly one party | `SPEC-calls.md:46-51`, `SPEC-channel.md:31-43` | The portal's verified phone *is* the sender address, so identification needs no new path. |
| Emergency check is deterministic, before any model; duty reply composed from rows | `SPEC.md:41-43`, `SPEC-calls.md:149-171` | The portal shows the duty number before the form, and shows the composed duty reply on screen when the terms match. Nothing new is sent. |
| Response goal is internal and shown to no tenant; a promise is an SLA and the director's | `SPEC-calls.md:177-180` | Tenant status words must never carry בזמן / קרוב ליעד / מעבר ליעד or any time promise. |
| Visit flow (RESPONSIBILITY SET → … → SCHEDULED) is not built; "the tenant-facing agent arrives later without changing anything in this module" | `SPEC-calls.md:412-417` | Windows and permission to enter can be *captured* on the call as text in phase 1. Driving WINDOWS COLLECTED → OFFERED waits for the visit flow. |
| Tenant OTP by WhatsApp authentication template only; no SMS provider | `SPEC-channel.md:171-172`, ADR-0013 §5 | Decided. Email as a fallback would be a new decision, and NIST argues against it (§4). |
| Acknowledgement/feedback only to an identified sender, never moves a call | `SPEC-channel.md:173-174` | Portal notifications obey the same rule. |
| Fail-closed: no personal data before server-side possession proof | `SPEC.md:189` | Nothing renders before the OTP verifies. |
| Every route declares a stance; default deny | `SPEC.md:261-266` | The hook knows `staff` only. A `tenant` stance is a new declared kind, and the process should refuse to start on a tenant route that has none. |
| Every scoped read of tenant data is logged | `SPEC.md:275`, `SPEC-scope.md:121-136` | Every portal page that reads a household writes an access line. |
| Third parties that see tenant text are named before they are called | `SPEC.md:279-299` | Web-push services (Apple, Google, Mozilla) and any native push provider are new rows. |
| Tenant stance and Tenancy bound exist; Building paper bound exists; no tenant surface yet | `SPEC-evidence.md:1314-1345`, `CONTEXT.md:93,101` | Q&A retrieval is built and policy-tested. Open: #125, on whether `UNIT`-linked paper is readable. |
| Unit record is office-only, never on a tenant path | `CONTEXT.md:99` | "My flat" needs its own tenant read model, not the Unit record. |
| Balance is Priority's; "No tenant-facing price or balance — ever" | `CONTEXT.md:160-162`, `docs/ideas/dona-dom-platform.md:136` | No balance or payments page. Vendors lead with payments (§1); dona-v5 deliberately does not. |
| Guarantor never receives service information (DB constraint) | `SPEC.md:48-49`, `SPEC-tenancy.md:123-137` | A guarantor cannot sign in, because the join returns no unit. |
| One contact value belongs to one Party at a time (exclusion constraint) | `SPEC-parties.md:72-90` | One login per number, so household members each need their own number. |
| `preferred_language` = `he · ar · ru · fr · en` | `SPEC-parties.md:37-38` | Amharic (`am`) is not in the vocabulary. Adding it is a vocabulary change. |
| UI: server-rendered HTML, RTL by logical properties, no client JS except the copy control; phone-first shell | `SPEC.md:124-136` | It fits a portal well. A PWA service worker would be a second, argued exception. |
| A "No tenant app and no provider portal" line | `docs/ideas/dona-dom-platform.md:143` | Must be superseded by an ADR. |
| The office retrieval model drafts; a person sends on the call's own channel | ADR-0017, `SPEC-calls.md:83-121` | A PORTAL call gets a brief and a draft (the #249 exclusion is WhatsApp-specific). "Send" on PORTAL is a new command that posts to the portal thread. |

---

## 1. Proven products and their flows

| Product | What the tenant sees | Filing a request | Emergency | Status and notifications | Into the staff queue |
|---|---|---|---|---|---|
| **Buildium Resident Center** | Payments and history, lease documents, announcements, two-way messages, renters insurance [B1] | Details and photos, by web or app [B1] | Not documented on the feature page | Status as the work order is assigned; books appointments "within the maintenance team's preset availability"; text and email updates [B1] | Request becomes a work order assigned to staff or a vendor [B1] |
| **Yardi RentCafe Resident** | Payments and autopay, lease view and renewal signing, bulletin board, amenities, packages; "Some features may not be available at your property" [Y1] | Photos and **voice memos**, with progress tracking [Y1] | Not documented in the listing | Progress tracking [Y1] | Yardi work order. Resident and Yardi statuses differ (row below) [H2] |
| **HappyCo Resident Portal** (over Yardi) | Service requests and messaging [H1] | App: request type, then location, then name, description and photos, then review, then T&Cs with an **optional consent to entry within 24 hours** [H1] | Not in this article | Technician-assignment notices, progress updates, direct messages to technicians [H1]. A 1–5 satisfaction text after an emergency job closes [H3] | "Sent to a site team for review" [H1]. Resident statuses are mapped from Yardi's [H2] |
| **AppFolio FolioSpace** (formerly Online Portal) | Pay rent and autopay, lease download, documents such as inspection reports [AF1] | "Submit and monitor the status of maintenance requests" [AF1]. Since 2012 a portal request has created a work order automatically (vendor, old) [AF2] | Not documented | Status monitoring [AF1]. Store reviews complain that an AI concierge chat replaced the form [AF1] (anecdotal) | Work order [AF2] |
| **Entrata ResidentPortal** | One-tap pay, autopay, amenities, inspections, biometric login [E1] | In-app request with in-app camera [E1] | "Contact Property" routes to the after-hours number when the office is closed [E1]. Property guides say emergencies go by phone (secondary) | Technician name and photo where the property uses Maintenance AI [E1] | Not documented |
| **Property Meld** (maintenance coordination; links from Buildium and others) | Its own resident portal | Location type, unit, area within the unit, category, description, pets present [PM1] | Emergency contact text shown *before* the form, behind a link [PM3]. An AI emergency picklist where some options say "call 911" and others ask triage questions; admin chooses whether an emergency creates a request at all or sends the resident to a phone number [PM2] | **Resident Presence Required** prompts the resident for appointment windows; **Permission to Enter** asks for consent [PM4]. 13 internal statuses, e.g. "Pending Resident Availability", "Vendor Could Not Complete" [PM1] | Lands as a Meld, assigned to vendor or in-house [PM1] |
| **Fixflo** (UK) | An agency-branded reporting site [FX1] | Category tiles, then an **issue tree** (item, then fault), then **guidance pop-ups or videos** with Continue, then mandatory make/model for some faults, then up to **10 photos, videos or audio files**, contact, address, "present for works?" (with a missed-appointment charge warning), a **vulnerable occupier** flag, T&Cs [FX1] | Not in this article. Vendor claims self-help removes ~20–25% of call-outs (vendor) [FX2] | Email confirmation summary [FX1] | Agency's Fixflo queue |
| **JLL Prism / Building Engines** (commercial) | Tenant requests and communications on web and app [JLL1] | Web or mobile [JLL1] | Not documented | "Automated tracking and status updates" [JLL1] | Work order |
| **Israeli equivalents** | Building-management apps exist, e.g. Darimpo (photo or text fault reports routed to maintenance), MyTower (secondary) [IL1] | — | — | — | **No primary documentation found** for an Israeli long-term-rental tenant portal. Unverified. |

**The common shape.** Payments lead every US product. dona-v5 excludes them (`CONTEXT.md:160`).
Below payments the portals agree: documents, a maintenance form, status, messages, and an emergency
phone number. Configurable per property: whether a request needs permission to enter, whether the
resident proposes windows, and whether an emergency creates a request or only shows a number [PM2][PM4].

---

## 2. Maintenance-request UX

- **Guided over free text, with free text kept.** Fixflo and HappyCo ask for a category, then a
  location, then text [FX1][H1]. Property Meld makes location-in-unit and category required [PM1].
  Store reviews of AppFolio's AI concierge complain that replacing the form left "no way to add
  detailed notes" [AF1] (anecdotal). **For dona-v5:** the tenant picks from the Category list
  (`SPEC-calls.md:173-175`). Like the sorter's verdict, that pick is a *proposal* stored on the call,
  and no command reads it to choose a transition (`SPEC-calls.md:15-21`). The office's TRIAGED
  command still sets the Category.
- **Emergency deflection comes first.** Every documented pattern shows the number before the form,
  or diverts the request to a phone [PM2][PM3][E1]. **For dona-v5:** show the duty contact (row-driven,
  `SPEC-calls.md:163-165`) at the top of the form. On submit, run the deterministic term match the
  door already runs. On a match, render the same composed duty sentence on the confirmation screen.
  The model never reads it (`SPEC.md:41-43`). No AI emergency screening: dona-v5 rejects that by rule,
  where Property Meld uses it [PM2].
- **Photos, video and audio.** Fixflo allows up to 10 files [FX1]. RentCafe accepts voice memos [Y1].
  The repo bounds one upload at 20 MB (`SPEC.md:274`). Recommend: photos and short video,
  server-side type sniffing, images re-encoded (§5).
- **Permission to enter and availability.** HappyCo offers an *optional* 24-hour entry consent [H1].
  Property Meld makes both permission and resident presence account-level settings [PM4]. Fixflo
  warns about a charge for a missed appointment [FX1]. **Consent wording and any charge are legal
  promises, so they are the director's.** In phase 1, capture both as stated facts on the call
  (consent yes/no; free-text windows). Keep them out of the state machine until the visit flow exists.
- **Duplicates and building-wide faults.** **No vendor documentation found** for suppressing repeat
  reports of a shared fault such as a broken elevator (unverified). dona-v5 already has the
  **Duplicate** exit and a **Predecessor** link (`CONTEXT.md:139-140`). Phase 3 can add a *building
  notice* that the office posts on an open call against a COMMON or TECHNICAL Space. The form shows it
  for that Building ("already reported"), and a tenant can still file. Never auto-merge: the Duplicate
  exit remains a person's command.
- **Satisfaction close-out.** HappyCo sends a 1–5 text after an emergency job closes [H3]. dona-v5:
  feedback "goes only to an identified sender, and never moves a call" (`SPEC-channel.md:173-174`).
  Ask in the portal on a closed call. A rating is data, never a transition.
- **Tenant statuses vs internal states.** HappyCo collapses Yardi's states for residents, e.g.
  "Assessment → Scheduled", "Parts Needed → On Hold", "Cancelled (Duplicate) → Cancelled" [H2].
  Proposed mapping for dona-v5 (wording placeholder; the director approves text the tenant reads):

  | Internal (`SPEC-calls.md:8-10`) | Tenant sees |
  |---|---|
  | NEW, IDENTIFIED | התקבלה |
  | TRIAGED, RESPONSIBILITY SET | בטיפול |
  | WINDOWS COLLECTED, OFFERED | ממתין לתיאום (phase 3) |
  | SCHEDULED | נקבע ביקור + the date (phase 3) |
  | CLOSED, Answered / Forwarded / Duplicate / Cancelled | נענתה / הועברה ל־<department> / אוחדה עם קריאה קודמת / בוטלה |
  | Returned to filtered | **Unresolved:** a tenant's own portal request should never become "noise" silently. Show it as בוטלה with the office's note, or forbid Return on PORTAL. Decide in the spec. |

  Never shown: the response-goal band, the "to review" mark, the sorter's verdict, the Category
  proposal versus the office's choice, the emergency source.

---

## 3. Q&A

- **What exists.** `searchPassages` with tenant stance accepts only a Tenancy bound: `TENANCY`-linked
  documents, identifiers masked, and "masking is not isolation" (`SPEC-evidence.md:1314-1345`,
  `CONTEXT.md:91-93`). Building paper is "the later tenant-facing bound for rules and regulations"
  (`CONTEXT.md:101`). Whether a tenant may read `UNIT`-linked paper for their own flat is #125, open.
- **A question is already a ServiceCall** closed by the Answered exit (`SPEC-calls.md:27-30`). The
  portal's "ask" is therefore the same form with no location or photos required.
- **Two ways to answer:**
  1. **Office answers (phase 1).** The call reaches IDENTIFIED, and the office retrieval model writes
     the Call brief and a Draft reply grounded in cited passages (ADR-0017, `SPEC-calls.md:53-97`).
     A person sends it to the portal thread. Nothing new on the model side.
  2. **Self-serve (phase 2).** The portal answers immediately from the Tenancy bound (plus Building
     paper once #125 decides), cites the page, and falls back to the frozen refusal. The tenant then
     sees **"send this to the office"**, which opens a ServiceCall carrying the question and the
     refused or partial answer. This is "the agent": a model replying to a tenant, which ADR-0017
     explicitly did not decide. It needs its own ADR, a golden set, and the read-only containment
     argued in [calls-agent-landscape.md](calls-agent-landscape.md) §§1, 5. A read-only answerer
     whose only action is "open a call" cannot be steered into doing anything (ADR-0017, "Why not
     the agent").
- **When to hand off.** First-party vendor guidance converges on escalating on failure thresholds and
  on sensitive or irreversible matters, with a clear path to a human
  ([calls-agent-landscape.md](calls-agent-landscape.md) TL;DR 3, 8). For dona-v5 the handoff is
  deterministic and needs no model judgement: it happens on a frozen refusal, on any emergency term
  match (the agent never sees it, `SPEC-channel.md:177`), on any question about money owed (Priority
  holds balances, `CONTEXT.md:160`), and whenever the tenant presses the button.

---

## 4. Identity and onboarding

| Option | Facts | Fit |
|---|---|---|
| **WhatsApp OTP (authentication template)** | Required template type for OTP codes. Fixed preset text. Copy-code, one-tap (Android) and zero-tap (Android) buttons; iOS keyboard suggestions. Expiry footer 1–90 minutes. Meta advises confirming the number is on WhatsApp first [WA1] | **Decided** (`SPEC-channel.md:171`). Reaches the same number the isolation join reads. Each send is a paid authentication message [WA2]; the Israel rate was not verified from Meta's card. |
| SMS OTP | NIST: "Use of the PSTN for out-of-band verification is restricted". A CSP must offer an unrestricted alternative, notify users of the risk, assess risk and plan migration [N1 §3.1.3.3, restricted-authenticator section] | Excluded by ADR-0013 §5. |
| Email magic link / code | "Email SHALL NOT be used for out-of-band authentication" [N1 §3.1.3.1] | Not recommended as a sign-in factor. |
| Passkeys (WebAuthn) | Conditional UI: `autocomplete="username webauthn"` plus `navigator.credentials.get({mediation:'conditional'})` [WD1]. NIST: syncable authenticators SHALL NOT be used at AAL3 [N1 §2.3.2]; AAL2 use unverified here | **Recommended second step.** Enrol after the first OTP sign-in, then skip OTP. This needs client JS on the sign-in page, so it is another argued exception. |

**Throttling and lifetimes.** NIST caps consecutive failures at no more than 100 [N1 §3.2.2]. An
out-of-band authentication "SHALL be considered invalid unless completed within 10 minutes"
[N1 §3.1.3.2]. Recommend: a 10-minute code, 5 attempts per code, sends capped per number and per IP
per hour (each send costs money), all counted from `audit_log` as the staff upload cap is
(`SPEC.md:270-274`). Give a **byte-identical response whether or not the number is a tenant**, the
same anti-enumeration stance as staff's `not_allowed` (`SPEC.md:251-259`). Send the code only when
the join resolves a party, and always say "if this number is registered, a code was sent".

**Invite flow.** Two doors, both fail-closed:
- The tenant types their number and the system sends a code. No invite is needed, because the
  register already holds the number.
- The office sends a WhatsApp utility template carrying a portal link, either at move-in or as the
  acknowledgement on a WhatsApp call. That is a paid template [WA2] and the director's spend.

**Household, guarantors, past tenants, movers.**
- **Who may enter.** The join requires `is_service_contact` (`SPEC-tenancy.md:137`). PRIMARY_TENANT
  and CO_TENANT are presumably service contacts. **OCCUPANT** (an adult child, say) is a director
  question. A guarantor never enters (DB constraint).
- **One number, one person** (`SPEC-parties.md:79`). A household sharing a phone is one portal person.
- **Past tenants.** The join's `Tenancy (active today)` hop shuts them out the day after `end_date`
  or `actual_move_out`. That needs no code, provided the **session stores the party id only and
  re-resolves the scope on every request** (the scope is a view, `CONTEXT.md:79`). Whether a past
  tenant may read their own lease after move-out (for a deposit dispute, say) is the director's
  call. The default is no.
- **Moving flats.** The join simply returns the new unit. A party on two units today is "one match"
  for identification (`SPEC-calls.md:48-49`), so the portal must ask which flat the report concerns.
- **Number recycling and takeover.** A tenant who changes number must have the old `party_contact`
  closed (`valid_to`), or the next holder of that number inherits the portal. That is the same hazard
  the exclusion constraint guards (`SPEC-parties.md:72-90`). Recommend: a WhatsApp notice to the
  number on each new-device sign-in, and passkeys to reduce reliance on the number. NIST also lists
  redirection of a victim's phone by the carrier as a PSTN threat [N1].

---

## 5. Backend logic

**The portal as a channel adapter.** A form post becomes the normalised incoming message the door
already takes (`SPEC-channel.md:14-17`):
- Source channel `PORTAL`.
- External message id: a client-generated idempotency key, a hidden UUID in the form, so a
  double-submit or retry hits the door's existing de-duplication (`SPEC-channel.md:19-21`).
- Thread id: the portal conversation.
- Sender address: the session's verified phone.
- Body, attachments, received time from the injected clock.

The door then runs unchanged: store, emergency check, thread, sort, identify through the join. An
authenticated sender always resolves, so the call reaches IDENTIFIED with the timeline naming the
address match. The sorter still runs. A tenant's structured Category is stored beside its verdict as
another proposal. Idempotency precedent: Stripe stores the first response for a key, rejects
mismatched parameters, and prunes keys after 24 hours [ST1]. The IETF `Idempotency-Key` header draft
has expired and is not a standard [IETF2] (unverified as to newer revisions).

**Attachments.** Today the bytes stay on the Message, and filing is the office's act
(`SPEC-channel.md:146-157`). Add a scan step on *every* channel, not just PORTAL:
- Upload lands in an unscanned bucket.
- An Eventarc-triggered Cloud Run job runs ClamAV.
- The file moves to clean or quarantine, and the result is logged [GC1].
- OWASP adds: allowlisted extensions, magic-byte checks rather than trusting `Content-Type`, server-
  generated names, size limits, storage off the web root, and images decoded and re-encoded to strip
  metadata [OW1].
- Meta warns the same about WhatsApp Flows media: it "does not guarantee" that customer-shared files
  are non-malicious [WA3].

**Tenant-scoped authorization.**
- Add a route stance `config: { tenant: <capability> }` beside `staff`. The `onRoute` hook refuses
  any route that declares neither (`SPEC.md:261-266`).
- Every object id in a tenant URL (call, document, page) is checked against the scope resolved this
  request. OWASP API1:2023 asks for "an authorization check in every function" that takes a client
  id, plus random ids and tests for that check [OW2].
- The check belongs in `src/scope/` or behind its contract, because the isolation join is written
  only there (`AGENTS.md`, `SPEC-scope.md:5-18`).
- Each read writes an access line (`SPEC.md:275`).
- Add a policy case, red first: a tenant session asks for another household's call id and document
  id and is refused.

**Notification fan-out.**

| Channel | Facts | Cost and risk |
|---|---|---|
| In-portal (the call thread) | Always on | Free |
| WhatsApp utility template | Needed outside the 24-hour window. Service messages beyond 1,000/month per number are charged from 1 Oct 2026, and Meta stops delivering them without a payment method [WA2] | Paid; director |
| Web push | iOS 16.4+ Home Screen web apps only, permission requested on a user tap, standards Push/Notifications/Service Worker, badging API [WK1]; Android Chrome | Service-worker JS (an exception to `SPEC.md:134`). New processors: browser push services, which must be named in `SPEC.md:279` (unverified which services see what metadata) |
| Email | Graph `Mail.Send` is today scoped to "one Graph reply on an inbound message" (`SPEC-channel.md:96-98`) | A *new* outbound mail is a new use of that permission. Director asks Dona Dom's M365 admin |

Store channel preference per Party, defaulting to in-portal plus WhatsApp. Every outbound notice goes
only to an identified sender and never moves a call (`SPEC-channel.md:173`).

**API shape: web now, native later.**
- **Now: BFF, server-rendered.** This is what the repo already is. RFC 10017 (Aug 2026, BCP 212)
  ranks the backend-for-frontend first, with "no tokens available to extract from the browser"
  [IETF1].
- **Decide now so native is cheap:**
  1. Put every portal action in a module contract command (calls, channel, scope), so the HTML
     routes and a later JSON API are two thin adapters.
  2. Serve the portal from its own origin (e.g. a tenant subdomain), so tenant and staff cookies
     never share a jar.
  3. Version a JSON surface under `/api/tenant/v1` when the app starts, not before.
  4. Later, the native app signs in through an external user agent with PKCE and a claimed `https`
     redirect [RFC8252 §§5-7], and keeps its refresh token in the platform keystore.

---

## 6. Web now, mobile later

| Option | What it buys | What it costs here |
|---|---|---|
| **PWA only** | Install from Safari or Chrome, with no store. iOS web push since 16.4 for Home Screen apps [WK1]. iOS 26 opens Home Screen sites as web apps by default [WK2]. Chrome's install prompt needs HTTPS, a manifest (name, 192/512 icons, `start_url`) and some engagement [WD2]. Photos via a file input work in server-rendered HTML (camera capture attribute behaviour unverified here) | The least new code. Push and offline need a service worker (JS) |
| **Capacitor wrapper** | Drops into an existing web project. The web app runs in a native WebView, with plugins for camera and push [CAP1] | Store accounts, review and a second release train. Keeps the server-rendered pages |
| **Expo / React Native** | One codebase for iOS, Android and web via Expo Router [EX1] | A rewrite of the UI layer in React, a new runtime dependency and a client-heavy model the repo has avoided |

**Recommendation:** go PWA-first on the existing server-rendered shell (phone-first since 5.2d,
`SPEC.md:129-136`). Add a Capacitor shell only if the director wants a store presence or reliable iOS
push without the Home Screen step. Expo makes sense only if native-grade UX becomes a requirement.

---

## 7. Israel-specific

- **Privacy Protection Law, Amendment 13**, in force 14 Aug 2025: a GDPR-direction reform, PPA
  enforcement with financial sanctions, and a DPO duty for some bodies, with DPO enforcement deferred
  to 31 Oct 2025 [PC1][DPA1] (secondary). For the portal:
  - The notice to data subjects drafted at `docs/data-subject-notice.draft.md` (F6) must cover portal
    accounts, sign-in logs, push tokens and uploads.
  - Every new processor joins the third-party table first (`SPEC.md:279`).
  - Whether Dona Dom needs a DPO is counsel's question.
- **Data Security Regulations 2017** (secondary summary) [LAW2]:
  - Tiers run basic, intermediate, high.
  - Intermediate requires automated access logs kept ≥2 years and an audit every 24 months.
  - High is triggered by ≥100,000 data subjects or >100 credential holders where data is made
    available to others; it brings risk assessment and penetration tests every 18 months.
  - **Open for counsel: whether ~3,000 tenant logins count as "credential holders" and move the
    database to high.** Unverified.
- **Accessibility:**
  - The 2013 service-accessibility regulations apply to "every service offered to the general
    public" and require IS 5568, built on WCAG 2.0 [LAW1].
  - Breach is a civil wrong with statutory damages up to ₪50,000, and class actions are possible
    [LAW1].
  - Level AA and the WCAG version (2.0 vs 2.1) differ across secondary sources (unverified).
  - **Target WCAG 2.1 AA**, a superset of 2.0. The accessibility-statement duty is unverified;
    counsel should confirm.
  - Whether a portal for own tenants is a "service to the public" is counsel's call; assume yes.
- **Repair duties under the Rental and Loan Law (2017 amendment)** set landlord repair deadlines.
  The exact days were **not verified** from the statute text here [SH1]. Any time the portal shows a
  tenant is a promise that law will be read against. That is the director's (`SPEC-calls.md:180`).
- **Languages and RTL.**
  - Arabs are 21.1% of Israel's population, end-2025 CBS figure via press (secondary) [CBS1].
  - Hebrew and Arabic are both RTL, and the token layer already uses logical properties
    (`SPEC.md:125-126`).
  - Russian, English and Amharic are LTR inside an RTL shell, so each page needs `lang` and `dir`
    per language.
  - Amharic is missing from `preferred_language` (`SPEC-parties.md:37-38`).
  - Legal texts (consent, privacy notice, T&Cs) need human translation; the sorter's translation is
    display-only (`SPEC-channel.md:66-68`).

---

## 8. Adoption

- **Primary data is scarce, and most of it comes from vendors.**
  - NMHC/Kingsley 2020 reports ~64% of renters want to file maintenance by app. This comes via a
    Yardi blog that could not be fetched (vendor; unverified) [Y2].
  - A 2012 AppFolio survey found 34% call the office (vendor, old; unverified) [AF2].
  - Milton Keynes Council's 2024 repairs consultation (148 responses) found email the most preferred
    channel, mixed views on an app, and concluded "a one-size-fits-all approach may not be the most"
    effective [MK1].
- **In Israel the incumbent is WhatsApp.** 98% of Israelis use it and 95% of them daily (IIA data
  via Globes, secondary) [GL1]. The original platform brief built on that (`docs/ideas/dona-dom-platform.md:143`).
- **What drives uptake:**
  - Things only the portal has: the lease, status, a thread history.
  - No password.
  - An entry point from the channel tenants already use (a link in the WhatsApp acknowledgement).
  - The office routing tenants there, e.g. by sending photos-needed requests as portal links.
- **What kills it:** a form that blocks detail [AF1], and notifications that don't arrive [AF1]
  (anecdotal). **Measure, don't assume:** count the share of new calls with `source_channel =
  'PORTAL'` per Building per month. That is one query on existing columns.

---

## Recommended plan for dona-v5

Each phase lists the specs it edits first (spec before code, `CLAUDE.md`). ⚑ marks what is the
director's.

### Phase 0: decide and paint

- **ADR-0019 "The tenant portal is a Source channel"**, superseding
  `docs/ideas/dona-dom-platform.md:143` for tenants only.
- **New vocabulary in `CONTEXT.md`:**
  - **Portal** (פורטל דיירים).
  - **PORTAL** as a Source channel value. This **amends "set once at intake"** only by widening the
    set; the rule itself stands.
  - **Tenant session** (a Party, never a scope).
  - **Tenant status** (the words a tenant sees, mapped from state).
  - Later, **Building notice**.
- `mockups/tenant-portal.html` at `/dev/mockups/tenant-portal`, clicked on `:3000` before any wiring.
- ⚑ Approve the portal at all, the pilot building, and the tenant-facing wording.

### Phase 1: MVP portal (web, server-rendered)

**Specs:** `SPEC-calls.md` (enum, tenant status, PORTAL send, Return-on-PORTAL rule),
`SPEC-channel.md` (PORTAL adapter, attachment scan), `SPEC-scope.md` (session → join per request,
object checks), `SPEC.md` (tenant route stance, third-party rows, UI exception if any),
`SPEC-parties.md` (OTP marks `verified_at`). **Migration:** widen `source_channel` CHECK.

**Screens:**
- Sign in by WhatsApp OTP.
- My flat: address, lease dates, assigned bay and storage, from tenancy typed columns, not the Unit
  record.
- My papers: Tenancy bound, `TENANCY` links only.
- My calls: requester = me, scoped to my current tenancies.
- Report or ask: Category, location in unit, text, photos, entry consent and windows as text. Duty
  number up top, duty reply on an emergency match.
- Call thread, with the office's reply posted on PORTAL.

**Policy cases (red first):** cross-household call and document ids are refused; a guarantor's number
gets the generic reply; the day after `end_date` the session reads nothing.

⚑ Decisions in this phase:
- OTP and notification template spend, and a payment method on the WABA given Meta's Oct 2026
  service-message charges [WA2]. ADR-0013's "free inside the window" needs a line.
- The OCCUPANT role's access.
- Consent wording for entry.
- Privacy notice and terms published.
- The accessibility statement.
- Counsel on the data-security tier.
- New outbound email under `Mail.Send`.

### Phase 2: self-serve Q&A

**Specs:** `SPEC-evidence.md` (tenant turn, Building paper for tenants once #125 closes),
`SPEC-channel.md` §Later (the agent's first narrow rules), plus an ADR for tenant-facing answers.

The answer cites or refuses. "Send to office" opens a PORTAL ServiceCall. A golden set over tenant
questions is a required gate (`AGENTS.md`).

⚑ What a tenant may read (#125), whether AI answers tenants at all, and the disclosure that they are
talking to AI ([calls-agent-landscape.md](calls-agent-landscape.md) TL;DR 9).

### Phase 3: visit flow and close-out

**Specs:** `SPEC-calls.md` "Not yet" becomes settled (`:412-417`).

The portal is the tenant side of WINDOWS COLLECTED → OFFERED. The tenant proposes windows, accepts an
offer, then rates a closed call (data only). Building notices against COMMON/TECHNICAL Spaces curb
duplicate reports.

⚑ Any visible time commitment (an SLA, `SPEC-calls.md:180`) and missed-appointment terms.

### Phase 4: native app

A Capacitor shell over the PWA, or Expo if native UX is required. OAuth plus PKCE via an external
user agent [RFC8252]. APNs and FCM are named as processors (`SPEC.md:279`).

⚑ Store accounts under Dona Dom's entity, as with Meta (ADR-0013 §2).

**What stays out:** balance, payments and price (`CONTEXT.md:160`,
`docs/ideas/dona-dom-platform.md:136`); AI emergency screening (`SPEC.md:41`); any model choosing a
transition (`SPEC.md:35`).

---

## Open questions for the director

1. Does the portal supersede "No tenant app" for tenants, and is the pilot the Ramle building or an
   existing one?
2. Who enters: primary and co-tenants only, or OCCUPANT adults too? Does a past tenant keep read
   access to their own lease after move-out, and for how long?
3. Budget for WhatsApp authentication and utility templates, now that service messages are also
   charged past 1,000/month (from 1 Oct 2026)?
4. Will Dona Dom show tenants any time expectation? (That is an SLA.)
5. Entry-consent and missed-appointment wording: who signs it off legally?
6. Languages at launch: Hebrew and Arabic only, or also Russian, English, Amharic (Amharic needs a
   vocabulary change)? Who translates the legal texts?
7. Counsel: Amendment 13 notice, the data-security tier (are tenant logins "credential holders"?),
   accessibility statement and certification.
8. #125: may a tenant read `UNIT`-linked paper (a handover protocol) for their own flat?
9. Is a self-serving AI answer to tenants wanted at all, or does the office always answer?
10. May Dona Dom's M365 admin widen `Mail.Send` use to outbound notices, or is email off?

---

## Sources

Fetched 2026-10-19 unless stated. Zendesk articles were read through each help centre's public
article API.

- [AF1] Online Portal by AppFolio / FolioSpace, App Store listing — https://apps.apple.com/us/app/-/id1376350358
- [AF2] AppFolio blog, "Tenant online maintenance requests are here", 11 May 2012 (vendor, old) — https://www.appfolio.com/blog/tenant-online-maintenance-requests-are-here/
- [B1] Buildium, Resident Center feature page — https://www.buildium.com/features/resident-center/
- [CAP1] Capacitor documentation — https://capacitorjs.com/docs
- [CBS1] JNS, "Israel's population hits 10,178,000" (reporting CBS end-2025) (secondary) — https://www.jns.org/israels-population-hits-10178000/
- [DPA1] Digital Policy Alert, Amendment 13 entered into force (secondary) — https://digitalpolicyalert.org/event/32795-privacy-protection-bill-amendment-no-13-formerly-no-14-entered-into-force
- [E1] Entrata ResidentPortal, App Store listing — https://apps.apple.com/app/id443831139
- [EX1] Expo Router introduction — https://docs.expo.dev/router/introduction/
- [FX1] Fixflo help, "How does an occupier report an issue?" — https://help.fixflo.com/support/solutions/articles/61000256290-how-does-an-occupier-report-an-issue-
- [FX2] Fixflo pricing (lettings) and blog, call-out reduction claims (vendor) — https://www.fixflo.com/pricing/lettings ; https://www.fixflo.com/blog/rising-repairs-this-winter-could-video-maintenance-be-the-answer
- [GC1] Google Cloud Architecture Center, "Automate malware scanning for files uploaded to Cloud Storage" — https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage
- [GL1] Globes, "Globes ranks WhatsApp as Israel's top 2024 brand" (IIA data) (secondary) — https://en.globes.co.il/en/article-1001484162
- [H1] HappyCo support, "Submitting a Service Request" (updated 2024-11-21) — https://support.happy.co/hc/en-us/articles/17681335970452-Submitting-a-Service-Request
- [H2] HappyCo support, "Yardi/Resident Portal Maintenance Statuses" (2023-08-02) — https://support.happy.co/hc/en-us/articles/16882055802260-Yardi-Resident-Portal-Maintenance-Statuses
- [H3] HappyCo support, "Call Complete Community Settings…" (2026-08-28) — https://support.happy.co/hc/en-us/articles/52924718576148
- [IETF1] RFC 10017 / draft-ietf-oauth-browser-based-apps, "OAuth 2.0 for Browser-Based Applications" (BCP 212, Aug 2026) — https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/
- [IETF2] draft-ietf-httpapi-idempotency-key-header (expired -07) — https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- [IL1] Startupim, Darimpo profile; App Store, MyTower (secondary) — https://startupim.com/company/darimpo ; https://apps.apple.com/us/app/id1097081580
- [JLL1] JLL, Prism product page — https://www.jll.com/en-us/products/prism.html
- [LAW1] Haim Ravia (law.co.il), "New website accessibility regulations enacted", 13 Nov 2013 (secondary) — https://www.law.co.il/en/news/2013/11/13/New-website-accessibility-regulations-enacted/
- [LAW2] Haim Ravia (law.co.il), "Dramatic overhaul of Israeli data security regulations", 26 Mar 2017 (secondary) — https://www.law.co.il/en/articles/2017/03/26/dramatic-overhaul-israeli-data-security-regulations/
- [MK1] Milton Keynes City Council, Repairs and Maintenance Consultation analysis, Apr 2024 — https://www.milton-keynes.gov.uk/sites/default/files/2024-04/Repairs%20and%20Maintenance%20Consultation%20-%20consultation%20analysis%20-%20April%202024.pdf
- [N1] NIST SP 800-63B-4, Digital Identity Guidelines: Authentication (final, 2025) — https://pages.nist.gov/800-63-4/sp800-63b.html
- [OW1] OWASP File Upload Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- [OW2] OWASP API Security Top 10 2023, API1 Broken Object Level Authorization — https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization
- [PC1] Pearl Cohen, "Israel: significant amendment to the privacy law takes effect" (secondary) — https://www.pearlcohen.com/israel-significant-amendment-to-the-privacy-law-takes-effect/
- [PM1] Property Meld help, "How to Create, Manage, and Cancel Meld Requests" (2026-02-02) — https://help.propertymeld.com/hc/en-us/articles/45827451221395
- [PM2] Property Meld help, "Using Emergency Screening with MAX" (2025-10-25) — https://help.propertymeld.com/hc/en-us/articles/45926206712595
- [PM3] Property Meld help, "How to Set Emergency Contact Information" (2025-11-02) — https://help.propertymeld.com/hc/en-us/articles/45926244755475
- [PM4] Property Meld help, "Global Resident Presence Required Settings" (2026-03-23) — https://help.propertymeld.com/hc/en-us/articles/45926198768147
- [PM5] Property Meld help, "How to Invite and/or Create a Resident" (2026-02-25): invite by email, register with a password — https://help.propertymeld.com/hc/en-us/articles/45926003798035
- [RFC8252] RFC 8252, OAuth 2.0 for Native Apps — https://www.rfc-editor.org/rfc/rfc8252.html
- [SH1] Shibolet, on the 2017 Fair Rental amendment (secondary; deadlines not verified) — https://www.shibolet.com/?p=3862
- [ST1] Stripe API, Idempotent requests — https://docs.stripe.com/api/idempotent_requests
- [WA1] Meta, WhatsApp authentication templates — https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates/
- [WA2] Meta, WhatsApp Business Platform pricing (reflects 1 Oct 2026 updates) — https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- [WA3] Meta, WhatsApp Flows media upload components (read through the search index, page not fetched) — https://developers.facebook.com/docs/whatsapp/flows/reference/media_upload
- [WD1] web.dev, "Sign in with a passkey through form autofill" — https://web.dev/articles/passkey-form-autofill
- [WD2] web.dev, "What does it take to be installable?" — https://web.dev/articles/install-criteria
- [WK1] WebKit blog, "Web Push for Web Apps on iOS and iPadOS" — https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- [WK2] WebKit blog, "News from WWDC25: web technology coming this fall in Safari 26 beta" — https://webkit.org/blog/16993/
- [Y1] RentCafe Resident, App Store listing — https://apps.apple.com/us/app/rentcafe-resident/id541403633
- [Y2] Yardi blog, "The Mobile Advantage" (citing NMHC/Kingsley 2020; page returned 403, figure from search index only — unverified) — https://www.yardi.com/blog/?p=23456
