---
number: 179
title: Two bays, each assigned on its own
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 178
created: 2026-10-01
closed: 2026-10-01
---

## Parent

#178 — A lease that names two bays assigns each.

## What to build

A lease that prints two bay numbers, separated by a plus or a comma, becomes two lines the operator approves separately. The first number is the assigned bay. The second number is a second assigned bay, its own line. Spaces around the separator do not matter, and the printed order is the order of the lines. Each line is digits only.

Approving a line assigns that bay when the Building has a parking space of that name, and does not wait on the other line. The letting shows each assigned bay on its own line. A letting with one bay shows no empty second line.

A name that is not a bay in the Building leaves that line approved and not on the letting. The existing note names that one number and the Building, and for someone who may add inventory it opens later-add with that number ready. The other line is unchanged. The lease does not create a Space, and the flat's built bay is untouched.

A lease that names one bay is unchanged. A lease that names three keeps the first two and does not assign the third. A glued pair such as `234,237` is not a value that can be approved.

The letting's rules and the lease-reading rules are updated in the same change, before the behaviour.

## Acceptance criteria

- [x] A parking phrase with a plus, and one with a comma, each become two lines in printed order, and the operator approves them separately.
- [x] Approving the first line assigns that bay when it exists, even if the second line is not approved.
- [x] Approving the second line assigns that bay when it exists, even if the first line could not be assigned.
- [x] Both approved lines are on the letting when both names exist, each on its own line, and assigning one does not replace the other.
- [x] A second bay already on the letting is occupied for that line only.
- [x] A missing bay stays approved, the note names that number alone, and later-add is prefilled with it for someone who may add inventory. A viewer sees the sentence and no link.
- [x] After the Space is added, קדם carries that line onto the second assigned bay.
- [x] One bay is still one line, and the letting shows no empty second line.
- [x] Three numbers yield only the first two lines. The third is not stored and not assigned.
- [x] The built bay on the flat is unchanged.
- [x] A one-bay reading still scores as one bay.

## Comment — 2026-10-01

A parking phrase with a plus or a comma is stored as two digit lines before anyone approves it, in printed order. Approving one line assigns that bay when the Building has it, and does not wait on the other line and does not replace it. A missing number stays approved; the note names that number alone, and later-add is prefilled with it for someone who may add inventory. A viewer sees the sentence and no link. After the Space is added, קדם carries that line onto the second assigned bay. One bay stays one line. Three numbers keep the first two. A glued pair is not left as a ledger value, including when the second line arrives already glued, when that line is only the third number, and when the first line is absent. The flat's built bay is unchanged. The golden set still scores each specimen's one bay as one bay: 594 and 574, and the second line was not returned. The app asks for a Google sign-in, so this was not clicked on :3000. The filing page, the letting, the ledger, later-add and קדם were read through the approval routes.

## Blocked by

None (can start immediately).
