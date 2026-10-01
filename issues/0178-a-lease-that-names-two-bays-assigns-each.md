---
number: 178
title: A lease that names two bays assigns each
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-01
closed: 2026-10-01
---

## Problem Statement

On 1 Oct 2026 the director filed a lease on staging, approved the reading, and activated the
letting. Storage room 50 was carried. The parking was not, and the letting correctly said so.

The page prints one phrase, `חניה שמספרה 234 + 237`. The reading stored that as one parking
value, `234,237`, and approved it as that one value. Assignment looks for a single parking name
equal to the whole value. The Building has bays named `234` and `237`. It has no bay named
`234,237`. The missing-bay note therefore named the glued string, and neither bay was assigned.

The director wants a second bay to be its own line, and a second storage room to be its own line.
Each line is one name. Each line is assigned to the Space of that name in the Building when that
Space exists. A missing name stays off the letting, on that line only, with the note that already
exists.

## Solution

A lease that names two bays produces two lines. The first number is the assigned bay, as today.
The second number is a second assigned bay, its own line. Storage is the same pair: the assigned
storage, then a second assigned storage.

The split happens when the reading is stored, so the operator sees and approves two lines, not
one string with a comma in it. A comma or a plus between two numbers is what makes the second
line. The page that failed used a plus; the stored reading had already turned that plus into a
comma. Both separators count. Each line is digits only.

Approving a line carries that line, and only that line. If the named Space exists in the
Building, it is assigned. If it does not, the approval stands, that line stays approved and not
on the letting, and the existing sentence names that one number and the Building. The other line
is unaffected. The lease still does not create a Space.

A lease that names one bay is unchanged: one line, one assignment, no second line.

## User Stories

1. As an operator, I want a lease that prints two bay numbers separated by a plus to become two parking lines, so that I approve each bay rather than one glued name.
2. As an operator, I want a lease that prints two bay numbers separated by a comma to become the same two lines, so that a comma and a plus mean the same thing.
3. As an operator, I want spaces around the separator ignored, so that `234 + 237` and `234,237` are the same two bays.
4. As an operator, I want the first printed number on the first line and the second printed number on the second line, so that the order on the page is the order on the letting.
5. As an operator, I want each line to hold digits only, so that a bay number is still a bay number.
6. As an operator reading a lease that names one bay, I want a single parking line and no second line, so that today's leases look as they do now.
7. As an operator, I want the same pair of lines for storage, so that two storage rooms are handled the same way as two bays.
8. As an operator reading a lease that names one storage room, I want a single storage line and no second line, so that a lease like the one just filed still carries storage 50 alone.
9. As an operator, I want to approve the first bay without approving the second, so that signing one line does not sign the other.
10. As an operator, I want approving the first bay to assign it when that bay exists in the Building, even if I have not approved the second, so that one signature carries one bay.
11. As an operator, I want approving the second bay to assign it when that bay exists, even if the first could not be assigned, so that each line stands on its own.
12. As an operator, I want both bays on the letting when I have approved both and both names exist, so that the household is recorded as holding the two bays the lease grants.
13. As an operator, I want both storage rooms on the letting on the same rule, so that two storage rooms land the same way.
14. As an operator approving a second bay that is not a bay in this Building, I want the approval to stand and only that line to stay off the letting, so that a missing second bay does not undo the first.
15. As an operator, I want the missing-bay sentence to name that one number, so that the note says `237` and not `234,237`.
16. As an operator with estate write, I want that sentence to open נכסים' later-add with that one number ready to add, so that the link works for a real bay number.
17. As an operator who then adds the missing bay and presses קדם, I want that line carried onto the second assigned bay, so that fixing the inventory finishes the line I already approved.
18. As an operator looking at the letting, I want each assigned bay on its own line, so that I can see both without opening the lease.
19. As an operator looking at a letting with one bay, I want no empty second line, so that a second line appears only when the lease named a second bay.
20. As an operator, I want the same two lines for assigned storage on the letting, so that storage reads the same way.
21. As an operator, I want an approved second bay that was not carried to show the existing not-on-the-letting mark, so that the mark means the same thing on the new line.
22. As a viewer without estate write, I want the missing-bay sentence with no link, so that the existing permission on that sentence still holds.
23. As an operator, I want the first bay's assignment left untouched when the second bay is assigned, so that the two lines never overwrite each other.
24. As an operator, I want a second bay that is already on the letting to count as occupied for that line only, so that a later reading cannot replace it unless I confirm the replace.
25. As an operator, I want the built bay on the flat left untouched, so that a lease still does not rewrite what the plan attached to the Unit.
26. As an operator, I want the built storage on the flat left untouched, for the same reason.
27. As an operator, I want a lease that names three bay numbers to yield only the first two lines, so that there is no third line and the third number is not assigned.
28. As an operator, I want the reading no longer to store a glued pair as one parking name, so that `234,237` is not a value I can approve.

## Implementation Decisions

- The letting gains a second assigned bay and a second assigned storage. Each is a nullable pointer at a Space, constrained to `PARKING` and `STORAGE` respectively, by the same composite-key technique the first assigned bay and the first assigned storage already use. The first columns stay as they are.
- Two new catalogue fields sit beside the existing parking and storage numbers. The second parking number promotes to the second assigned bay. The second storage number promotes to the second assigned storage. Neither promotes to the Unit. The Hebrew label on each second line is distinct from the first, so the ledger does not show two rows with the same name.
- A captured parking value, and a captured storage value, that contains exactly one separator and two digit-groups is stored as two lines before anyone approves it. The separator is a comma or a plus. The first group is the existing field. The second group is the new field. A value with one number is stored as today, and the second field has no row.
- The reading instructions say the same thing, so a new reading returns two findings rather than one glued string. The split above still runs, because this lease's reading had already turned a plus into a comma by the time it was stored. Instructions alone do not repair a value that comes back as one string.
- A list of three or more numbers keeps the first two as the two lines. There is no third field and the further number is not stored and not assigned.
- Carry, occupancy, and the missing-Space refusal apply per line. The first bay being set does not occupy the second line, and the reverse. A name that is not a Space in the Building refuses that line only. The sentence and the later-add link receive that line's number alone, which is why the add form can prefill it: a glued string is not a number the form accepts.
- The letting page shows the second assigned bay, and the second assigned storage, each on its own line, and only when that line is set. The not-on-the-letting mark is the one already used for the first bay and the first storage room.
- Module specs for the letting and for the lease reading are updated in the same change, before the behaviour. The domain names stay assigned bay and assigned storage; the second of each is a second line, not a new kind of Space.
- No new write path. Promotion of the new fields uses the command that already copies an approved number onto the letting. The landlord's existing reassign of the first bay is unchanged.

## Testing Decisions

One seam: the path that already approves a lease reading and carries a parking number and a storage number onto the letting, including the page the operator sees and the missing-Space note. That path is the test. A reading whose parking phrase is two numbers (plus, and comma) is the new case; the letting's two lines, or one line plus the note on the other, are the result. Storage is the same case, not a second harness. A one-number reading still has one line and no second.

The split is deterministic, so it is proved there without a model. The instruction change is a prompt change, so the existing golden set runs, and the single-bay fixtures stay single-bay. A good test asserts the lines on the letting and the note the operator reads. It does not assert how a separator was tokenised.

## Out of Scope

- A third bay or a third storage room, and any column beyond the second line.
- Choosing which two of three numbers to keep by any rule other than printed order.
- A separator other than comma and plus. A hyphen is not a list.
- Reassigning the second bay or the second storage by hand. The first bay's reassign is unchanged.
- Refusing a bay because another letting already holds it.
- Creating a Space from the lease, or writing the built bay or the built storage.
- The filing tab, the annex read, rent, dates, rooms, or floor.

## Further Notes

The staging letting from 1 Oct 2026 holds storage 50 and no bay. Its approved parking value is the single string `234,237`, taken from `חניה שמספרה 234 + 237` on page 14. Bays `234` and `237` are both names in that Building. This spec does not backfill that letting; the next reading of a lease that names two bays is what gains the two lines.

## Comment — 2026-10-01

Closed. Both children are closed, and they do what this spec asked.

- [#179](0179-two-bays-each-assigned-on-its-own.md) — a plus or a comma becomes two bay lines, each assigned on its own.
- [#180](0180-two-storage-rooms-the-same-way.md) — the same two lines for storage.

One correction on the split. When the first line was already a single number and the second line was a list of the remaining numbers, the further number was kept and the next number was dropped. A second line `237,240` beside a first line `234` is now stored as `237`. A second line that repeats the whole list still keeps the second group. The third number is still not stored.

The approval routes were read for the letting, the ledger, later-add and קדם. A one-number lease is still one line. The flat's built bay and built storage stay untouched. The screen was not clicked on :3000. The app asks for a Google sign-in. The golden set was run with the children and the required gate passed; this correction does not change the reading instructions. The staging letting from 1 Oct 2026 is not backfilled. No next child.
