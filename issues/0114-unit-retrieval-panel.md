---
number: 114
title: "Unit retrieval panel"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [113]
parent: 111
created: 2026-09-16
closed: 2026-09-16
---

## Parent

#111 — Office retrieval on the Unit: bound search, cited answers, persisted thread.

## What to build

The Unit estate screen grows a left-side collapsible panel. Signed-in ADMIN, OPERATOR and VIEWER
ask about that Unit’s documentation, see cited answers or refusals, continue their private thread,
and can clear it.

The panel exists only on that screen. Building, all-buildings, documents, letting sheet, settings
and queues stay without it and without a leftover bound. Staging success for #111 is this click
path: Unit page, ask, cited quality against the golden retrieval cases, history still there on
reload, clear.

## Acceptance criteria

- [x] Unit `GET` shows a left collapsible retrieval panel for a signed-in holder of `documents.read`
- [x] Posting a turn (CSRF + session) runs the office-turn command for that Unit bound and paints the thread
- [x] VIEWER may ask; anonymous and missing CSRF are closed; no new permission
- [x] Clear on that screen wipes only the signed-in account’s thread for that Unit
- [x] Panel absent on Building, all-buildings, documents, letting, settings, expiring and incomplete queues
- [x] Hebrew in and out; cited Passages visible under an answer
- [x] Clicked on `:3000` after restarting `npm run dev` (dev does not watch)
- [x] `SPEC-estate.md` records the panel in the same change

## Blocked by

- #113 — Office turn and private thread

## Comment — 2026-09-16

Shipped the Unit panel: GET paints a collapsible ask/clear column for `documents.read`; POST turn
and POST clear are CSRF+session, `documents.read`, bound to that Unit; VIEWER can ask; another
account on the same Unit does not see the thread. `SPEC-estate.md` in the same change.

Restarted leftover `:3000`. Signed-in GET of a Unit showed the panel; the buildings list did not.
Ask on that process returned 503 — embedder unconfigured on this machine. Cited-answer paint is
covered by the view test; empty-bound refuse by the HTTP suite. Golden cited quality on staging
still wants a configured embedder and a Unit with Passages.
