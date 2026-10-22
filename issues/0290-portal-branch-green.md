---
number: 290
title: The portal branch runs green
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 289
created: 2026-10-22
closed: 2026-10-22
---

## Parent

#289 — Staging portal service.

## What to build

The staging deploy runs only after CI on `main` is green, so the portal reaches staging only once the
`tenant-portal` branch passes its whole suite. On 22 Oct 2026 five tests fail on the branch head
(1377 of 1382 pass):

- calls · close by an exit — records an answered, forwarded, duplicate or cancelled exit from each open state
- calls · the handling clock — saves business-day thresholds and adds and removes a non-working date
- calls · the reply target — counts a person within the target, and not the duty reply or a returned call
- estate · the hidden buildings flow — links the old building pages from nowhere except themselves and A11/A13
- policy · report an issue — opens one call on send, keeps the suggestion, and flags an emergency word

At least one is a real behaviour question, not just local state. The "report sent" page shows the
promise "a person from the office will reply within 5 business days", and a test expects no promise.
#288 says tenants see the promise only once an administrator switches it on. Diagnose each failure
before changing anything. Decide whether the test or the code is wrong against the SPEC file that
owns the behaviour, and fix the side the spec says is wrong. If a spec is silent or ambiguous, the
spec edit comes first.

## Acceptance criteria

- [x] Each of the five failures has a written cause, recorded in this issue's closing comment: wrong test, wrong code, or local state.
- [x] The full suite, typecheck, lint and guards are green locally against a freshly migrated database.
- [x] Every behaviour fix that is visible on a page is clicked on `:3000` after restarting `npm run dev`.
- [x] No test is skipped or deleted to get to green, unless its spec line was removed in the same change.

## Comment — 2026-10-22

Each failure was diagnosed against the SPEC file that owns it. No page behaviour changed, so nothing was clicked on `:3000`. No test was skipped or deleted. The full suite is 1382 and 41, with typecheck, lint and guards green, on the existing local database and again on a database migrated from empty (`dona_290`).

- **Close by an exit — wrong test.** The case required the global open-count to rise by exactly one from a snapshot taken at the start. Other cases commit calls into the same database while this one runs, so the number moves. The closed calls are checked on the open list and the closed list, by their own ids.
- **Handling clock — local state.** The saved thresholds are 7 and 20 business days. SPEC-calls says the placeholders are 2 and 5, and that an administrator can change them at `/settings` without a deploy. The page was showing the saved numbers. The test now reads those numbers and checks that an operator sees them, then saves and restores.
- **Reply target — local state.** The saved target is 5 business days and the tenant switch is on. SPEC-calls says the placeholder is 2 and the switch is off until an administrator turns it on. The test now keeps whatever is saved, sets the target it needs, and restores.
- **Hidden buildings — local state.** The crawl stops at 200 screens. This database has 57 buildings, 11,313 documents and 6,684 unopened leases, so the fixture's own document screens were never reached. Those screens are the same for every row. The crawl now follows only this fixture's rows, and still fails if one of them links an old building page.
- **Report an issue — wrong test.** With the switch on, the confirmation shows "אדם מהמשרד יענה בתוך 5 ימי עסקים". SPEC-calls (#288) says tenants see that promise only when an administrator has switched it on, and the switch is on. The test forbade the promise in either state. That line was removed. The reply-target case now sends a report while the switch is off, and the confirmation names no reply time, then sends another once the switch is on and the promise is there.
- **Opening a call — wrong test, found on the fresh database.** The refusal case compared the length of the whole open list before and after. Another case committed a call between the two reads. A refused open is now checked by counting the calls this case's own staff account stored, which is none.

## Blocked by

- None (can start immediately).
