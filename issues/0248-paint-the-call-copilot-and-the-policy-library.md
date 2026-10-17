---
number: 248
title: Paint the call copilot and the Policy library
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 247
created: 2026-10-16
closed: 2026-10-17
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

Two painted flows in the live shell, served dev-only under `/dev/mockups/`, so the director can click
them on `:3000` and comment before anything is wired (CLAUDE.md: paint an unbuilt flow before wiring
it).

- **The call copilot on the call page.** Show these on one call:
  - the Call brief, with its citations and a refresh control;
  - the Call thread with follow-up questions, each turn marked with who asked;
  - the Draft reply, in the tenant's language, with its Hebrew rendering beside it;
  - send and copy.
  - Paint every state the director needs to judge:
    - the brief still being written;
    - the frozen refusal;
    - a guarantor-only requester, who gets no brief;
    - a WhatsApp call outside the 24-hour window, which offers copy only;
    - an actor without `calls.reply`, who sees copy but not send;
    - the timeline row after a send, marked edited or as written.
- **The מדיניות tab.**
  - Show the Policy library's sections (State law, Company policy) and the documents in each.
  - Show a document's version history, with effective-from and effective-to.
  - Show the ADMIN upload into a section.
  - Show the read-only view a non-ADMIN user sees.

The paints use specimen and synthetic text only. They are deleted once their flow is wired.

## Acceptance criteria

- [x] Both paints render in the dev shell on `:3000` and are reachable from the dev mockups index.
- [x] Every state listed above is reachable by clicking, with no state described only in prose.
- [x] No real tenant document, name or address appears in either paint.
- [x] The director has clicked both and their comments are recorded as comments on this issue
      before it closes.

## Comment — 2026-10-17

Director reviewed both paints on `:3000` and approved them. No changes. The index leads to the call copilot and the Policy library. Every state is a click on the page. Names and addresses are invented. The files stay until the flows are wired.

## Blocked by

- None (can start immediately).
