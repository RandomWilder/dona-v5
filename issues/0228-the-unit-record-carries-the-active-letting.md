---
number: 228
title: The Unit record carries the letting active today
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed:
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

- [ ] With a letting active today, the model input carries its dates, option end, rent and currency, assigned bay and storage, and parties by name and role.
- [ ] No phone and no ID number reaches the model.
- [ ] With no letting active today — including a flat with only a draft, an ended or a future letting — the record says `אין השכרה פעילה` and carries no letting fields.
- [ ] Built and assigned bay (and storage) arrive as two labelled facts.
- [ ] Golden case, red first: a parking question on a Unit whose assigned bay differs from its built bay answers both. The full golden set passes.
- [ ] Clicked on `:3000`: a let Unit answers its tenants and end date from the record, citing `כרטיס הדירה`.

## Blocked by

- #227
