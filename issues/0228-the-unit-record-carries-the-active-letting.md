---
number: 228
title: The Unit record carries the letting active today
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed: 2026-10-14
---

## Parent

#226 — The office turn reads the Unit record and the Building record.

## What to build

The Unit record gains its letting half. Under the letting active today — read through the scope
module's active-today rule, not re-derived — it carries the start and end date, the option end, rent
and rent currency, the assigned bay and assigned storage room, and each party's name and role. No
phone, no ID number. When no letting is active today the record says so explicitly
(`אין השכרה פעילה`), so "who lives here" on an empty flat is an answer, not a refusal.

The assigned bay and storage are labelled as the letting's, beside the built ones from #227, so a
parking question answers both when they differ and they are never merged into one fact. Drafts,
ended lettings and future signed lettings are not on the record.

SPEC-evidence's office-turn paragraph is amended first.

## Acceptance criteria

- [x] With a letting active today, the model input carries its dates, option end, rent and currency, assigned bay and storage, and parties by name and role.
- [x] No phone and no ID number reaches the model.
- [x] With no letting active today — including a flat with only a draft, an ended or a future letting — the record says `אין השכרה פעילה` and carries no letting fields.
- [x] Built and assigned bay (and storage) arrive as two labelled facts.
- [x] Golden case, red first: a parking question on a Unit whose assigned bay differs from its built bay answers both. The full golden set passes.
- [x] Clicked on `:3000`: a let Unit answers its tenants and end date from the record, citing `כרטיס הדירה`.

## Comment — 2026-10-14

The Unit record now has a letting half. `readUnitRecord` takes the clock and the asking staff
account. It asks scope's new `resolveActiveTenancy` which letting counts today. That function reads
`tenancy` with the same `TENANCY_ACTIVE_TODAY` string, so the rule is still one string in one file.
Tenancy's `getTenancy` then reads the letting's dates, option end, rent and currency, and the bays
and storage rooms it assigns. Scope's `resolvePartiesInUnit` gives the parties by name and role, and
it writes the access line. The record carries no contact column and no ID column. The #227 test
that seeds a phone and an ID on an active letting now covers this half too, and it passes.

Code review found that `resolvePartiesInUnit` on its own would have missed something. It reads the
`occupancy` view, which inner-joins `tenancy_party`, so an ACTIVE letting with no party yet would
have read as `אין השכרה פעילה`. Hence `resolveActiveTenancy`, which is documented in SPEC-scope. A
test was red first: an active letting with no parties now shows its dates, and its parties read
`לא רשום`.

The model sees `חניה (מהשכירות)` and `מחסן (מהשכירות)` beside the `מהבנייה` lines. A missing letting
field reads `לא רשום`. With no letting active today, the record says `השכרה: אין השכרה פעילה` and
carries no letting line. Tests cover a vacant flat, a draft only, an ended letting and a future
ACTIVE letting. The prompt now says the two bays are two facts, that `אין השכרה פעילה` is an
answer, and that a party marked `ערב` is a guarantor who does not live in the flat.

Golden case 014 asks a parking question on `record-unit`, whose built bay is 14 and whose letting
assigns 22. The keyed run passed 14/14 once, against an earlier wording of the prompt. Red first
was shown offline: the old turn never passes bay 22 to the model, so the case cannot pass there.
OpenAI then returned `429 insufficient_quota` (`credit_balance_exhausted`). Two things are still
open:

- The keyed golden run against the final prompt, red first included.
- The click on `:3000`.

A partial click on `:3001` used a fresh server, because `:3000` belonged to another session. It
reached the panel on Unit 1 at בניין מלאות and ended in `ask=unavailable`, which was the quota.
`readUnitRecord` against that Unit's local data returned the active letting, 2026-09-01 to
2027-08-31, with party `משק בית נכנס` as primary tenant. It excluded the letting that ended early
(2025-10-01 to 2026-12-31).

## Comment — 2026-10-14, after the top-up

Red first, keyed: case 014 ran against the final code with the #227 office turn put back. It went
13/14, and 014 failed with `expected the answer to contain "22"`.

Green, keyed, against the final prompt: golden 14/14, sorter 14/14, extraction required 14/14 and
optional 42/46. Three runs before that were cut short by intermittent
`429 credit_balance_exhausted` while the top-up settled. They had no grading failure, and every
case that threw in one of them passed in another.

Clicked on a fresh server after a restart. It ran on `:3001` because another session held `:3000`;
same code and same database. The flat was Unit 1 at בניין מלאות. The question was
`מי השוכרים בדירה ומתי מסתיימת השכירות?` and the answer named `משק בית נכנס — שוכר ראשי` and the end
date `2027-08-31`. It cited `כרטיס הדירה`, which links to `/estate/units/<id>`. The letting that
ended early was not mentioned. The model also said the tenants' names were not recorded, because
that local party's name is a placeholder ("incoming household"). The click used a locally minted
test-operator session, which was removed afterwards.

## Blocked by

- #227
