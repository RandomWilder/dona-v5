---
number: 269
title: "Paint the tenant portal"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

A clickable paint of the whole phase-1 portal in the live shell, so the director can click it on `:3000` and comment before anything is wired. Tenant side: phone entry, code entry (WhatsApp default, SMS choice), passkey offer, first-visit notice and acknowledgement, home, my flat (with a chooser for two tenancies), my papers, my calls with Tenant status words, a call thread with a follow-up box, report an issue (category, entry permission, emergency notice, attachments), ask the office, the "building not in the portal yet" state, the language switch, and the "we reply within X business days" line. Office side: the Building's portal switch (including the refusal while a legal text is a placeholder), and the `/settings` additions — non-working dates, handling thresholds in business days, the Reply target and "show to tenants".

## Acceptance criteria

- [x] The paint is served at `/dev/mockups/tenant-portal`, dev-only, and every screen above is reachable by clicking.
- [x] Hebrew right to left, with one screen also shown in English left to right to prove the direction switch.
- [x] Works at phone width.
- [ ] The director has clicked it and their comments are recorded as comments on this ticket.
- [ ] The paint is deleted by the last ticket that wires its final screen.

## Blocked by

None (can start immediately)

## Comment — 2026-10-19

Paint is up at `http://127.0.0.1:3000/dev/mockups/tenant-portal`, listed from the mockups index. Every screen in the ticket is a click: phone, WhatsApp code with an SMS choice, passkey, first-visit notice, home with the reply line, my flat with two tenancies, papers, calls in the tenant status words, a thread with a follow-up, report (category, entry, duty notice, attachments), ask, building not in the portal, English left to right, and a Russian screen for the language switch. Office: the building switch, the refusal while a legal text is a placeholder, and the settings additions (non-working dates, business-day thresholds, reply target, show to tenants — off). Sample text only. Waiting on the director's comments before this closes. The file stays until the last ticket that wires a screen deletes it.
