# ADR-0013 — WhatsApp arrives by coexistence, with Dona Dom as its own Tech Provider

- **Date:** 2026-10-06
- **Status:** accepted
- **Touches:** `SPEC-channel.md` (the adapter), `SPEC.md` (the third-party table: the Meta row widens,
  the Twilio row goes), the build order for multi-channel intake.
- **Owed by the director:** Meta's Tech Provider terms signed by Dona Dom, Dona Dom's business
  verification, and a privacy policy on Dona Dom's site. None of these is an engineering act.

## The decision

1. **The office's existing WhatsApp number reaches the system through Meta's coexistence onboarding.**
   The number stays on the receptionist's phone, in the WhatsApp Business app, and is connected to
   the Cloud API at the same time. Messages either side sends appear in both places. The number is
   first moved from standard WhatsApp to the WhatsApp Business app on the same phone, by backup and
   restore.
2. **Dona Dom is the Tech Provider, in its own Business Manager.** The Meta app, the WhatsApp Business
   account and the number are Dona Dom's. The developer holds access to that app, not ownership of it.
3. **No Business Solution Provider.** A BSP stays available as a fallback if App Review cannot be
   passed, and adopting one would supersede this decision rather than quietly extend it.
4. **No unofficial client, ever.** Not Baileys, not whatsapp-web.js, not automation of WhatsApp Desktop
   or WhatsApp Web.
5. **No SMS provider.** _(Superseded by [ADR-0019](ADR-0019-the-tenant-portal-is-a-source-channel.md): a tenant code may go by SMS.)_ Tenant OTP goes by WhatsApp authentication template only, and Twilio leaves the
   third-party table before it is ever called.
6. **No history import.** The connection starts on the day it is made. The 180 days coexistence can
   sync are not read into the system.

## Why

**The number is the asset, and Meta's API is the only sanctioned door to it.** The office wanted to
use the phone it already has. Every route that does that without Meta works by impersonating a
WhatsApp client, which breaks WhatsApp's terms and risks a ban on the one number tenants already
know. A banned number is not a technical outage; it is the office losing its tenants' channel.
Coexistence is the route that keeps the number, keeps the phone, and is supported.

**Coexistence onboarding is available only to a Solution Partner or a Tech Provider** (Meta, onboarding
WhatsApp Business app users, checked 2026-10-06). A business cannot connect its own business-app
number as a plain direct developer. The choice was therefore between a BSP and a Tech Provider, and
between our business and Dona Dom's as that Tech Provider.

**Fewer third parties was the director's stated preference, and it decided both.** With Dona Dom as the
Tech Provider and no BSP, WhatsApp traffic reaches Meta and nobody else, and Meta is already named in
`SPEC.md`. A BSP would be a further processor of every message, a further data processing agreement
and a fee on top of Meta's. Putting the app in Dona Dom's Business Manager rather than the
developer's keeps the Meta relationship with the business that controls the data, and a change of
developer later moves nothing.

**Twilio was listed only as the SMS fallback for OTP.** A tenant who is writing on WhatsApp is reachable
on WhatsApp by definition, so the fallback buys little and costs a processor.

**History is not imported** because it would move six months of tenant messages into the system and
to the model provider for calls the office has already handled by hand.

## Consequences

- **The WhatsApp path waits on the director and on Meta, not on code.** Business verification and App
  Review come first. Meta's documentation states no App Review timeline; developer reports through
  mid-2026 put it at 17 to 20 days, and every rejection restarts the clock. Plan for three to five
  weeks including one rejection. This is a further reason email intake is built before WhatsApp
  intake.
- **Cost is Meta's per-message pricing and nothing else.** Replies inside the 24-hour window are free;
  templates outside it are charged per delivered message; Meta lists no Tech Provider fee and no
  monthly fee. Messages the receptionist sends from the phone app stay free.
- **The phone must stay in use.** Meta disconnects a coexistence number whose primary device is
  inactive for about 14 days. The system watches message echoes from the phone and shows the office
  a warning after 7 days without one.
- **Coexistence limits apply:** 20 messages per second, no disappearing or view-once messages, no live
  location, broadcast lists become read-only, groups are not synced.
- **Every 1-on-1 chat on the phone reaches the system.** The phone is an office device with no personal
  contacts, so all of it goes through the sorter.

## Alternatives rejected

- **An unofficial client** (Baileys, whatsapp-web.js, desktop automation): no Meta setup, but against
  WhatsApp's terms, unstable, and a ban risk on the office's only tenant number.
- **A BSP** (Twilio, 360dialog and similar): faster onboarding and a support desk, at the price of a
  further processor and fee. Kept as the fallback.
- **The developer's business as Tech Provider:** the same steps, but the Meta relationship would sit
  with a vendor instead of with the business that holds the data.
- **A new number on the Cloud API alone:** clean, but tenants would have to learn a new number and the
  receptionist would lose the phone.
