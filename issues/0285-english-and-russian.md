---
number: 285
title: "English and Russian"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [276, 280, 284]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

Every portal string is translated into English and Russian by a person. Page direction follows the language. The portal starts in the Party's preferred language when it is one of the three, otherwise Hebrew, and the tenant can switch from the language sheet; the choice is kept. Adding a language later is adding rows.

**Paint screens 1g′** (`mockups/tenant-portal.html`), and its English and Russian homes. The language is chosen from a globe button on the sign-in screens and the home page, and under the עוד tab, which opens a bottom sheet titled "שפה · Language · Язык" with one row per language, each in its own script and direction. English and Russian pages mirror the Hebrew ones: back arrows and the send mark flip with the direction.

## Acceptance criteria

- [ ] SPEC.md (or the portal's spec section) is edited first: the three UI languages and how the starting language is chosen.
- [ ] No portal page contains a literal user-facing string.
- [ ] English and Russian pages lay out left to right with logical properties; Hebrew right to left.
- [ ] Legal texts are shown in the chosen language, falling back to Hebrew only if a translation is missing, and that fallback is visible.
- [ ] Clicked on `:3000` in all three languages before merge.
- [ ] Heebo is served with its Cyrillic subset and its weight 800 beside the Hebrew and Latin subsets already in `kernel/ui/fonts/`, so Russian does not fall back to a system face.

## Blocked by

- #276
- #280
- #284
