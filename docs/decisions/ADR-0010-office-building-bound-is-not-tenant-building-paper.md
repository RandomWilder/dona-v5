# ADR-0010 — The office Building retrieval bound is not tenant Building paper

- **Date:** 2026-09-17
- **Status:** accepted
- **Context ticket:** [#120](../../issues/0120-building-office-retrieval.md), under [#111](../../issues/0111-office-retrieval-on-the-unit.md)
- **Does not touch:** the isolation join, tenant WhatsApp retrieval (unbuilt), or the Passage search cap.

## The decision

1. **The office Building retrieval bound is the wide bag.** A search with that bound may consider Documents linked to the Building, to a Unit in it, or to a letting of a Unit in it. That is the bound the Building page’s office retrieval panel names.
2. **Tenant stance cannot use that bound.** The refusal already on the search command stays. The office list command (active lettings in a Building) is not a tenant tool and is not assembled on a tenant channel.
3. **A later tenant-facing bound is Building paper only** — Documents linked to the Building itself (rules, regulations, handover), never a neighbour’s lease. It is a different bound, not a filter on this one.

## Why two bounds

The office asked for one level up from the Unit panel: the same questions, a wider retrieve, plus a complete roll of who is let today. Collapsing that bag with “what may a tenant know about the building” looks tidy and is how a neighbour’s Passage reaches a household. Rule 1 already allows a tenant their own paper and a shared knowledge base; per-building regulations are neither the office bag nor portfolio-global. Keeping the names distinct is cheaper than one missed omit.

## Considered options

- **One Building bound, tenant path omits Unit paper.** Rejected: the omit is a second brain; a bug is a leak.
- **Tenant uses the office bound after WhatsApp ships.** Rejected: the office panel would become the tenant bound by habit.

## Consequences

- Code and specs that say “Building retrieval bound” mean the office bag. Tenant building rules wait on a bound that does not exist yet, named **Building paper** in the glossary.
- Adding tenant stance to the office Building bound, or offering the list command outside staff × Building, is a new decision, not a silent follow-up in #120.
