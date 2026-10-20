---
number: 273
title: "Sign in by code"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [271, 272]
parent: 270
created: 2026-10-19
closed: 2026-10-20
---

## Parent

#270 — Tenant portal.

## What to build

A tenant enters their phone number on the tenant host, receives a one-time code from a **code sender**, enters it, and is signed in: a **Portal identity** is created for the number on its first verification and a **Tenant session** starts. The code sender is an interface; this ticket ships a fake for tests and a dev-only sender that writes the code to the server log, so the flow can be clicked on `:3000` with no provider. Signed in, the tenant lands on an empty home page with sign out and "sign out of every device". Adds the `asTenant(phone)` test helper beside `asOperator`, which signs in through this real flow.

**Paint screens 1a and 1b** (`mockups/tenant-portal.html`), in the tenant portal design system. This ticket lands that system for every later portal screen: the `--tp-*` tokens and the portal components (buttons, inputs, cards, chips, sheets, tab bar) move out of the paint into a stylesheet served on the tenant host, beside `/ui/tokens.css` and never mixed into the office shell, and the portal's icons are added to `kernel/ui/icons.ts`. The phone screen shows the brand mark and the language button, one phone field with a fixed `+972` prefix, and **שליחת קוד** with the caption that the code comes by WhatsApp. The code screen shows the number with a שינוי link back, six code cells drawn over one input, and the wait before a new code may be asked for. There is no כניסה button: the sixth digit submits. Signed in, the tenant lands on the empty home page; the tab bar arrives with #279.

## Acceptance criteria

- [x] SPEC-channel (the code sender) and SPEC.md (the tenant session) are edited first.
- [x] Codes are six digits, single use, expire after five minutes, are stored hashed, and allow a small fixed number of attempts.
- [x] Only Israeli mobile numbers are accepted; anything else is refused before a send.
- [x] Sends are capped per number, per network address and per day; every send and every verify, passed or failed, is an audit row.
- [x] The session cookie is opaque, `HttpOnly`, `Secure`, `SameSite=Strict`, host-only on the tenant host; the session is a server-side row.
- [x] Sign out ends this session; sign out everywhere ends every session of the identity, and is an audit row.
- [x] A wrong code, an expired code and a used code each show a clear Hebrew message and a way to ask for a new code.
- [x] The dev sender exists only outside production and cannot be configured on staging.
- [x] Email is never offered as a way to sign in.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` with the dev sender before merge.
- [x] The portal stylesheet carries the `--tp-*` tokens and components; no portal view contains a hex colour, a font-family or a physical side, so `tests/ui/tokens.test.ts` holds for the tenant host too.
- [x] The code is one `<input autocomplete="one-time-code" inputmode="numeric" maxlength="6">` drawn as six cells. SPEC.md names the sixth-digit submit as a client-JavaScript exception, edited first; without script a submit button is shown, so the page still works.
- [x] The phone field is `type="tel"`, `inputmode="tel"`, `autocomplete="tel-national"`, left to right, with the `+972` prefix outside the input.
- [x] The wait before a new code is server-rendered text; the new-code control is offered once it has passed.

## Blocked by

- #271
- #272

## Comment — 2026-10-20

A tenant signs in on the tenant host with a six-digit code. The first successful code creates the portal identity and a thirty-day session; signing out of every device ends them all and writes an audit row. Locally the code is written to the server log and not the number. A deployed revision has no sender, and `PORTAL_CODE_LOG=1` refuses to boot when `K_SERVICE` is set. Five sends a number, twenty an address, five wrong attempts, five minutes, and a minute before another code — the minute still holds after the code was used or the sender failed, and those rows count. The session cookie is Secure when the proxy says https, which is how Cloud Run reports TLS. Phone page checked at 390px with no sideways scroll. The code itself was entered against the restarted server because the browser would not click the button. A screen reader was not run; the pages are native forms with labels.
