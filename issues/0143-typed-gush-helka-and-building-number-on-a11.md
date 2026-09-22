---
number: 143
title: "A building has nowhere to type gush, helka, and building_number"
status: closed
labels: []
assignee: asafwilder
blocked_by: [140]
parent: 142
created: 2026-09-22
closed: 2026-09-22
---

## What to build

Three nullable text columns on `building` — `gush`, `helka`, `building_number` — filled on A11 and
shown on the building page. None of them is unique. They are identifiers an operator copies off a
tabu extract or a plan, not values a lease establishes, and they are not promotion targets.

`helka` is a list stored as text (`חלקות 43, 46` on one specimen, order varying by page). An integer
column is wrong on the first building we own. `building_number` is a fact worth holding, not a key:
`206` is meaningful inside one project and collapses on a standalone building, and a second unique
key beside `address_key` is two writers' worth of disagreement.

Blank on A11 writes null. The register importer and A13 do not invent values for columns the file
and the apartment screen do not carry.

**One migration, three nullable columns, no unique index.** Spec edit before the migration
(`SPEC-estate.md`, A11 in `SPEC-flows.md`). Plan mode — this is a schema change. Click A11 and the
building page on `:3000` after a `npm run dev` restart.

This is step 2 of [#142](0142-track-a-the-place-a-fact-is-true-of.md). Do not declare lease fields,
do not promote, do not touch `estate_event` or the assigned bay.

## Acceptance criteria

- [x] `building` carries `gush`, `helka` and `building_number`, all nullable text, none unique
- [x] A11 accepts all three, blank-to-null; the building page shows what was typed
- [x] A building saved with all three blank still saves; the columns are optional
- [x] The plan-shaped import and the register importer still run; they write null where they have
      no value
- [x] Specs updated in the same change; screen clicked after a `dev` restart

## Related

[#142](0142-track-a-the-place-a-fact-is-true-of.md) acceptance line 2.
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md)
§5 and §8. Blocked by #140 (closed).

## Closed

One migration (`0037_building_parcel_identifiers.sql`): three nullable text columns on `building`,
no unique index. A11 fills them; blank is null on create and on a re-post of the same address. The
building page shows a value that was typed and hides a blank. Plan-shaped import and the register
importer omit the keys, so a first write is null and a re-run does not wipe a number typed later.
A13 rebuilds the building from its own row and does not invent values.

Clicked on `:3000` after a `npm run dev` restart: A11 with גוש `6533`, חלקה `43, 46`, מספר בניין
`206` wrote the three columns and the building page showed them.

