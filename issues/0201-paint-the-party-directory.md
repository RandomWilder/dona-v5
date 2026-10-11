---
number: 201
title: Paint the אנשי קשר screens before wiring them
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

A painted, unwired version of the whole flow, served in the live shell under the dev-only mockups
route, so the director can click it on `:3000` and comment before anything is wired. It shows every
screen #199 describes, with realistic generated data and no real tenant data:

- the directory: the search box, the label filters, the rows (name, labels with unit, primary phone,
  primary email, language), a former-number match flagged as such, and no ת.ז. anywhere;
- the profile: given and family name, language, the ת.ז. masked with a reveal button (and how it
  looks to an operator, who has none), the labels linked to tenancies, every contact open and closed
  with its dates and label, the calls opened, the edit history, the same-name hint;
- the edit forms: identity, add a contact, set primary, close a contact on a date, the service
  provider section;
- the create form for a person and for a company, including the refusal when there is neither a
  contact nor a ת.ז.;
- the refusals: a duplicate ת.ז. linking to the other party, a contact another party holds.

Each wiring ticket (#202–#209) removes its screen from the mockup when its screen is wired; the last
one to finish deletes the file.

## Acceptance criteria

- [x] The mockup renders in the live shell at the dev-only mockups route and is unreachable in production.
- [x] Every screen and refusal listed above is present and clickable between screens.
- [x] The tab is labelled אנשי קשר and sits with the existing tabs.
- [x] No ת.ז. appears on the directory screens; on the profile it appears only masked until revealed.
- [x] The director has clicked it on `:3000` and their comments are folded into the mockup and, where they change behaviour, into #199 as a comment.

## Comment — 2026-10-11

Paint is up at `http://127.0.0.1:3000/dev/mockups/party-directory` for the director to click. The אנשי קשר tab is in the rail only on that screen. Names and numbers are invented. Waiting on the director's comments before this closes.

## Comment — 2026-10-11

Director reviewed `http://127.0.0.1:3000/dev/mockups/party-directory` and approved the paint. No changes. Nothing folded into the mockup or into #199. The file stays until the last of #202–#209 is wired.

## Blocked by

None (can start immediately).
