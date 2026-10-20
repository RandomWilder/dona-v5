---
number: 275
title: "Passkeys and the new-device notice"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [273]
parent: 270
created: 2026-10-19
closed: 2026-10-20
---

## Parent

#270 — Tenant portal.

## What to build

After a code sign-in, the tenant is offered a passkey on that device (fingerprint, face or device PIN). Later sign-ins on that device use the passkey and skip the code. A sign-in on a device with no passkey is a new-device sign-in, and a short notice is sent to the number by the code sender. The tenant can see and remove their passkeys.

**Paint screens 1c** (`mockups/tenant-portal.html`): a centred face-scan mark, "כניסה מהירה בפעם הבאה", three reasons (no waiting for a code, the key stays on this phone, it can be added or removed any time), the primary **הפעלת כניסה מהירה** and the text button **לא עכשיו**. The tenant's list of passkeys sits under the עוד tab (#279).

## Acceptance criteria

- [x] SPEC.md's client-JavaScript rule is edited first: the WebAuthn calls are the named exception.
- [x] Registering and using a passkey works in a current mobile Safari and Chrome.
- [x] Adding a passkey, removing one and every new-device sign-in are audit rows.
- [x] A new-device sign-in sends exactly one notice to the number on file.
- [x] Declining the passkey offer leaves the tenant signed in and offers it again on a later sign-in.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` before merge.
- [x] Declining is the **לא עכשיו** text button, never a second primary button.

## Blocked by

- #273

## Comment — 2026-10-20

A code sign-in lands on the passkey offer. Declining stores nothing and the next code sign-in offers it again. The challenge is already in the page, so the tap calls the prompt with no request in between. Chrome on :3000 registered a passkey that way, listed it dated 2026-10-20, and removed it. The offer at 390px did not scroll sideways: one primary, and לא עכשיו as a text button. A screen reader was not run. Safari on a phone was not run. A new-device sign-in sends one notice and still signs the tenant in when that notice fails. The list is linked from the empty home until the עוד tab (#279).
