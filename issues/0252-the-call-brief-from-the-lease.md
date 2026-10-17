---
number: 252
title: The Call brief, from the lease and the building's paper
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [248]
parent: 247
created: 2026-10-16
closed: 2026-10-17
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

When a call reaches IDENTIFIED, by the door or by hand, the call page shows a Call brief. The brief
is the office retrieval model's first turn on the call's Call thread, answering "what does the paper
say about this request?" with cited passages.

**When it runs**
- The brief runs once, asynchronously, after the emergency path has run. It never delays or replaces
  the emergency path (foundation rule 5).
- The page shows the brief as being written until it lands.
- A refresh control appends a new turn to the thread and never overwrites the old one.

**The bound**
- The live Tenancy plus Building paper, otherwise the Unit or Building bound (ADR-0010).
- Administrator stance.
- A service provider who is the requester gets their own record only.
- A requester who is only a guarantor gets no brief at all (foundation rule 7). The page says why.

**Settings and channels**
- An on/off switch and the model id are settings rows, not constants.
- When the switch is off, no brief is written and nothing is sent to the model.
- WHATSAPP calls get no brief until #249 is recorded and #257 lifts the exclusion. EMAIL, PHONE and
  WALK_IN calls do get one.

**Delivery**
- The Call thread is a mode on the office turn in evidence; no third model.
- When nothing in the bound answers, the brief is the frozen refusal.
- The call page's brief area is wired to the #248 paint.

## Acceptance criteria

- [x] SPEC-calls and SPEC-evidence describe the Call thread, the brief trigger, the bound and the exclusions.
- [x] A call moved to IDENTIFIED gets exactly one brief turn, written after the emergency path. An
      emergency call is shown to escalate before any model call.
- [x] Refresh appends a turn, and earlier turns remain.
- [x] Each exclusion has a red-first policy case:
  - [x] a guarantor-only requester gets no brief;
  - [x] a provider sees only their own record;
  - [x] a WHATSAPP call gets no brief;
  - [x] with the switch off, the model is not called.
- [x] The full golden set runs, with new cases:
  - [x] a brief that cites lease clauses;
  - [x] a brief that cites the building's paper;
  - [x] a refusal.
- [x] Clicked on `:3000` with a specimen call.

## Blocked by

- #248

## Comment — 2026-10-17

A new phone call, identified as דנה כהן, showed the brief once the turn landed. She has no lease on file, so the turn is the frozen refusal, and the related calls sit beside it. Refresh appended a second turn and left the first. A call identified before this server start has no brief: nothing is written for a call that was already identified.
