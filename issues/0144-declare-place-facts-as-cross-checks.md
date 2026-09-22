---
number: 144
title: "The residual place facts are declared as cross-checks, not promotion targets"
status: closed
labels: []
assignee: cursor
blocked_by: [143]
parent: 142
created: 2026-09-22
closed: 2026-09-22
---

## What to build

Seed rows, at a new `effective_from`. **No migration. No promotion targets.**

Declare what the two specimens print that now has somewhere correct to land or to check against:

- `rooms` and `floor` — the lease recites them; the unit and its space already hold them. Declared
  so they extract and score. Not promoted on this ticket.
- `gush`, `helka`, `building_number` — **cross-checks only**, asserted against the typed building
  from #143, the same shape as the fixture's arithmetic identities. The lease recites the land; it
  does not establish it.
- `apartment_type` — capture and score. It is a tender typology and a drawing title-block, not a
  column. The baseline should say whether the reader can see a title block at all.
- `has_storage` and `storage_space_number` — capture and score as readings. `has_storage` is derived
  from `unit.storage_space_id IS NOT NULL` after #140; it is not a column. A storage room with no
  number is a real case (`pinchot`).

**Not this ticket:** `parking_space_number`. A declaration invites a promotion, and the assigned bay
does not exist until #146. Leave those two fixture values unscored until then.

On `helka`, compare **sets**, never strings: `43,46` and `46,43` pass; `43,47` fails. A
cross-check failure does **not** block an operator from approving the reading. It is a scorer
assertion, not a gate.

Re-measure the golden set (at least eight keyed runs, ranges not means). The reader has never been
asked for these.

This is step 3 of [#142](0142-track-a-the-place-a-fact-is-true-of.md).

## Acceptance criteria

- [x] The keys above exist as seed rows at a new `effective_from`; no migration is written
- [x] None of them is a `field_promotion.target`
- [x] `parking_space_number` is still not declared
- [x] A `helka` cross-check passes on `43,46` and on `46,43`, and fails on `43,47`
- [x] A cross-check failure does not block approve
- [x] The golden set is re-run, judged over at least eight keyed runs, comparing ranges rather than
      means
- [x] The residual that is this track, minus `parking_space_number`, is scored; the three out-of-scope
      keys (`security_structure`, `index_base_month`, `index_publication_date`) remain unnamed here

## Related

[#142](0142-track-a-the-place-a-fact-is-true-of.md) acceptance lines 3–5 and 9 (the re-measure).
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md)
§5, §8, §9. Blocked by #143 — a cross-check needs a typed side.

## Closed

Seed rows at `effective_from` 2026-09-22. No migration. None of the new keys is a promotion target.
`parking_space_number` stays undeclared. Helka compares sets. A mismatched `gush` still approves.

**Eight keyed runs, `gpt-5.6-luna`, `reasoning: medium`.** First pass asked the reader for the new
keys; `bloch` returned `gush`, `helka` (`46,43`) and `apartment_type=B1` every run, so those three
were keyed onto the fixture (they were on the paper and had been omitted). Second pass, after that
and a hint that stopped teaching `storage_space_number=0`:

| group | range | denominator |
|---|---|---|
| required | 92.9–100.0 | 14 |
| optional | 93.2–97.7 | 44 |
| contradictions | 1–3 | ceiling still 7 |
| not declared | 5 | parking ×2, plus the three out-of-scope keys |

Parcel cross-checks held on every run. Ratchet floors left where #129 set them. Title block: `BG`
and `B1` both matched.

## Comment — 2026-09-22

Closed as above. Map #142 frontier becomes #145.
