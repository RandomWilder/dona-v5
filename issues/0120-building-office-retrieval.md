---
number: 120
title: "Office retrieval on the Building: panel, list command, tool choice"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 111
created: 2026-09-17
closed: 2026-09-18
---

## Parent

#111 — Office retrieval on the Unit: bound search, cited answers, persisted thread. Unit quality held on staging. This is the one-level-up that #111 deferred: same office turn, Building retrieval bound, panel on the Building page.

## Problem Statement

The office can ask cited questions on one Unit and trust isolation. They cannot do the same while looking at a Building: there is no panel there, and a Building-wide question has no staff surface. They also cannot ask for a complete table of apartments let today and who is on them. Rebuilding that table from Passages would miss flats and invent others. The data already sits on the letting; the office retrieval model cannot read it.

## Solution

The Building estate screen grows the same left-side collapsible office retrieval panel as the Unit screen. The bound is this Building (the office bag: that Building’s paper, every Unit in it, those Units’ lettings). Each staff account has its own **office retrieval thread** on that bound.

The office retrieval model is a client of documented module commands, never a writer of store queries. On a Building bound it may choose, this turn, to search Passages, to call a named list of active lettings in this Building, or both. Facts are only what this turn’s commands returned. Passage answers still cite Document and page. A list answer cites no paper; it is the letting. Eight nearest Passages stay the search cap. Rent is not on the letting row and is not in this ship.

[ADR-0010](../docs/decisions/ADR-0010-office-building-bound-is-not-tenant-building-paper.md) keeps this bound off the tenant channel. Later WhatsApp may read **Building paper** only. Not this ticket.

## User Stories

1. As an operator on a Building screen, I want the same collapsible retrieval panel as on a Unit, so that I do not learn a second UI.
2. As a viewer, I want that panel with `documents.read` and no new permission, so that asking is the same gate as reading paper.
3. As an administrator, I want the same panel, so that all three staff roles share one product.
4. As any staff on a Building, I want the retrieval bound to be this Building, so that the posts cannot keep a leftover Unit or portfolio bound.
5. As any staff, I want to ask in Hebrew and get Hebrew, so that the Building panel matches the Unit panel.
6. As any staff, I want a question about the building handover protocol to cite that Document and page, so that shared paper is first-class here.
7. As any staff, I want a question about a clause in apartment 12’s lease to be allowed to cite that lease, so that “one level up” is a wider retrieve, not a protocol-only reader.
8. As any staff, I want names, addresses, amounts and identifiers in a Passage answer exactly as printed, so that administrator stance is unchanged.
9. As any staff, I want a neighbour Unit’s nearer Passage to stay out of a *Unit* panel answer, so that the bar we just proved does not regress.
10. As any staff, I want my Building thread empty when I arrive from a Unit thread, so that switching bound does not mix histories.
11. As any staff, I want follow-ups on the Building panel to search or list again, so that yesterday’s answer is not treated as a fact store.
12. As any staff, I want to clear the Building thread and only wipe my history on this Building, so that another account and my Unit threads stay.
13. As a second operator on the same Building, I want my own thread, so that retrieval stays private per staff account × bound.
14. As any staff, I want to ask for a table of apartments let today and their tenants, so that I get a complete roll instead of a Passage collage.
15. As any staff, I want every Unit that is let today named on that roll, so that “every” is an inventory, not a best-effort cite.
16. As any staff, I want vacant Units omitted from that roll in this ship, so that the first table is who pays now.
17. As any staff, I want draft and ended lettings omitted, so that only an active letting appears.
18. As any staff, I want one row per Unit with every party except the ערב named on that row, so that the table is apartments and who lives there.
19. As any staff, I want the ערב absent from that row, so that a roll of residents is not a roll of guarantors.
20. As any staff, I want no phone and no ת.ז. on that row, so that a table ask does not become an identifier dump.
21. As any staff, I want letting start and end dates on that row, so that the roll is the typed columns we already trust.
22. As any staff, I want a list answer to carry no Document-page citations, so that we do not pretend the letting row is a Passage.
23. As any staff, when nobody is let in this Building today, I want to be told that, so that an empty roll is not the frozen documents-refusal sentence.
24. As any staff, I want a protocol question not to load the household roll into the model, so that a rules ask does not send neighbour names for no reason.
25. As any staff, I want a table question not to rebuild the roll from Passages, so that completeness does not depend on eight nearest pages.
26. As any staff, I want the model to choose list, Passage search, or both, so that one box can do both jobs.
27. As any staff, after a table, I want to ask what the deposit is in apartment 12 and get a cited Passage answer in the same thread, so that the two jobs mix without two panels.
28. As any staff on a Unit screen, I want the Unit turn to stay Passage-search only, so that the Building list command cannot fire there.
29. As any staff, I want no portfolio roll command, so that one question cannot pull every household in the estate.
30. As any staff, I want CSRF and a session on ask and clear, so that the Building posts match the Unit posts.
31. As an anonymous visitor, I want those posts closed, so that retrieval stays a signed-in office act.
32. As any staff on the buildings list, search, expiring, incomplete, letting sheet, documents, or settings, I want no Building retrieval panel and no leftover bound, so that only the Building page picks this bound.
33. As any staff, I want the eight-Passage cap unchanged, so that a cite-from-paper question does not become a prompt of the whole building.
34. As any staff, I do not want a rent figure on the roll in this ship, so that we do not quote captured `rent_amount` as if it were a typed column.
35. As a future tenant on WhatsApp, I want never to receive this roll or this Building retrieval bound, so that neighbour data cannot ride a “building context” reuse.
36. As a future tenant, I want building rules to be a later **Building paper** bound, so that regulations are not the office bag.
37. As the director, I want this click path on a restarted `:3000` and then staging: Building page, table ask, protocol ask, clear, Unit page still isolated.

## Implementation Decisions

- Estate paints the panel on the Building page only, same chrome and collapse pattern as the Unit panel. Posts name this Building as the retrieval bound. `GET` stays `estate.read`; ask and clear stay `documents.read`.
- Evidence’s office-turn command already accepts a Building bound. It today always searches Passages. It grows a choice: on a Building bound the office retrieval model may call Passage search, the active-lettings list command, or both. On a Unit bound it may call only Passage search. Stance stays administrator and is not a caller parameter. Tenant stance on a Building or portfolio search stays refused.
- Tenancy owns the list command: given a Building id and today’s clock, return each Unit in that Building that has an active letting covering today, with unit name, start date, end date, and party names whose role is not ערב. No phone, no ת.ז., no captured fields, no rent. Empty is a valid result. Estate does not own this read; evidence does not query tenancy tables.
- The list command is not offered on a Unit bound, a portfolio bound, or any tenant-facing path. Offering it is a command error, fail closed.
- No schema change. The office retrieval thread is already unique on staff account × bound kind × bound id.
- No new permission.
- No mockup. This is the Unit panel on another screen.
- Specs in the same change: estate (panel on the Building page), evidence (office turn may choose tools on a Building bound), tenancy (list command), staff (thread already generic; say the Building page is a second poster). Glossary already names office retrieval model, Building paper, and the wide Building retrieval bound. [ADR-0010](../docs/decisions/ADR-0010-office-building-bound-is-not-tenant-building-paper.md) is the bound split.
- Personal data in a list turn still reaches the model provider under ADR-0004; the list is names and dates, not identifiers.
- Plan mode when implementing: estate, evidence, and tenancy.

## Testing Decisions

Test external behaviour. Do not assert internals of the router or the HTML class names.

**Seam 1 — the office-turn command (highest, prefer this).** Prior art: evidence’s office-turn tests and the evals subject that already grades cite / refuse / `tool: search`. Extend:

- A Building-bound table question calls the list command and does not depend on Passage hits for the names.
- A Building-bound protocol question calls search and does not include the household roll in the facts.
- A Building-bound mix is allowed when both commands ran this turn; thread text from an earlier table is not a fact on the next turn unless the list is fetched again.
- A Unit-bound turn cannot call the list command (unit goldens stay `tool: search`).
- Empty active roll: answered, not the documents-refusal sentence; no Passage citations.
- Passage cite/refuse on a Building bound still holds (handover protocol; refuse when hits do not answer).
- Full golden set runs; this change is a tool definition. New behavioural cases for list vs search vs empty roll. Policy cases red-first: list refused on Unit and portfolio; ערב absent; no ת.ז. on the list shape; tenant stance still cannot search a Building bound.

**Seam 2 — Building page HTTP.** Prior art: Unit panel route tests (#114). Signed-in `documents.read` sees the panel; ask and clear CSRF+session; VIEWER may ask; anonymous closed; panel absent on the buildings list and the Unit page still has the Unit panel only; another account does not see this thread.

Do not add a third seam (SQL against occupancy, embedding distance). The list command’s contents are asserted through seam 1 and a tenancy contract test of the command’s return shape (active only, no ערב, no identifiers) — that is the same height as `listTenancyParties` today, not a new pattern.

## Out of Scope

- Rent on the roll, promoting `rent_amount` onto the letting, reading `ExtractedField` for inventory.
- Vacant Units, draft lettings, ended lettings, future lettings.
- Tenant WhatsApp, tenant stance on any Building bag, a **Building paper** bound, a global knowledge base.
- Portfolio bound panel or portfolio roll.
- Raising the eight-Passage cap.
- Linking roll rows to the letting sheet.
- Phone numbers, ת.ז., ערב on the roll.
- New permission, new module, new table.
- Paint/mockup.
- The agent (WhatsApp). This is the office retrieval model.

## Further Notes

Unit staging quality was the gate; it held. Same class of Passage question as the Unit panel; the list path is the second job in the same box. `/to-tickets` should split at the seams above (list command → office-turn tool choice → Building panel HTTP), not as a UI ticket that pretends the turn is unchanged.

Clicked on `:3000` after restarting `npm run dev` before merge. Staging: table ask and protocol ask on one Building, Unit panels still isolated across two Units in that Building.

## Comment — 2026-09-17

Staging after #105: Unit asks 303 and answer well. Building asks returned JSON
`unavailable` / extraction 404 `name: office_turn` (our HTTP 503; provider 404).
Retry same. Unit still good. Follow-up: provider `error.code` + `error.message`
on the extract failure; ask POST 303s back to the bound page with a frozen
Hebrew notice. This issue stays open until a Building ask on staging 303s and
paints an answer.

## Comment — 2026-09-18

Closed. Staging on `dona-staging` after #105/#106: Building panel is live;
cited questions on a Building with paper work; Unit panel still isolated. A
second lease on the same Building files and the Unit page retrieves it. Occupancy
and unit-count questions that refuse, filing approve 409 JSON on a second stamp,
and naming a neighbour Unit inside the eight-Passage Building bag are out of
this ticket — next session.
