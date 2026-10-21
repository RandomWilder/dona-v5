---
number: 285
title: "English and Russian"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [276, 280, 284]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

Every portal string is translated into English and Russian by a person. Page direction follows the language. The portal starts in the Party's preferred language when it is one of the three, otherwise Hebrew, and the tenant can switch from the language sheet; the choice is kept. Adding a language later is adding rows.

**Paint screens 1g′** (`mockups/tenant-portal.html`), and its English and Russian homes. The language is chosen from a globe button on the sign-in screens and the home page, and under the עוד tab, which opens a bottom sheet titled "שפה · Language · Язык" with one row per language, each in its own script and direction. English and Russian pages mirror the Hebrew ones: back arrows and the send mark flip with the direction.

## Acceptance criteria

- [x] SPEC.md (or the portal's spec section) is edited first: the three UI languages and how the starting language is chosen.
- [x] No portal page contains a literal user-facing string.
- [x] English and Russian pages lay out left to right with logical properties; Hebrew right to left.
- [x] Legal texts are shown in the chosen language, falling back to Hebrew only if a translation is missing, and that fallback is visible.
- [x] Clicked on `:3000` in all three languages before merge.
- [x] Heebo is served with its Cyrillic subset and its weight 800 beside the Hebrew and Latin subsets already in `kernel/ui/fonts/`, so Russian does not fall back to a system face.

## Blocked by

- #276
- #280
- #284

## Comment — 2026-10-21

Done. Three languages are rows. A saved choice in `dona_portal_lang` wins; otherwise a signed-in page uses the party's language when it is Hebrew, English or Russian, and Hebrew otherwise. Sign-in, before a session exists, uses the saved choice or Hebrew. Switching language shows that language's current legal text if it has not been acknowledged. A missing translation shows the Hebrew row and says so. Heebo has no Cyrillic glyphs, so that range is Noto Sans on the Heebo family (weight 300–800), and the face now allows weight 800. No new runtime dependency. Sign-in on `:3000` checked in Hebrew, English and Russian, and the choice survived a reload. The browser session already signed in was a building not on the portal, Hebrew, right to left.
