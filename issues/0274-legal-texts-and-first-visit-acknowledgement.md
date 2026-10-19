---
number: 274
title: "Legal texts and the first-visit acknowledgement"
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

The privacy notice, the terms, the entry-permission wording and the optional opt-ins are versioned rows per language, each with a placeholder flag. On first sign-in the tenant sees the privacy notice and terms and acknowledges reading them; the service is not made conditional on consent. Optional opt-ins start off. A new version of a text asks again. The placeholder wording is written to best practice under Amendment 13 and seeded; Dona Dom's legal team replaces it.

**Paint screens 1d** (`mockups/tenant-portal.html`): "לפני שמתחילים", one card holding the privacy notice and the terms with a link to the full text, then a separate card for each optional opt-in as a switch, then **קראתי, המשך**. The acknowledgement is the button; it is never a checkbox, and it is never on the same card as an opt-in.

## Acceptance criteria

- [ ] SPEC.md is edited first: the legal texts, the acknowledgement, and that service does not depend on consent.
- [ ] Each acknowledgement is a row: identity, text, version, language, time.
- [ ] A new version of the privacy notice or terms is shown again at the next request after sign-in.
- [ ] Opt-ins are off unless the tenant turns them on, and turning one off is as easy as turning it on.
- [ ] Placeholder wording is seeded for Hebrew, English and Russian and flagged as placeholder.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000` before merge.
- [ ] Each opt-in is an `<input type="checkbox" role="switch">` in its own card, off by default, separate from the acknowledgement button.

## Blocked by

- #271
