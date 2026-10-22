# SMS gateway for tenant sign-in: Twilio against Israeli providers

Research note, 19 October 2026. **Status: research, not a decision.** Prepared for the director's
question: the tenant portal signs in by WhatsApp one-time code, with an **SMS one-time code as the
fallback** for a tenant without WhatsApp or who prefers SMS. After the first sign-in a passkey is
enrolled, so SMS volume is low: a few hundred to about 2,000 OTP messages a month at about 3,000
tenants, and far fewer in the pilot. SMS status notices may come later. Twilio was the assumed
vendor. This note compares it with Israeli gateways.

Conventions: as in [tenant-portal.md](tenant-portal.md). Every external claim carries a source key in
brackets, resolved in the Sources list. "(vendor)" marks a vendor's own unaudited claim.
"(secondary)" marks a claim found only in a law-firm note, press or a third-party page.
**"Unverified"** marks a claim that no primary source read for this note confirms. Repo claims cite
`file:line`. Prices exclude VAT unless stated. Where NIS and USD are compared, the rate is taken as
**₪3.7 = $1**, an assumption that was not checked. Nothing here is legal advice.

---

## Summary

1. **This reverses a recorded decision.** ADR-0013 §5 says "No SMS provider"
   (`docs/decisions/ADR-0013-whatsapp-arrives-by-coexistence.md:23`). `SPEC-channel.md:171-172` says
   "There is no SMS fallback and no SMS provider". The reasoning recorded is that a tenant writing on
   WhatsApp is reachable on WhatsApp (ADR-0013:48-50). The portal changes that premise, because a
   portal tenant may not use WhatsApp at all. An SMS fallback needs an ADR that supersedes §5, then a
   SPEC edit, then a row in the third-party table (`SPEC.md:279-291`), in that order.
2. **Twilio costs about 45× more than the Israeli gateways for the same message.** Twilio lists Israel
   outbound at **$0.2575 per segment** [TW1]. That is about ₪0.95. 019 sells OTP SMS at
   **1,000 for ₪20** [019-3], which is ₪0.02 each. Micropay lists **2 agorot per message** for
   packages up to 5,000 [MP1]. At 2,000 OTP a month, Twilio costs about **$515 (≈₪1,900)** and an
   Israeli gateway costs about **₪40**.
3. **Hebrew halves the room.** One Hebrew character forces the whole message into UCS-2, which fits
   **70 characters per single SMS**. Israeli vendors bill in that unit [IU3][019-3]. Micropay is the
   exception: it prices a unit as up to 134 Hebrew characters, which is two concatenated parts
   [MP1]. Twilio bills per segment [TW1]. So the OTP text must stay at or under 70 characters, and
   this includes any WebOTP line.
4. **The Israeli gateways match Twilio on the features sign-in needs.** These are an HTTPS JSON
   send, a delivery-receipt push, a branded alphanumeric sender name and a hosted OTP API. **InforU**
   and **Micropay** also fall back to a **voice call for kosher phones**, which cannot receive SMS
   [IU2][IU1][MP2]. Twilio offers no Israel-specific equivalent in the pages read.
5. **The privacy posture favours the Israeli gateways.**
   - **InforU** publishes a processor annex under the Privacy Protection Law. It says ISO 27001 is
     held, the service and storage run in Israel, and a serious security incident is reported within
     24 working hours. It also gives the customer audit rights [IU4] (vendor).
   - **Micropay** says it holds ISO 27001, with the last audit in 07/2026. It says data is stored in
     Israel and that 2FA is available on sign-in [MP4] (vendor).
   - **Twilio's** DPA is incorporated into its terms and names Israel's Protection of Privacy Law,
     but it governs transfers to the US [TW5].
6. **Regulation: §30A does not reach an OTP.** The spam law's "advertising" means a commercially
   distributed message meant to encourage a purchase or spending, or a donation or propaganda message
   to the general public [LAW-30A]. A sign-in code is neither. What does apply to A2P SMS is the
   Ministry of Communications' sender-identity regime:
   - a **numeric** sender ID must be verified once as belonging to the sender (since 3 Jan 2021)
     [IU5][MP3] (vendor and secondary);
   - bulk senders must be strongly identified, through amendments to the carriers' licences (from Oct
     2022) [LAW-MOC] (secondary).
   An **alphanumeric** sender name needs no extra verification under the 2021 rule [IU5] (vendor).
   Twilio's Israel guidelines nonetheless list domestic pre-registration as required by the operator,
   with about one week to provision [TW2].
7. **SMS pumping is a small risk here, because of how the portal already works.** The portal sends a
   code only when the isolation join resolves a registered party (`docs/research/tenant-portal.md:216-217`),
   so an attacker cannot choose the destination. The usual guards still apply:
   - per-number and per-IP send caps;
   - Israeli mobile numbers only (`05x`);
   - international sending switched off at the vendor.
8. **Recommendation: InforU primary, Micropay runner-up** (§8). Spending money and signing the
   processor annex are the director's decisions (§9).

---

## 1. What the system requires of the provider

From the repo, not the vendors:

- **Named before called.** "Third parties that see tenant text are named here before they are
  called" (`SPEC.md:279-281`). The provider sees the tenant's phone number, the message text (the
  code), the send time and the delivery status. That is personal data, though not tenant-authored
  text. It still goes in the table, because the table is "exhaustive by intent" (`SPEC.md:281`).
- **Secrets.** The API credential lives in Secret Manager via `infra/set-secret.sh`, never in argv or
  a log (`SPEC.md:277-278`). A vendor that takes the token **in the URL query string** leaks it into
  any request log. Use a vendor's header or JSON-body form (§3).
- **The code is ours.** `tenant-portal.md:211-217` already specifies the code itself:
  - a 10-minute lifetime and 5 attempts;
  - send caps counted from `audit_log`;
  - a byte-identical response whether or not the number is registered.
  Recommended: **generate and verify the code in dona-v5, and use the vendor only as a transport.**
  A vendor's hosted OTP then serves only as a fallback design. This keeps the throttle, the audit
  record and the WhatsApp/SMS choice in one place. It also leaves the vendor swappable, because the
  adapter is "send this text to this number".
- **One adapter, one enum value.** Delivery receipts arrive as an inbound webhook. They need the same
  authenticity treatment as the Meta webhook. No Israeli vendor documents a signed DLR (§3), so the
  callback URL must carry an unguessable secret path segment, and receipts are advisory only. A
  receipt never decides sign-in. Only the code does.

## 2. Message length and cost arithmetic

- **Encoding.** One Hebrew character puts the whole message in UCS-2: **70 characters** in one SMS,
  and 67 per part once concatenated. Israeli vendors describe "up to 70 Hebrew characters = one unit"
  [IU3] and bill the 019 OTP at a 70-character message [019-3]. Micropay's unit of 134 Hebrew
  characters (2 × 67) is a pricing choice, not an encoding one [MP1].
- **A draft code text** of about 60 characters, which fits one unit:
  `קוד הכניסה לדונה דום: 482913. בתוקף 10 דק'. לא ביקשת? התעלם.`
- **WebOTP / Android auto-fill.** The WebOTP last line (`@host #code`) is ASCII, but the message is
  already UCS-2, so those characters count against the 70. Adding it will probably push the message
  to two units. 019 offers a `tag` field for Google's automatic SMS verification [019-2]. Micropay
  says it supports WebOTP [MP2]. **Decide during build:** either drop the courtesy sentence to stay at
  one unit with WebOTP, or skip WebOTP. The passkey page already needs client JS, so WebOTP adds
  little new to that exception.
- **Monthly cost at the stated volumes**, single-unit messages:

| Volume / month | Twilio @ $0.2575 [TW1] | Twilio Verify adds $0.05 per success [TW3] | 019 OTP @ ₪0.02 [019-3] | Micropay @ ₪0.02 [MP1] | InforU |
|---|---|---|---|---|---|
| 200 (pilot-ish) | $52 ≈ ₪190 | +$10 | ₪4 | ₪4 (min. package ₪100 for 5,000) | quote only |
| 2,000 | $515 ≈ ₪1,905 | +$100 | ₪40 | ₪40 | quote only |
| 2,000 at 2 units each | $1,030 ≈ ₪3,810 | +$100 | ₪80 | ₪40 (≤134 chars is one unit) | quote only |

At these volumes **the Israeli price is a rounding error, and the decision rests on security, DPA and
reliability.** Twilio's cost is not a rounding error: about ₪23,000 a year at 2,000 messages a month.

## 3. Providers

### 3.1 Twilio (baseline)

- **API.** Programmable Messaging plus Verify (hosted OTP). The REST API is mature, and there is an
  official Node SDK (not re-read for this note; well known).
- **Price, Israel** [TW1]:
  - outbound $0.2575 per segment, for both a mobile number and an alphanumeric sender;
  - $0.001 for each failed message;
  - "SMS pumping protection" $0.025 per message;
  - a local mobile number $15 a month;
  - discounts by contacting sales.
  Verify charges $0.05 per successful verification plus channel fees. SMS attempts are billed even
  when the user never completes [TW3]. Verify's Israel channel fee was not read (unverified).
- **Sender ID, Israel** [TW2]:
  - Alphanumeric: **domestic pre-registration "Required"** by the operator, supported by Twilio,
    about 1 week to provision. Dynamic alphanumeric is also supported. Both keep the sender ID and
    support UCS-2.
  - International pre-registration is not supported.
  - Short codes: no.
  - A fixed-line number used as a sender ID "will likely be rejected".
  - Banned content: gambling, politics, drugs and adult material.
- **Security and privacy.**
  - The DPA "forms part of the agreement", so it is accepted on sign-up and not signed separately.
    It lists Israel's Protection of Privacy Law among applicable laws. Transfers go to "Twilio in the
    United States of America" [TW5].
  - Regions: US1, IE1 and AU1. Not every product is available outside US1 [TW7]. Whether Messaging
    can be pinned to IE1 is unverified.
  - The Trust Center mentions ISO/IEC 2700x certification [TW6].
- **Reliability.** A public status page, status.twilio.com [TW6]. Twilio reaches Israeli carriers
  through its own routes. Whether it connects directly to each Israeli carrier is unverified.
- **Fraud.** Geo permissions per country, and SMS Pumping Protection for Messaging. Verify has Fraud
  Guard and its own geo permissions. Twilio advises disabling every country you do not send to [TW4].

### 3.2 InforU (InforUMobile, Shamir Systems)

- **API** [IU1]:
  - JSON over HTTPS at `capi.inforu.co.il/api/v2/...`, with **HTTP Basic auth (username:API token)
    in the header**.
  - Docs are published as a public Postman collection in English, with generated code samples in
    several languages.
  - Error 401/-2 reads "Authentication failed or illegal IP address", which implies **IP allowlisting
    is available**. How it is configured was not read.
- **DLR** [IU1]:
  - Push to `DeliveryNotificationUrl` per message, which carries `CustomerMessageID`, `Status`
    (2 delivered, -2 not delivered, -4 blocked), `SegmentsNumber` and the **original message text**;
  - JSON push is enabled through support;
  - a pull option also exists;
  - **no signature documented**.
- **OTP** [IU1][IU2]:
  - `Otp/SendOtp` and `Otp/Authenticate`, where InforU generates the code;
  - `Otp/Message/Send`, where **the client generates the code** and the channel is `SMS`, `VOICE` or
    `SMS_WITH_VOICE_FAILOVER`. Kosher phones and landlines get a voice call. Messages are
    "prioritized by the system".
  The client-generated endpoint fits §1 exactly.
- **Sender** [IU1]: up to 11 characters alphanumeric, or a whitelisted number of up to 14 digits.
  Numeric whitelisting runs by an SMS or voice OTP to that number.
- **Price.** Not published. The features page describes prepaid tiered packages and says a Hebrew
  message over 70 characters counts as several units [IU3]. **Quote needed.**
- **Security and privacy** [IU4][IU0] (vendor):
  - ISO 27001 is held and stated in the contract annex, with ongoing penetration tests.
  - Amendment 13 compliance is claimed.
  - Data is on **private servers in Israel only**: Bezeq International, with DR at Netvision.
  - The **processor annex** ("נספח לתנאי ההתקשרות – פרטיות", v2.1) gives:
    - processing only to provide the service;
    - no transfer to third parties except carriers and platforms;
    - service and storage performed in Israel;
    - customer audit rights, with defects answered in 20 days;
    - a yearly compliance report on request;
    - **serious security incidents reported within 24 working hours**;
    - a named security officer.
  - It also bars the customer from holding card, bank, medical, genetic, criminal or biometric data
    in the system [IU4]. None of that is involved here.
- **Reliability** [IU2] (vendor):
  - "direct connection to the cellular companies… without intermediaries";
  - two separate server farms, monitored 24/7;
  - 99.99% system API availability;
  - designated a "vital enterprise" for emergencies;
  - used by "most banks, HMOs, government ministries and insurers".
  No public status page or contractual SLA was found (unverified).

### 3.3 Micropay

- **API** [MP5][MP6]:
  - HTTPS at `www.micropay.co.il/extApi/*.php`, accepting GET, POST or JSON;
  - the token goes in a `token` **parameter**, so use the JSON body and never GET;
  - tokens are scoped by permission group (SMS, voice, WhatsApp, and so on);
  - docs are in Hebrew only, with cURL examples, actively updated (pages dated June–Oct 2026).
  - IP allowlisting: not found (unverified).
- **DLR** [MP7]:
  - a push to one account-level URL, as GET or JSON POST, with fields `msgid`, `phone`,
    `status ok/nd` and `net`;
  - on an `https` URL in GET mode it sends a **HEAD** request, with parameters in the URL;
  - **no signature documented**.
- **OTP** [MP2][MP8]:
  - `sendOtp.php` either generates the code or takes your own with `precode`. With your own code, the
    second (verify) call is optional;
  - code length 3–8 digits, validity 1–60 minutes, and `maxsms`/`maxvms` caps per validity window;
  - auto mode detects kosher, landline or SMS-blocked numbers and uses voice instead;
  - Hebrew, Arabic, English and Russian;
  - WebOTP supported;
  - **OTP is included free**: you pay only for the SMS or voice minute.
- **Sender** [MP3]: numeric sender verification by API, "according to Ministry of Communications
  guidelines", Israeli landline and mobile only. A custom sender ID costs nothing extra [MP1].
- **Price** [MP1]:
  - **₪100 for up to 5,000 messages (2 agorot)**, falling to 1 agora at 100,000;
  - a unit is up to 134 Hebrew characters;
  - prepaid, with no expiry while the account is active;
  - no set-up fee and no subscription. A ₪69/month "Pro" adds a virtual number and inbound SMS, which
    sign-in does not need.
- **Security and privacy** [MP4] (vendor):
  - ISO 27001, with the last audit 07/2026;
  - an authorised supplier to the Ministry of Defence and to the government;
  - data stored in Israel;
  - role-based access, with **2FA available on sign-in**.
  - **No DPA or processor annex was found published.** Request one.
- **Reliability.** No status page, SLA or carrier-connection statement was found (unverified).

### 3.4 019 SMS (Telzar 019 International Communications)

- **Who.** 019 sells SMS "directly from the cellular company 019". Telzar 019 is itself a cellular
  operator, which it presents as "without brokerage gaps" [019-1] (vendor).
- **API** [019-2]:
  - POST to `019sms.co.il/api` with an XML or JSON body, and a `/api/test` dry-run endpoint;
  - **Bearer token in the header**. Tokens are created in the UI, shown once, and expire. At most 5
    are active;
  - **TLS 1.2+ mandatory**;
  - **IP allowlisting** is a setting ("Enable Authorized IP Address Check");
  - docs are in English. Examples are in PHP and C#, not Node, but plain HTTP is enough.
  The JSON shape is XML-derived (`{"$":{"id":…},"_":"05…"}`), so it is serviceable but clumsy.
- **DLR** [019-2]:
  - a push to a registered URL, as `application/x-www-form-urlencoded` POST, with `status`,
    `phone`, `operaor` (sic) and `external_id`;
  - pushes stop after a few failed attempts;
  - **no signature documented**.
- **OTP** [019-2][019-3]:
  - `send_otp` and `validate_otp`, with a 6-digit code generated by 019, validity 1–15 minutes and
    3–5 tries. **The send response returns the code itself.**
  - **1,000 OTP SMS for ₪20, no service fee, 70-character message.**
  - A WhatsApp OTP is also offered.
- **Sender** [019-2]: up to 11 characters, digits and English letters only. A **Hebrew sender name is
  not possible**, and the same 11-character, Latin-only limit applies at InforU [IU1].
- **Price** [019-3][019-4]: OTP at ₪0.02. Packages are one-time purchases with no expiry and no
  further fee.
- **Security and privacy.** ISO 27001, data location and DPA were not found published (unverified).
- **Reliability.** The operator's own network. Delivery to the other carriers goes through
  interconnect; whether that is direct is unverified. No status page was found.

### 3.5 Looked at and set aside

- **Pulseem** (also offered as an alternative to ActiveTrail). A marketing suite. API access needs the
  ₪49/month Standard plan, and extra SMS cost ₪200 per 5,000 [PU1]. That means a subscription for a
  feature dona-v5 does not use.
- **ActiveTrail.** A marketing platform. Its SMS content is regulation advice for campaign senders
  [AT1]. Not API-first for OTP. Not pursued.
- **Global SMS.** Its marketing pages claim REST/JSON with webhooks, delivery in 2–5 seconds and
  direct routing to the carriers [GS1] (vendor). **No public API reference was found**, so it cannot
  be assessed against §1.
- **Cellact.** cellact.com now presents "Cellact COM", a global connectivity engine, with no public
  Israeli API docs, pricing or certifications [CE1]. It appears in third-party Israel price tables as
  a route for resellers [MS1] (secondary). Not assessable.

## 4. Israeli regulation

- **Spam law, Communications Law §30A.** "Advertising" (דבר פרסומת) means:
  - (1) a message distributed commercially to encourage buying a product or service, or spending
    money;
  - (2) a message to the general public seeking a donation, or propaganda;
  - (3) a message to the general public inviting the recipient to call a number to receive a message
    [LAW-30A] (statute text via Wikisource).

  A sign-in code sent to one tenant at their request fits none of these. Status notices about the
  tenant's own call also fit none, **provided they carry no offer**. Firms note the definition was
  widened in 2016 and 2018 [HZ1] (secondary). Practical rule: **no promotional sentence in any
  portal SMS.** The day one is added, §30A's prior-written-consent rule applies and statutory damages
  without proof of loss come with it (secondary, not confirmed from statute text for this note). Counsel should confirm this for the
  status-notice phase. It is not needed for OTP.
- **Numeric sender identity (2021).** Carriers must verify that a **numeric** sender ID belongs to the
  sender. In practice a one-time "whitening" by SMS or voice code to that number has been required
  since **3 Jan 2021**. A text (alphanumeric) sender is unchanged [IU5][MP3] (vendor). The
  Ministry's own directive page (gov.il "הוראת מינהל – שירות שליחת מסר קצר") was **blocked to this
  research** (HTTP 403), so the primary text is unverified.
- **Bulk-sender identification (Oct 2022).** The Ministry decided to require:
  - strong identification of bulk SMS senders, for example by video call with the carrier;
  - verification of the paying credit card;
  - a cap of 50 SMS a day from prepaid lines;
  all imposed through amendments to the carriers' licences within six months [LAW-MOC] (secondary).
  The duty falls on licensees and gateways. For dona-v5 it means **account opening involves KYC on
  Dona Dom**, which the director does.
- **Amendment 13 and the Data Security Regulations.** Covered in `tenant-portal.md:326-345`. The new
  point here: the provider is a **processor holding tenant phone numbers**. The 2017 regulations'
  outsourcing duty (summarised in [LAW2] of tenant-portal.md) is exactly what InforU's annex is
  written to satisfy [IU4]. Micropay and 019 would need one drafted or requested.

## 5. SMS pumping and abuse, whatever the vendor

1. **Destination is not attacker-chosen.** Send only after the isolation join resolves a party, as
   already designed (`tenant-portal.md:216-217`). This removes the classic pumping vector, where a bot
   enters premium or foreign numbers.
2. **Israeli mobiles only.** Reject anything not matching `^05\d{8}$` before calling the vendor.
   - Disable international sending at the vendor: Twilio geo permissions [TW4]; 019
     `includes_international=0` [019-2].
   - Ask InforU and Micropay to lock the account to Israel (unverified that they can).
3. **Caps in our database.** Per number, per IP and global per hour, counted from `audit_log`
   (`SPEC.md:272-274` pattern). Add a **monthly spend ceiling** alerting at, say, 3× the expected
   volume.
4. **Prepaid as a backstop.** All three Israeli vendors are prepaid packages [IU3][MP1][019-4]. A
   runaway loop stops at the balance, not at an invoice. Twilio's equivalent is the account's
   auto-recharge setting (not read).
5. **IP allowlist.** Use it where offered: InforU (implied) and 019 (documented). Cloud Run's egress
   is not a fixed address unless it goes through Direct VPC egress plus a **Cloud NAT gateway with a
   reserved static IP** [GC2]. That is a small infra change with a small monthly cost (not priced
   here).

## 6. Reliability

No Israeli vendor publishes a status page or a contractual SLA that this research could read. The
claims are all vendor claims:
- InforU: direct carrier connections, two data centres and 99.99% API availability [IU2];
- 019: an operator itself [019-1];
- Global SMS: direct routing [GS1].

Twilio has a public status page [TW6]. For sign-in this is mitigated by design: **WhatsApp stays the
primary factor and the passkey removes repeat OTPs.** An SMS outage is a degraded fallback, not a
lockout. Ask for the SLA in writing during the quote.

## 7. Comparison

| | Twilio | **InforU** | **Micropay** | 019 SMS |
|---|---|---|---|---|
| API style | REST, SDKs | JSON v2, Postman docs (EN) [IU1] | GET/POST/JSON, Hebrew docs [MP5] | XML/JSON POST, EN docs [019-2] |
| Credential | Account SID + token/API key (header) | Basic auth header [IU1] | `token` param, scoped [MP6] | Bearer header, expiring [019-2] |
| IP allowlist | not read | implied by error -2 [IU1] | not found | yes [019-2] |
| DLR push | yes | yes, JSON via support [IU1] | yes, GET/HEAD or JSON [MP7] | yes, form POST [019-2] |
| Client-generated-code send | yes (Messaging) | yes, with voice failover [IU1] | yes, `precode` [MP8] | plain SMS send |
| Kosher-phone voice fallback | no (not found) | yes [IU1][IU2] | yes [MP2] | no (not found) |
| Price per Hebrew OTP (≤70 chars) | $0.2575 ≈ ₪0.95 [TW1] | quote | ₪0.02 [MP1] | ₪0.02 [019-3] |
| Fees / minimum | $15/mo only if a number is leased [TW1] | prepaid packages [IU3] | ₪100 min. package, ₪0/mo [MP1] | ₪20 / 1,000 OTP [019-3] |
| Alphanumeric sender | pre-reg ~1 wk [TW2] | ≤11 Latin chars [IU1] | yes [MP1] | ≤11 Latin chars [019-2] |
| ISO 27001 | ISO 2700x mentioned [TW6] | yes, in contract [IU4] | yes, audit 07/2026 [MP4] | not found |
| Data location | US (transfers) [TW5] | Israel only [IU0][IU4] | Israel [MP4] | not found |
| DPA | incorporated [TW5] | published annex [IU4] | not found, request | not found, request |
| Account 2FA | not read | not read | yes [MP4] | not read |
| Status page / SLA | yes [TW6] | no / 99.99% claim [IU2] | no / no | no / no |

## 8. Recommendation

**Primary: InforU.** The reasons, in order:
1. **It is the only Israeli provider with a published processor annex.** That annex covers Israel-only
   processing, audit rights, a 24-hour incident notice and ISO 27001 as a contractual statement
   [IU4]. This is what Amendment 13 and the outsourcing regulation ask the controller to hold, and it
   costs a signature, not a negotiation.
2. **Its API fits the design in §1 without bending it.** It offers a client-generated code, a header
   credential, JSON and an IP allowlist, with an English Postman reference [IU1].
3. **Voice failover for kosher phones** is in the same call [IU1]. A share of Israeli tenants cannot
   receive SMS at all, and presumably have no WhatsApp either (unverified).
4. **Reliability claims** fit a sign-in path: a priority OTP queue, direct carrier connections and two
   data centres [IU2] (vendor).

Its cost: the price is unpublished, and the account is opened through sales. At ≤2,000
messages a month the quote is very unlikely to approach Twilio's (unverified until quoted).

**Runner-up: Micropay.** Its price is published and lowest per Hebrew character (₪0.02 for up to 134
characters) [MP1]. It also has ISO 27001 with a 2026 audit, data in Israel, account 2FA [MP4], free
OTP with voice fallback and WebOTP [MP2], and current docs. It is runner-up for three reasons:
- no processor annex is published;
- the token travels as a parameter;
- the docs are Hebrew-only.
If InforU's quote or annex disappoints, Micropay is the switch, and the transport-only adapter
makes switching a one-file change.

**Not Twilio.** It costs about 45× more per message [TW1], data goes to the US [TW5], and no
kosher-phone answer was found in the pages read. Its one real advantage, a public status page, matters less for a fallback
factor.

**Not 019** for now. It is the cheapest and an operator itself, and it has a good IP allowlist and
expiring tokens [019-2]. But its security posture (ISO, data location, DPA) is not published, and its
OTP response hands back the code [019-2], which is harmless but signals a looser design. Revisit it
if the other two fail on the annex.

## 9. The director's decisions

1. **Supersede ADR-0013 §5** (SMS fallback re-admitted for portal sign-in). This is engineering
   work, but it reverses a recorded decision, so the director should see it.
2. **Spend.**
   - An InforU prepaid package, on quote. Expected at most a few hundred NIS a year at 2,000 a month;
     Micropay's published equivalent is ₪100 for 5,000 [MP1].
   - Optionally a Cloud NAT static IP for the allowlist (§5.5).
   - Later, status notices at the same per-message rate.
3. **Signature.**
   - Open the account. That includes the carrier-mandated identification of Dona Dom as a sender
     [LAW-MOC].
   - Sign InforU's service agreement and its privacy annex [IU4], as the controller's outsourcing
     contract.
4. **The sender name.** An alphanumeric name of at most 11 Latin characters [IU1][019-2], for example
   `DonaDom`. It cannot be Hebrew. A tenant-facing name is a small promise to the client, so the
   director picks it.
5. **The data-subject notice** (F6) gains a line naming the SMS provider as a processor of phone
   numbers for sign-in.

## 10. The third-party table row

For `SPEC.md:283-290`, added in the same change as the ADR and before the first call:

| Third party | What it sees | From |
|---|---|---|
| **InforU (Shamir Systems) — SMS gateway** | The tenant's mobile number, the sign-in code text and the time, for each SMS one-time code sent as the WhatsApp fallback; delivery status back. Voice call to the same number when the line cannot take SMS. No tenant-authored text. Processing in Israel under the signed privacy annex. | Portal sign-in, staging on the director's own number first |

## Sources

- [TW1] Twilio, SMS pricing, Israel — https://www.twilio.com/en-us/sms/pricing/il
- [TW2] Twilio, Israel SMS guidelines — https://www.twilio.com/en-us/guidelines/il/sms
- [TW3] Twilio, Verify pricing — https://www.twilio.com/en-us/verify/pricing
- [TW4] Twilio docs, "Preventing Fraud in Programmable Messaging"; "Verify Geo Permissions" — https://www.twilio.com/docs/messaging/guides/preventing-messaging-fraud ; https://www.twilio.com/docs/verify/preventing-toll-fraud/verify-geo-permissions
- [TW5] Twilio, Data Protection Addendum — https://www.twilio.com/en-us/legal/data-protection-addendum
- [TW6] Twilio, Trust Center (certifications, status page link) — https://www.twilio.com/en-us/trust-center
- [TW7] Twilio docs, Global Infrastructure (Regions) — https://www.twilio.com/docs/global-infrastructure
- [IU0] InforU home page, security and privacy section (vendor) — https://www.inforu.co.il/
- [IU1] InforU API documentation (Postman collection: SendSms, Otp, Otp/Message/Send, DLR push, sender whitelist, status codes) — https://apidoc.inforu.co.il/
- [IU2] InforU, OTP solution page (vendor) — https://www.inforu.co.il/solution/%d7%a4%d7%aa%d7%a8%d7%95%d7%9f-otp/
- [IU3] InforU, "חבילת SMS" feature page (pricing model, 70-character unit) (vendor) — https://www.inforu.co.il/features/%D7%97%D7%91%D7%99%D7%9C%D7%AA-sms-2/
- [IU4] InforU, "נספח להסכם שירות – פרטיות, סודיות ואבטחת מידע", v2.1 — https://www.inforu.co.il/privacy_v21/
- [IU5] InforU blog, "רגולציית זיהוי השולח ב-SMS", 22 Sep 2020 (vendor) — https://www.inforu.co.il/%D7%A8%D7%92%D7%95%D7%9C%D7%A6%D7%99%D7%99%D7%AA-%D7%96%D7%99%D7%94%D7%95%D7%99-%D7%94%D7%A9%D7%95%D7%9C%D7%97-%D7%91-sms-%D7%9E%D7%94-%D7%96%D7%94-%D7%95%D7%90%D7%99%D7%9A-%D7%A0%D7%A2%D7%A8%D7%9B/
- [MP1] Micropay, pricing (SMS packages, OTP included) — https://site.micropay.co.il/pricing.php
- [MP2] Micropay, OTP product page (vendor) — https://site.micropay.co.il/otp.php
- [MP3] Micropay developer centre, sender-ID verification API — https://site.micropay.co.il/api/sender-verify.php
- [MP4] Micropay, FAQ (ISO 27001, data in Israel, 2FA) (vendor) — https://site.micropay.co.il/faq.php
- [MP5] Micropay developer centre, overview — https://site.micropay.co.il/api/
- [MP6] Micropay developer centre, tokens and authentication — https://site.micropay.co.il/api/auth.php
- [MP7] Micropay developer centre, DLR webhook — https://site.micropay.co.il/api/webhook-dlr.php
- [MP8] Micropay developer centre, OTP API — https://site.micropay.co.il/api/otp.php
- [019-1] 019 SMS landing page (Telzar 019) (vendor) — https://lp.019sms.co.il/
- [019-2] 019 SMS API docs: getting started (token, TLS, IP restriction), send SMS, push API, OTP API — https://docs.019sms.co.il/guide/ ; https://docs.019sms.co.il/sms/send-sms.html ; https://docs.019sms.co.il/sms/push-api.html ; https://docs.019sms.co.il/otp/sms-otp.html
- [019-3] 019 OTP SMS product page (1,000 for ₪20) (vendor) — https://lp.019sms.co.il/019otpsms/
- [019-4] 019 SMS FAQ (packages, no expiry) (vendor) — https://lp.019sms.co.il/%D7%A9%D7%90%D7%9C%D7%95%D7%AA-%D7%A0%D7%A4%D7%95%D7%A6%D7%95%D7%AA/
- [PU1] Pulseem, SMS pricing (vendor) — https://site.pulseem.co.il/pricing_he_sms/
- [AT1] ActiveTrail blog, SMS regulation (vendor) — https://www.activetrail.co.il/blog/tips_updates/%D7%A8%D7%92%D7%95%D7%9C%D7%A6%D7%99%D7%99%D7%AA-%D7%94%D7%A1%D7%9E%D7%A1%D7%99%D7%9D-%D7%A9%D7%9C-%D7%9E%D7%A9%D7%A8%D7%93-%D7%94%D7%AA%D7%A7%D7%A9%D7%95%D7%A8%D7%AA-%D7%A2%D7%95%D7%A9%D7%99%D7%9D/
- [GS1] Global SMS, API and OTP pages (vendor) — https://www.globalsms.co.il/
- [CE1] Cellact COM home page — https://www.cellact.com/
- [MS1] Messaggio, SMS pricing Israel (secondary) — https://messaggio.com/sms-pricing/israel/
- [LAW-30A] Communications Law (Telecommunications and Broadcasting), 5742-1982, §30A, statute text on Hebrew Wikisource — https://he.wikisource.org/wiki/%D7%97%D7%95%D7%A7_%D7%94%D7%AA%D7%A7%D7%A9%D7%95%D7%A8%D7%AA_(%D7%91%D7%96%D7%A7_%D7%95%D7%A9%D7%99%D7%93%D7%95%D7%A8%D7%99%D7%9D)
- [HZ1] Herzog Fox & Neeman, anti-spam amendment note (secondary) — https://herzoglaw.co.il/en/?p=4394 ; Haim Ravia, "Israeli anti-spam law amended for first time", 19 Aug 2016 (secondary) — https://www.law.co.il/en/news/2016/08/19/israeli-anti-spam-law-amended-for-first-time/
- [LAW-MOC] law.co.il, "משרד התקשורת מציג: רגולציה נגד מסרוני פישינג וקנאביס", 25 Oct 2022 (secondary) — https://www.law.co.il/news/2022/10/25/moc-against-canabis-phishing-sms/ ; MoC directive page (not readable, 403) — https://www.gov.il/he/pages/14022023_1
- [GC2] Google Cloud, Cloud Run static outbound IP — https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip
