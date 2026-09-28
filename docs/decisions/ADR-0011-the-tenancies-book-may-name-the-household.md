# ADR-0011 — The tenancies book may name the household

- **Date:** 2026-09-27
- **Status:** accepted
- **Context ticket:** [#161](../../issues/0161-the-tenancies-book.md)
- **Does not touch:** search, חוזים לא שלמים, the נכסים tile, or any tenant-facing channel.

## The decision

1. **שכירויות is the first list allowed to name a household.** Every row names the main tenant, including a draft and a letting that has ended. The name is read off the letting: the primary tenant, otherwise the first person on it, otherwise the place alone. It is not stored on the Unit.
2. **The Unit page names only the household that counts today.** That name is taken from the live letting. A draft on the same flat, and a letting that has ended, stay a chip and lease dates. A vacant flat shows no tenant name.
3. **Search, the work list, and the נכסים tile stay nameless.** A name on the tile is a later change. Nothing in the book depends on it.

## Why this list and not the others

Every portfolio list so far refused a party name, and the refusal survived the session that put those screens behind a sign-in. The office still needs one place that is the letting itself: who, where, when, and which chip. That place is שכירויות. The work list answers what needs a person today, and the tile answers whether the flat is let. Putting a household on those would make every grid a roll of names, which is the thing the earlier refusal was for.

The tenancy page already showed the name to anyone who can open it. The book uses the same permission. A viewer who can read the page can read the row.
