---
number: 233
title: "An HTML request gets a Hebrew error page, not JSON"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 232
created: 2026-10-14
closed: 2026-10-14
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

When a request from a browser page fails with an error that no screen handles itself, the operator sees a Hebrew error page inside the console shell. The page says what went wrong in one sentence, gives the way back to the page they came from, and keeps the status code. Requests that ask for JSON (API clients, tests that send `Accept: application/json`) keep today's JSON body unchanged.

On 14 Oct 2026 the director saw a raw JSON body during a lease approval ("that terms profile does not exist"). The underlying cause is fixed elsewhere (PR RandomWilder/dona-v5#136, #234). This ticket makes sure that no future unhandled refusal reaches an operator as JSON.

## Acceptance criteria

- [x] A browser request (`Accept: text/html`) that ends in the generic error handler renders a Hebrew page in the shell, with the status code preserved.
- [x] The page maps each kernel error kind (`invalid`, `conflict`, `not_found`, `not_allowed`, unexpected) to its own Hebrew sentence. It never shows the English message or a stack trace.
- [x] The page offers a way back: the referring page when known, the home page otherwise.
- [x] A request asking for JSON gets the existing JSON body, byte for byte.
- [x] HTTP test at the app seam covers one HTML and one JSON request for the same failing route.
- [x] Clicked on `:3000`: a forced refusal renders the Hebrew page.

## Blocked by

None (can start immediately).

## Outcome

`src/error-page.ts` renders the page; `src/app.ts`'s generic error handler sends it when `Accept` names `text/html` and the existing JSON body otherwise. The rail is drawn when the guard resolved a staff session, the guest frame when it did not. The way back is the `Referer`'s path when it is this host and not protocol-relative (`//host/...`), `/` otherwise. `too_many` got its own sentence beside the five the ticket named. Both page variants are in `tests/ui/tokens.test.ts`'s `SCREENS`. SPEC.md §Error shape and SPEC-staff.md's refusal section carry the rule.

Clicked on `:3000` on 14 Oct 2026: the document-type form on `/settings`, submitted empty with browser validation turned off, answered 400 with the Hebrew `invalid` page in the shell, and the way back returned to `/settings`.
