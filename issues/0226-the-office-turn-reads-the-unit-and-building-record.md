---
number: 226
title: The office turn reads the Unit record and the Building record
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-13
closed: 2026-10-14
---

## Problem Statement

The office retrieval panel on a Unit page and on a Building page answers only from paper. On a Unit
bound the turn's one command is Passage search; on a Building bound it is Passage search, the
lettings list, or both. When search returns nothing and no list was fetched, the turn refuses
without calling the answering model.

So an operator who opens flat 12 and asks how big it is, which floor it is on, whether it has a
mamad or which bay it holds gets the refusal sentence whenever no Document answers — even though the
account holds every one of those facts. A newly seeded Building with no paper yet cannot answer
anything about itself. And the values the account holds are the more authoritative ones: a value
read from a lease only reaches a typed column after a person approved it and it was promoted. The
panel currently prefers the raw material to the governed result, and when it has no raw material it
says nothing at all.

## Solution

Every Unit-bound and Building-bound office turn carries the **Unit record** or the **Building
record** (CONTEXT.md) alongside whatever the turn's commands returned. The operator can ask about
the flat or the building itself and get an answer from what the account holds, cited as
`כרטיס הדירה` or `כרטיס הבניין` and linked to that page. Paper is still searched and cited as
before. When the record and the paper disagree, the answer shows both values, says which one is the
record's, and never chooses between them silently. When neither the record nor the paper answers,
the turn refuses with a sentence that names both: `אין בכרטיס ובמסמכים תשובה לשאלה הזו.`

The portfolio bound and the tenant-facing path are unchanged.

## User Stories

1. As an operator on a Unit page, I want to ask the flat's size and get the area the account holds, so that I do not need a lease on file to answer a basic question about the flat.
2. As an operator on a Unit page, I want to ask which floor the flat is on and get the recorded floor, so that I can answer a contractor without opening the estate sheet.
3. As an operator on a Unit page, I want to ask how many rooms the flat has and get the recorded room count, so that the panel agrees with the sheet beside it.
4. As an operator on a Unit page, I want to ask whether the flat has a mamad and get the recorded answer, so that a yes/no fact the account holds is never refused.
5. As an operator on a Unit page, I want to ask the flat's tenure and get להשכרה, למכירה or נמכרה, so that I know whether the flat is in the letting pool.
6. As an operator on a Unit page, I want to ask which parking bay the flat was built with and get the built bay, so that I can answer a parking dispute from the building's plan.
7. As an operator on a Unit page, I want to ask which bay the current lease assigns and get the assigned bay, labelled as the letting's, so that the built bay and the assigned bay are never mistaken for one fact.
8. As an operator on a Unit page, I want a parking question to return both the built and the assigned bay when they differ, so that the difference is visible rather than hidden.
9. As an operator on a Unit page, I want the same built-versus-assigned treatment for the storage room, so that storage questions behave exactly like parking ones.
10. As an operator on a Unit page, I want to ask when the current letting ends and get the recorded end date, so that renewal questions do not depend on searching the lease.
11. As an operator on a Unit page, I want to ask whether the letting has an option and until when, so that I can answer an extension question from the governed value.
12. As an operator on a Unit page, I want to ask the current rent and get the recorded rent and currency, so that the answer is the approved value and not a fresh reading of the paper.
13. As an operator on a Unit page, I want to ask who the tenants are and get the active letting's parties by name and role, so that I can identify the household without opening the tenancy card.
14. As an operator on a Unit page, I want a flat with no active letting to say so plainly, so that "nobody lives here today" is an answer rather than a refusal.
15. As an operator on a Unit page, I want a field the account does not hold to be treated as not recorded, so that the model never infers an area or a floor from nothing.
16. As an operator on a Unit page, I want a question about a field that is not recorded to fall through to the paper, so that a lease that states the value can still answer it.
17. As an operator on a Unit page, I want a question about a field that is neither recorded nor on paper to be refused, so that a guess never reaches me as a fact.
18. As an operator on a Unit page, I want an answer drawn from the record to carry a `כרטיס הדירה` citation linking to the Unit page, so that I can see where the fact came from and check it.
19. As an operator on a Unit page, I want an answer drawn from both the record and a lease to carry both citations, so that each fact is traceable to its own source.
20. As an operator on a Unit page, I want a disagreement between the record and the lease — 82 m² recorded, 85 m² printed — to show both and name the record's as the current value, so that I can decide whether the record needs correcting.
21. As an operator on a Unit page, I want the panel never to write to the record when it finds a disagreement, so that the record only changes through the governed paths it already has.
22. As an operator on a Unit page, I want a question about another flat to be refused, so that the Unit bound does not silently widen to its neighbours' records.
23. As an operator on a Unit page, I want the refusal sentence to say neither the card nor the documents answer, so that I know both were consulted.
24. As an operator on a Unit page, I want lease questions to keep working exactly as they did, with Document-and-page citations, so that this change costs nothing the panel already did.
25. As an operator on a Building page, I want to ask the building's address, handover date or warranty end and get the recorded values, so that a building with no paper can still answer about itself.
26. As an operator on a Building page, I want to ask how many four-room flats the building has and get a count from the Unit lines, so that inventory questions do not need a spreadsheet.
27. As an operator on a Building page, I want to ask which flats are on a given floor and get them from the Unit lines, so that I can plan a visit.
28. As an operator on a Building page, I want to ask which flats are for sale or sold, so that tenure across the building is one question away.
29. As an operator on a Building page, I want to ask how many bays and storage rooms the building has and how many are assigned, so that I can answer whether one is free.
30. As an operator on a Building page, I want an answer about a specific flat's line to cite `כרטיס הבניין` and link to that flat's page, so that I can step from the building to the flat.
31. As an operator on a Building page, I want "who lives here" to keep coming from the lettings list and not from the record, so that occupancy has one source.
32. As an operator on a Building page, I want building paper questions — a protocol, a regulation — to keep searching Passages, so that nothing the panel answered before is lost.
33. As an operator on a Building page, I want a building with no paper and no active lettings to still answer record questions, so that a freshly seeded building is useful on day one.
34. As an operator on either page, I want record answers to persist in my thread with their citations, so that reopening the panel shows what I was told and where it came from.
35. As an operator on either page, I want a later turn to reload the record rather than trust an earlier answer in the thread, so that a corrected value is what the next answer uses.
36. As a VIEWER, I want the record-backed answers on the same terms as an OPERATOR, so that no new permission is needed to ask about a flat.
37. As the director, I want the portfolio panel unchanged, so that a cross-building question does not silently load every record.
38. As the director, I want no tenant path to receive a Unit record, so that the parties, rent and bays of a letting stay office-only.
39. As the director, I want the record to omit phones and ID numbers, so that the panel does not become a second contact book.
40. As the director, I want the golden set to grade record answers, conflicts and refusals, so that a prompt or model change that breaks them fails before it merges.

## Implementation Decisions

- **Estate gains one read command per record.** One reads the Unit record for a Unit id; one reads
  the Building record for a Building id. Each returns a typed value, not text. Both live behind
  estate's public contract and build on the read model the Unit and Building pages already use.
  Evidence calls them by name and never queries estate tables, the same discipline as the lettings
  list it already calls from tenancy.
- **Unit record contents.** Unit number; Building name and address; floor; rooms; area; mamad;
  tenure; the built bay and the built storage room by number. Under the letting active today (read
  through the scope module's active-today rule, not re-derived): start and end date, option end,
  rent and rent currency, the assigned bay and the assigned storage room, and each party's name and
  role. No phone, no ID number. When no letting is active today the record says so explicitly. Every
  field the account does not hold is present and marked not recorded (`לא רשום`) rather than
  omitted. Current values only; estate events are not read.
- **Building record contents.** The Building's name, address, city, project, handover date, warranty
  end and status. One line per Unit in it: number, floor, rooms, area, tenure, built bay, built
  storage room. Counts of bays and storage rooms in the Building, each with how many are assigned to a
  Unit or by an active letting. No parties and no rent — who is let today stays the lettings list,
  which the tool chooser still offers.
- **The office turn always loads the record on a Unit bound and a Building bound.** It is not a tool
  the chooser picks. The chooser is unchanged: a Unit bound still searches every turn; a Building
  bound still chooses search, list or both. The portfolio bound loads no record and is otherwise
  unchanged.
- **The refusal short-circuit narrows.** "No hits and no list → refuse without calling the model"
  now applies only to the portfolio bound. On a Unit or Building bound the answering model is always
  called and refuses when neither the record nor this turn's hits nor the list answer. The empty-roll
  sentence still applies only when the list was fetched and was empty and nothing else answers.
- **Refusal sentence.** Unit and Building bounds refuse with `אין בכרטיס ובמסמכים תשובה לשאלה הזו.`
  The portfolio bound keeps `אין במסמכים האלה תשובה לשאלה הזו.` Both are frozen strings.
- **Facts this turn.** The record loaded this turn is a fact source, as this turn's hits and list
  are. Thread text still only interprets the question; a record value that appears in an earlier
  answer is not a fact unless this turn's record carries it.
- **Disagreement.** The instructions require that a value present in both the record and a hit with
  different content is answered with both, the record's named as the current value, and both
  citations attached. The turn writes nothing to estate, tenancy or evidence beyond the thread.
- **Citation shape.** `OfficeCitation` (staff module, the thread's type) gains a record kind
  alongside the Document-and-page kind: the record kind names whether it is a Unit or a Building
  record and the id it links to. On a Building bound a citation of one Unit line links to that Unit.
  The thread already stores citations as JSON, so no migration; old rows read as Document citations.
  The answering schema gains a way for the model to cite the record (and, on a Building bound, which
  Unit lines); the turn validates those ids against the record it loaded and drops any it did not.
- **The panel renders the record citation.** On the Unit page and both Building pages a record
  citation renders as `כרטיס הדירה` or `כרטיס הבניין` and links to that Unit's or Building's page.
  The panel's layout, posts, permissions and `ask=unavailable` handling are unchanged.
- **Spec first.** SPEC-evidence's office turn (#113, #123) and SPEC-estate's office panel (#114,
  #121) are amended in the same change, before the code, to say all of the above.

## Testing Decisions

- **A good test here asks the office turn a question and asserts what came back** — refused or not,
  the text, the citations, what was persisted — and what the answering model was given. It does not
  assert how the record is assembled or which query read it.
- **Seam 1 — the office-turn command**, with the fake extractor the existing office-turn tests use.
  This is where the record's contents are proven: what the model input carries on a Unit bound and a
  Building bound (including `לא רשום`, built-versus-assigned, no active letting, no phone or ID),
  that the portfolio bound carries none, that the model is called on a Unit bound with zero hits,
  the new refusal sentence, record citations validated and persisted, invented ids dropped. Prior
  art: the existing office-turn tests and their Building list/search cases. The estate record
  commands are not given a second test seam of their own.
- **Seam 2 — the estate routes**, through the panel: a persisted record citation renders with its
  Hebrew label and links to the right page on the Unit page and both Building pages. Prior art: the
  estate route tests for the #114 and #121 panels.
- **Seam 3 — the golden set**, through the office-turn eval subject. New cases, each written red
  first: a Unit with no Documents answered from the record; record and paper disagreeing on area; a
  Building count question answered from Unit lines; a not-recorded field refused rather than guessed;
  another flat's question on a Unit bound refused. The existing office-turn cases are updated for the
  new refusal sentence and must still pass. The change touches a prompt and a tool definition, so the
  full golden set runs before merge.
- **Clicked before merge.** Restart `npm run dev`, open a seeded Unit with no documents on `:3000`,
  ask its size, follow the citation; repeat on a Building page.

## Out of Scope

- The portfolio bound: no record, no count across buildings.
- The history of record values (estate events): "what was the room count before" stays unanswered here.
- Any tenant-facing path, and the Tenancy bound.
- Writing to the record from the panel, or flagging a disagreement for correction.
- Phones, ID numbers and other contact data on the record.
- Lettings other than the one active today — drafts, ended lettings, a future signed letting.

## Further Notes

- The vocabulary was settled in the grilling session of 2026-10-13: **Unit record** and **Building
  record** are in CONTEXT.md.
- Plan mode applies: the change touches estate, evidence, staff and scope's read.
- The record is small (a Unit record is a few hundred tokens; a Building record at Ramle's 40 units
  is about forty short lines), which is why it is loaded every turn rather than offered as a tool the
  chooser could fail to pick.

## Comment — 2026-10-14

All four slices are closed: #227 (the Unit record's physical half), #228 (the letting active today), #229 (a disagreement between record and paper shows both) and #230 (the Building record). The portfolio bound and the tenant path are unchanged.
