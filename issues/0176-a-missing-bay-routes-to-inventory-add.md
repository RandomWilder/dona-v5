---
number: 176
title: A bay or storage number missing from the Building routes to נכסים' add, and never 400s
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [175]
parent: 173
created: 2026-09-30
closed: 2026-09-30
---

## Parent

#173 — An approved lease carries onto its letting.

## What to build

On 30 Sep 2026 a `קדם` on bay 552 answered a bare `400` because the Building held bays 21 and 24
only. The director confirmed 552 and storage room 505 are correct; the inventory is what is missing.

After this ticket, the *not in this building* reason (from #175) links to the נכסים Building page's
later-add (A17), with the kind (parking or storage) and the number preselected where the form accepts
it. An administrator adds the Space there under `estate.write` (audited `estate.inventory_add` as
today). Back on the ledger, `קדם` carries the approved value and the mark disappears.

Pressing `קדם` on the ledger for a number that is still not in the Building re-renders the ledger with
the reason sentence beside the row — the same shape the existing overwrite confirmation uses — rather
than an error page. The lease never creates a Space: A17's rule that paper fills the inventory and
does not create it stands.

## Acceptance criteria

- [x] The *not in this building* sentence, on the letting page and the ledger, links to A17 later-add
      for that Building with kind and number preselected (or, if the form cannot take them, to the
      Building page's add section).
- [x] A VIEWER sees the sentence without the link (no `estate.write`).
- [x] `קדם` on a number not in the Building returns the ledger with the sentence, not a 4xx error
      page.
- [x] After adding the Space through A17's route, `קדם` lands the value on the letting's assigned bay
      / storage, and the letting page shows it.
- [x] No path creates a `PARKING` or `STORAGE` Space from a lease.
- [ ] Clicked on `:3000`: approve bay 552 on a Building without it → follow the link → add 552 →
      `קדם` → letting shows חניה 552.

## Comment — 2026-09-30

A bay or storage number that is not a Space in the Building is now a link, for a reader who holds estate.write, to that Building's נכסים later-add: one of that kind, first number the named one, and the add section open. A number the form cannot take links to the add section with nothing filled in. A viewer sees the same sentence and no link. Pressing קדם while the number is still missing re-renders the ledger with that sentence. It does not answer 400, and it does not create the Space. After the Space is added on נכסים, the same קדם lands it on the letting and the mark is gone. The app asks for a Google sign-in, so this was not clicked on :3000. The letting page, the ledger, the later-add form and קדם were read through the approval routes.

## Blocked by

- #175 — the reason sentence this ticket links from.
