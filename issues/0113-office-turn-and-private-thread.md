---
number: 113
title: "Office turn and private thread"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [112]
parent: 111
created: 2026-09-16
closed: 2026-09-16
---

## Parent

#111 — Office retrieval on the Unit: bound search, cited answers, persisted thread.

## What to build

Staff can ask a question against a Unit bound and get either a cited Hebrew answer drawn only from
this turn’s Passages, or a hard refusal.

The history is an **office retrieval thread**: one per staff account × bound, private, kept until
cleared. Follow-ups search again. Thread text may clarify the question; a fact that is not a Passage
hit this turn is not in the answer.

Refuse when the bound has no Passages, when hits come back but none answer the question, or when the
question is about another Unit’s paper. No silent widen, no Building nudge. The command may call
only search. Not **the agent**, not a **Conversation**.

No Unit-page panel yet — this ticket is the command and the store, greppable and testable without
the chrome.

## Acceptance criteria

- [x] One office-turn command: staff account, Unit bound, question → search this turn → answer or refuse → persist
- [x] Cited answers name Document and page; administrator stance text is as printed on the paper
- [x] Refuse: empty bound; hits that do not answer; cross-bound / neighbour question — no citations on a refuse
- [x] Second turn searches again; history does not supply facts missing from this turn’s hits
- [x] Thread is unique per staff account × bound; a second staff account on the same Unit does not see the first thread
- [x] Clear removes only that account’s thread on that bound
- [x] Tenant stance cannot be assembled with a Building or portfolio bound (still fail closed)
- [x] Behavioural golden cases grade this turn as the evals subject for cite and refuse; `off-lease-refuses` still means hits may exist and none answer
- [x] `SPEC-staff.md` (thread) and `SPEC-evidence.md` (turn) updated in the same change

## Blocked by

- #112 — Required retrieval bound

## Comment — 2026-09-16

Closed. `runOfficeTurn` searches the bound at administrator stance, answers or refuses, and persists
an office retrieval thread unique on staff account × bound. Clear deletes only that thread. Empty
bound, unanswered hits, and a neighbour-Unit question refuse with no citations and no Building
nudge. Follow-ups search again; thread text is not a fact store. Behavioural goldens
`responsibility-cited` and `office-turn-refuses` grade this command (`tool: search`); grounding
`off-lease-refuses` is unchanged. No Unit panel — that is #114.
