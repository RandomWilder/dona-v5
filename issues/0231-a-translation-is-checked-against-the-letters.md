---
number: 231
title: "A translation is checked against the letters"
status: closed
labels: [bug]
assignee:
blocked_by: []
parent: 187
created: 2026-10-14
closed: 2026-10-14
---

## What happened

Main CI for #131 (run 38471846014, first attempt) failed the sorter golden set at 13/14:
`ar-noise: the translation was not Hebrew`. The evals job blocks the deploy, so staging stayed on
the previous version until the job was re-run by hand.

## Why

`createSorter().translate` took the model's reply on its word. The reply carries a boolean,
`alreadyHebrew`, and a `bodyHe`; the code returned `bodyHe: null` whenever the model said the
message was Hebrew, and returned any non-empty `bodyHe` without looking at it. On a rare draw the
model called the Arabic advertisement Hebrew (or handed back text without Hebrew letters). 120
live samples on 14 Oct 2026 all came back correct, so the rate is under one in a hundred, which
is enough to block one deploy in every few dozen, since every merge runs the set once.

The eval was right to fail: in production the same draw shows the office an Arabic message with no
Hebrew beside it.

## What changed

SPEC-channel.md, "The sorter port": a translation is checked against the letters. A reply that
calls a message Hebrew when under half its letters are Hebrew, or a translation under half Hebrew
letters, is asked for once more; a second such reply throws, and the door leaves `body_he` empty as
it already does for a timeout. The model still judges the language; the code only refuses a
judgement the text contradicts. A failed call is not retried.

Policy case `src/channel/sorter.test.ts` "asks again when the reply contradicts the letters, and
throws on a second" was red first (the Arabic reply came back `null`). Live golden set after the
change: sorter 14/14, golden set 10/10.
