---
number: 260
title: Paint the two-button login
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 258
created: 2026-10-18
closed:
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

The login screen as it will look with both providers, painted in the live shell's mockup area before
anything is wired: two equal buttons, Google then Microsoft, and one note naming both ways in. The
director clicks it on `:3000` and comments; wiring (#263) takes the copy and layout from the agreed
paint.

## Acceptance criteria

- [x] The paint is served in the dev-only mockup area and renders in the live shell, in Hebrew, RTL.
- [x] Both buttons are visually equal; neither reads as the default or the fallback.
- [x] The note replaces the current Google-only line and names both providers.
- [x] The paint shows the state with Microsoft unconfigured (Google only) as well.
- [ ] The director has clicked it and their comments are recorded on this issue.

## Comment — 2026-10-18

Paint is up at `http://127.0.0.1:3000/dev/mockups/login`, listed from the mockups index. Two states, switched by click: both providers, and Google alone when Microsoft is unconfigured. Both buttons are the same filled control, full width, Google above Microsoft. The both-providers note is "הכניסה היא דרך חשבון Google או חשבון Microsoft. אין כאן סיסמה ואין קוד." The Google-only state keeps today's line and one Google button. The buttons do not start a sign-in. Waiting on the director's comments before this closes.

## Blocked by

None (can start immediately).
