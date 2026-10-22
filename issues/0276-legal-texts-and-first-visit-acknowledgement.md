---
number: 276
title: "Legal texts and the first-visit acknowledgement"
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

The privacy notice, the terms, the entry-permission wording and the optional opt-ins are versioned rows per language, each with a placeholder flag. On first sign-in the tenant sees the privacy notice and terms and acknowledges reading them; the service is not made conditional on consent. Optional opt-ins start off. A new version of a text asks again. The placeholder wording is written to best practice under Amendment 13 and seeded; Dona Dom's legal team replaces it.

**Paint screens 1d** (`mockups/tenant-portal.html`): "לפני שמתחילים", one card holding the privacy notice and the terms with a link to the full text, then a separate card for each optional opt-in as a switch, then **קראתי, המשך**. The acknowledgement is the button; it is never a checkbox, and it is never on the same card as an opt-in.

## Acceptance criteria

- [x] SPEC.md is edited first: the legal texts, the acknowledgement, and that service does not depend on consent.
- [x] Each acknowledgement is a row: identity, text, version, language, time.
- [x] A new version of the privacy notice or terms is shown again at the next request after sign-in.
- [x] Opt-ins are off unless the tenant turns them on, and turning one off is as easy as turning it on.
- [x] Placeholder wording is seeded for Hebrew, English and Russian and flagged as placeholder.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` before merge.
- [x] Each opt-in is an `<input type="checkbox" role="switch">` in its own card, off by default, separate from the acknowledgement button.

## Blocked by

- #273

## Comment — 2026-10-20

A signed-in tenant who has not read the current privacy notice or terms is shown them before the empty home. The passkey offer still comes first. The acknowledgement is the continue button, and the building-notices switch is a separate card, off until turned on. Turning it off is the same switch, on that screen and again when a new version asks. The button records the text that was on the page, not a version published after the page was drawn. Placeholder wording is seeded in Hebrew, English and Russian; the portal still speaks Hebrew, so the other two are held until the language choice exists. On :3000 at 390px the notice and the full wording did not scroll sideways. Enter opened the full wording and submitted the continue button. A screen reader was not run. The accessibility tree names the switch, the link and the button.

## Comment — 2026-10-20

The director signed in on `tenant.localhost:3000` with a fresh number, used the logged code, and landed on לפני שמתחילים. The flow looks right. A screen reader was still not run.
