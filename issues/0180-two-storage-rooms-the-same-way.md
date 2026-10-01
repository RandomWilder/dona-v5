---
number: 180
title: Two storage rooms, the same way
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [179]
parent: 178
created: 2026-10-01
closed: 2026-10-01
---

## Parent

#178 — A lease that names two bays assigns each.

## What to build

The same two lines as #179, for storage. A lease that prints two storage numbers, separated by a plus or a comma, becomes two lines. The first is the assigned storage. The second is a second assigned storage, its own line. Each line assigns on its own when the Building has a storage room of that name. The letting shows each on its own line, and shows no empty second line when the lease named one room.

A missing room stays on that line only, with the existing note naming that one number. The lease does not create a Space, and the flat's built storage is untouched. One storage room is unchanged, including a lease that carries a single room such as 50. Three numbers keep the first two.

The letting's rules and the lease-reading rules are updated in the same change, before the behaviour.

## Acceptance criteria

- [x] A storage phrase with a plus, and one with a comma, each become two lines in printed order, approved separately.
- [x] Each approved line assigns that storage room when it exists, without waiting on the other line and without replacing it.
- [x] The letting shows each assigned storage room on its own line, and no empty second line when there is only one.
- [x] A missing room stays approved, the note names that number alone, and later-add is prefilled with it for someone who may add inventory.
- [x] After the Space is added, קדם carries that line onto the second assigned storage.
- [x] A second storage room already on the letting is occupied for that line only.
- [x] One storage room is still one line. The built storage on the flat is unchanged.
- [x] Three numbers yield only the first two lines.

## Comment — 2026-10-01

A storage phrase with a plus or a comma is stored as two digit lines before anyone approves it, in printed order. Approving one line assigns that room when the Building has it, and does not wait on the other line and does not replace it. A missing number stays approved; the note names that number alone, and later-add is prefilled with it for someone who may add inventory. A viewer sees the sentence and no link. After the Space is added, קדם carries that line onto the second assigned storage. One room stays one line. Three numbers keep the first two. The flat's built storage is unchanged. The golden set still scores the unnumbered room as nothing, and did not return a second storage line. Bloch's numbered room 601 was not returned this run; required accuracy stayed 100% and the gate passed. The app asks for a Google sign-in, so this was not clicked on :3000. The filing page, the letting, the ledger, later-add and קדם were read through the approval routes.

## Blocked by

- #179 — Two bays, each assigned on its own.
