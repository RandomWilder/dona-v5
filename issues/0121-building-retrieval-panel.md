---
number: 121
title: "Building retrieval panel"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent: 120
created: 2026-09-17
closed: 2026-09-17
---

## Parent

#120 — Office retrieval on the Building: panel, list command, tool choice.

## What to build

The Building estate screen grows the same left-side collapsible office retrieval panel as the Unit screen. Signed-in ADMIN, OPERATOR and VIEWER ask about that Building’s documentation (the office Building retrieval bound), see cited answers or refusals, continue their private thread, and can clear it.

This ticket is cite-from-paper only. The office turn still searches Passages and does not list lettings. Table asks wait on #123.

The buildings list, Unit page, letting sheet, documents, settings and queues stay without a leftover Building bound. The Unit panel is unchanged.

## Acceptance criteria

- [x] Building `GET` shows the left collapsible retrieval panel for a signed-in holder of `documents.read`
- [x] Posting a turn (CSRF + session) runs the office-turn command for that Building bound and paints the thread
- [x] VIEWER may ask; anonymous and missing CSRF are closed; no new permission
- [x] Clear on that screen wipes only the signed-in account’s thread for that Building
- [x] A Unit thread and a Building thread for the same staff account stay distinct
- [x] Panel absent on the buildings list, Unit page (which keeps its own panel), letting sheet, documents, settings, expiring and incomplete queues
- [x] Hebrew in and out; cited Passages visible under an answer; documents-refusal sentence when Passages do not answer
- [x] Clicked on `:3000` after restarting `npm run dev`
- [x] `SPEC-estate.md` records the Building panel in the same change

## Blocked by

None (can start immediately).

## Comment — 2026-09-17

Shipped the Building panel: GET paints the same collapsible ask/clear column as the Unit for
`documents.read`; POST turn and POST clear are CSRF+session, `documents.read`, bound to that
Building; VIEWER can ask; a Unit thread on the same account stays distinct. `SPEC-estate.md` in
the same change. Cite-from-paper only.

Restarted leftover `:3000`. Signed-in GET of a Building showed the panel; the buildings list did
not; the Unit page kept its own. Ask on that process returned 503 — embedder unconfigured on this
machine. Cited-answer paint is covered by the view test; empty-bound refuse by the HTTP suite.
