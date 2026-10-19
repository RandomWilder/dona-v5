---
number: 273
title: "Passkeys and the new-device notice"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [271]
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

After a code sign-in, the tenant is offered a passkey on that device (fingerprint, face or device PIN). Later sign-ins on that device use the passkey and skip the code. A sign-in on a device with no passkey is a new-device sign-in, and a short notice is sent to the number by the code sender. The tenant can see and remove their passkeys.

**Paint screens 1c** (`mockups/tenant-portal.html`): a centred face-scan mark, "כניסה מהירה בפעם הבאה", three reasons (no waiting for a code, the key stays on this phone, it can be added or removed any time), the primary **הפעלת כניסה מהירה** and the text button **לא עכשיו**. The tenant's list of passkeys sits under the עוד tab (#277).

## Acceptance criteria

- [ ] SPEC.md's client-JavaScript rule is edited first: the WebAuthn calls are the named exception.
- [ ] Registering and using a passkey works in a current mobile Safari and Chrome.
- [ ] Adding a passkey, removing one and every new-device sign-in are audit rows.
- [ ] A new-device sign-in sends exactly one notice to the number on file.
- [ ] Declining the passkey offer leaves the tenant signed in and offers it again on a later sign-in.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000` before merge.
- [ ] Declining is the **לא עכשיו** text button, never a second primary button.

## Blocked by

- #271
