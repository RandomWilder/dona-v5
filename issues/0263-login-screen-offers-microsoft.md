---
number: 263
title: Login screen offers Microsoft
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [262]
parent: 258
created: 2026-10-18
closed: 2026-10-18
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

The login screen offers the two equal buttons and the note from the agreed paint (#260), the
Microsoft one pointing at the Microsoft start route. When Microsoft is unconfigured the screen shows
Google only, exactly as today. The paint is deleted once the screen is wired.

## Acceptance criteria

- [x] Configured: both buttons render, equal, Google then Microsoft, with the agreed copy.
- [x] Unconfigured: only the Google button renders.
- [x] The mockup file and its route are gone.
- [x] `npm run dev` restarted and the login screen clicked on `:3000` in both states.

## Blocked by

- #262 — Microsoft sign-in end to end

## Comment — 2026-10-18

The login screen offers two equal buttons, Google then Microsoft, when Microsoft is configured. The Microsoft button starts `GET /staff/auth/microsoft/start`. The note is the one agreed on the paint. When Microsoft is unconfigured the screen is Google's alone, with today's line, and both Microsoft routes still answer unavailable. A refused sign-in renders the same screen, so the second button does not disappear after a refusal. If Google itself is unconfigured and Microsoft is not, the screen offers Microsoft alone, with the same shape of note, and does not say that sign-in is unavailable. The paint file, its test, and its card on the mockups index are gone. Restarted `npm run dev` on `:3000` and clicked both states: with Microsoft configured both buttons were the same size and each left for its provider; with Microsoft unconfigured only Google remained and still left for Google.
