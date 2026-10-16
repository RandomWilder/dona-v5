---
number: 245
title: The press writes the columns through a map in code, and shows what will not land
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 243
created: 2026-10-15
closed: 2026-10-15
---

## What

ADR-0016, SPEC-evidence *The column map*, SPEC-flows A2 step 7.

1. **The column map.** One constant in evidence, with the twelve lease targets and
   `lease_amendment.new_end_date`. `promoteExtractedField` reads its target from it. Every other
   guard is unchanged:
   - the approval stamp is required;
   - a half-priced pair is refused;
   - an occupied column is refused;
   - the write goes through tenancy's and estate's `applyPromotedField`;
   - the `promoted_to` stamp is written under the 0018 and 0029 triggers.
2. **One function says what lands.** Per approved mapped row, it returns where the row lands, or why
   it will not. The reasons are #175's:
   - the other rent half is not approved;
   - the number is not a Space in the Building;
   - the Unit already holds a different rooms or floor.

   The opening screen lists both groups, with the later-add link under `estate.write`. The press
   copies only the rows that land, so there is no savepoint that swallows `invalid` or `conflict`.
   The dates are written at insert, and the copy of an identical value only stamps.
3. **A failure the screen did not predict is legible.** `POST /documents/filing/:id/open` logs the
   KernelError's code and message, with no personal data. The page names the reason instead of
   "נסו שוב".
4. **Retire the second act:**
   - `POST /documents/:id/promote`;
   - the ledger's `קדם` and `החלף`;
   - the *לא הועבר* mark on הקריאה and the ledger.

   The tenancy card's mark becomes *על הדף*, a fact with its reason and with no button.
5. **Drop `field_promotion`:**
   - one migration drops the table and its CHECK;
   - remove the seed rows in `seed-catalogue.ts`;
   - estate's two readers (`listApprovedCapturesForTenancy`, `uncarried.ts`) take the map, injected
     from evidence's contract, instead of joining the table;
   - A3's confirm keeps working through the map.

## Acceptance

- [x] **Red first:** with `field_promotion` empty, the press succeeds and writes:
      - the dates;
      - the rent pair and the option end;
      - the eligibility group;
      - the bays and storage that exist as Spaces;
      - rooms and floor on an empty Unit.

      Each written row is stamped.
- [x] **Red first:** a rent amount with its currency unapproved, and a bay number that is not a
      Space, are listed on the opening screen as not landing. The press writes the draft without
      them and does not fail.
- [x] **Red first:** a failure inside the press that is not a refusal is logged with its code, and
      the page names it.
- [x] A3 confirms an addendum and writes `new_end_date` with the table gone.
- [x] There is no `/documents/:id/promote` route and no `קדם` in any view. The guard test that
      lists routes is updated.
- [x] The full golden set is not required: no prompt, model, retrieval or tool definition changes.
- [x] `npm test` is green.
- [ ] A rolled-back dry run of the press against staging succeeds for `01a13956`.

## Comment — 2026-10-15

The map is a constant. The press writes the rows that land and stamps them, and a half rent or a missing bay is listed and skipped. An eligibility value that is not a code is logged and named on the page, and the draft is not left behind. `field_promotion` is dropped. `קדם` is gone. The opening screen was not clicked on :3000. The staging dry run for `01a13956` was not run: it writes real staging data, and it was not asked for.
