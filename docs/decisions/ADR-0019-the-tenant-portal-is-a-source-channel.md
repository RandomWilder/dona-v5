# ADR-0019 — The tenant portal is the tenant's home and a Source channel; WhatsApp stays a door

- **Date:** 2026-10-19
- **Status:** accepted
- **Context:** [docs/research/tenant-portal.md](../research/tenant-portal.md),
  [docs/research/sms-gateway-israel.md](../research/sms-gateway-israel.md)
- **Supersedes:** [docs/ideas/dona-dom-platform.md](../ideas/dona-dom-platform.md) "No tenant app —
  WhatsApp is the app"; [ADR-0013](ADR-0013-whatsapp-arrives-by-coexistence.md) §5 "No SMS provider"

## The decision

Tenants get a **Portal**: a web application, installable on the phone, on its own tenant subdomain,
where a verified tenant sees their flat, their tenancy documents and their ServiceCalls, and reports
an issue or asks the office a question. The portal is the tenant's home. **WhatsApp is a door into
the same system and is never closed**: a tenant who never opens the portal loses nothing.

1. **One new Source channel, `PORTAL`,** for the web portal and for any later native app. A report or
   a question from the portal enters the same intake door as every other channel and becomes an
   ordinary ServiceCall. There is no second call flow.
2. **The tenant signs in with a phone number.** The first sign-in on a device is a one-time code sent
   by a WhatsApp authentication template by default, or by SMS when the tenant chooses it. After
   that the device holds a passkey and later sign-ins skip both. Every sign-in on a new device sends
   a notice to the number on file. Email is never a sign-in method.
3. **A Portal identity is a verified phone number, not a role.** On every request it is resolved
   through the isolation join to a Party and its labels, or to nobody. What it may do is decided per
   capability: tenancy documents and the tenancy's calls only for a verified active tenant;
   "ask the office" for every verified number.
4. **A building is in the portal only when the office switches it on**, and the switch refuses while
   any legal text is a placeholder.
5. **An SMS provider is named** in the third-party table before it is called. InforU is recommended
   and Micropay is the runner-up; the choice and its spend are the director's.

## Why not "WhatsApp is the app"

The platform idea chose WhatsApp as the only tenant surface to spare tenants an adoption tax. Three
things changed. First, a tenant who wants to see their lease, their open calls or a past reply has
nowhere to look in a chat; the record exists only on the office side. Second, Meta's pricing moved:
from 1 October 2026 each number gets 1,000 free service messages a month and charges after that, and
without a payment method on file Meta stops delivering. ADR-0013's "replies inside the window are
free" is out of date, and a single paid, policy-controlled channel is a single point of failure for
both service and sign-in. Third, not every Israeli uses WhatsApp; a sign-in that only works there
locks some tenants out.

Keeping WhatsApp open as a door, rather than replacing it, keeps the adoption argument intact: the
portal is added, nothing is taken away.

## Why a channel and not a module with its own calls

A portal call that bypassed the door would need its own dedupe, emergency check, threading, sorting
and identification, and would drift from the others within weeks. As a Source channel it inherits all
five, and the office sees one list.

## Consequences

- ADR-0013 §5 is reversed: a tenant code may go by SMS. Twilio is not the provider; an Israeli
  gateway with processing in Israel and a published processor annex is.
- The portal is the first surface that faces people outside the office. Every route declares a
  tenant stance, every tenant read of tenancy data is logged, and object-level checks on every
  request are a policy case, not a convention.
- A call opened through the portal cannot be returned to the filtered list; the office cancels it
  with a note, so the tenant sees what happened and the reply measurement stays honest.

## What this does not decide

AI answers in the portal (its own ADR, phase 2), access for leads, past tenants and service
providers (each its own decision), the visit flow, the native app's packaging, and the final wording
of any legal text, which is Dona Dom's legal team's.
