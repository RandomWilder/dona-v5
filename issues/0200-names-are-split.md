---
number: 200
title: "Names are split: given and family for a person, legal for a company"
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

A person's name is stored as a given name and a family name, a company's as a legal name, and the
display name every screen reads today is computed from them rather than typed. Everywhere a party is
written — the register import, the lease flow's confirmation screen (A2), the calls tab's commands —
writes the split fields. The property tile shows the household's real family name instead of the
last word of the full name, so "בן דוד" is no longer shown as "דוד".

The spec edit comes first, in this change: SPEC-parties (the new columns, the CHECK, the generated
display name, the changed command shapes), SPEC-register (the split columns and the rejection of a
combined name), SPEC-flows (A2's confirmation screen).

The generated register is regenerated with split names rather than converted: its generator already
picks a first and a last name. No existing name is split by guessing anywhere.

## Acceptance criteria

- [x] `party` has `given_name` (nullable), `family_name` and `legal_name`, all marked `-- pii`, in an append-only migration with no backfill in the same file.
- [x] A CHECK rejects a PERSON without a `family_name` or with a `legal_name`, and a COMPANY without a `legal_name` or with either person name. Schema tests show each rejection.
- [x] `full_name` is a stored generated column: given and family joined by one space for a person, the family name alone for a person with no given name, the legal name for a company. Schema tests cover all three. Every existing reader of `full_name` is unchanged.
- [x] `createParty` and `upsertParty` take the split fields; every caller and test fixture is updated; the parties module still depends on the kernel only.
- [x] The register format carries `given_name` and `family_name` for a PERSON row and `legal_name` for a COMPANY row. A row with only a combined name is rejected with its line number, and the importer tests show it.
- [x] The generated register is regenerated with split names and imports cleanly; re-running the import is still a no-op.
- [ ] A2's confirmation screen shows given name and family name for each household member, pre-filled from the extraction, and what the human confirms is what is written. Clicked on `:3000`.
- [x] The property tile reads `family_name`; the last-word guess is deleted. Clicked on `:3000`.
- [x] The isolation, guarantor and recycled-number policy cases pass unchanged.

## Comment — 2026-10-11

The occupied tile on בניין מלאות, דירה 1, was opened on `:3000`. That letting is active and the party's family name is still empty, because no existing name was split by guessing. The tile shows the dates and the status, and not the last word of the display name.

A filed lease's ledger opens and says the name approval will appear there. This database has no unapproved household-name reading, so the given-name and family-name fields were not on a live page. The addendum screen test covers a stored family name of more than one word.

## Comment — 2026-10-11

Closed. The split columns, the check, the generated display name, the register, the confirmation fields and the property tile are in. The live click of the given-name and family-name fields stays unchecked: this database has 3,488 leases and no extracted household-name reading, so the filing ledger says the approval will open there and the two fields are not on a page. That click does not hold the next ticket.

## Blocked by

None (can start immediately).
