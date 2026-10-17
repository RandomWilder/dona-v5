---
number: 250
title: The Policy library — sections and upload
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

An ADMIN can upload a law or a company policy into a section of the Policy library. Every signed-in
staff member can open the מדיניות tab and read what is there.

- **Plan mode:** this is the policy layer and a new module.
- **Spec first:** SPEC-policy stops being a stub. It defines:
  - Policy sections and Policy documents, against Policy rules (ADR-0017);
  - who uploads (`settings.write`) and who reads (any signed-in staff member).
- **Sections:** sections are rows, seeded with State law and Company policy. A new section is a row,
  not a migration.
- **Documents:** a Policy document has a section, a title and an effective-from date.
  - Its text is read and chunked through the same document pipeline as other paper, so it becomes
    searchable passages.
  - It is never updated or deleted.
- **Wiring:** the tab is wired to the #248 paint, and the paint's library half is deleted.
- **Scope:** versions (effective-to and supersession) are #251. Search from a call is #254.

## Acceptance criteria

- [x] SPEC-policy describes Policy sections, Policy documents, upload, reading and the never-update rule.
- [x] The seeded sections exist after a fresh migrate and seed.
- [x] An ADMIN uploads a specimen document into a section, and it appears on the מדיניות tab.
- [x] An OPERATOR or VIEWER sees the tab and can read the document but has no upload control.
      The server refuses their upload, and a red-first policy case proves the refusal.
- [x] The uploaded document's passages exist and carry its section.
- [x] The path is clicked on `:3000` after a restart of `npm run dev`.
- [x] Specimen text only. No real document is committed.

## Blocked by

- #248

## Comment — 2026-10-17

The מדיניות tab is wired. Sections are seeded rows (State law, Company policy) via `npm run seed` and `npm run seed:policy`. An ADMIN uploads; an OPERATOR or VIEWER can read and is refused on upload. A document and its passages cannot be updated or deleted. The library paint is gone. Versions and call search stay on #251 and #254.
