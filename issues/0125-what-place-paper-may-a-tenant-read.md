---
number: 125
title: "What place paper may a tenant read for their own flat"
status: open
labels: [needs-triage]
assignee:
blocked_by: []
parent: 124
created: 2026-09-21
closed:
---

## What is open

#124 gave the tenant a Tenancy bound and made it strict on purpose: **`TENANCY` links only**. A
tenant reaches the paper linked to their own household and nothing else. That deliberately excludes
paper linked to the flat by a `UNIT` link — an inspection report, a handover protocol, a maintenance
record — **even during their own term, and even though the document is about the flat they live in.**

The strictness was the right first cut and the reason is recorded in #124: widening a bag later costs
a filter, and narrowing one after a tenant has already read something costs a disclosure. So the
door was closed all the way and the question was deferred rather than guessed at. This file is that
question, written down so it is owned by something that is open.

Two questions, and the second is the one with teeth.

**May a tenant read `UNIT`-linked paper for their own flat, during their own term?** A handover
protocol is the clearest case for yes: it records the state the flat was handed over in, the tenant
signed it, and it is the document they most plausibly need at move-out. An inspection report
commissioned by the office about the same flat is the clearest case for no. Both arrive through the
same link type today, so no rule can currently tell them apart.

**Which link type should carry which paper?** This is the real defect the first question exposes.
`document_link.entity_type` says what a document is *about*; it does not say who it is *for*. As long
as those two are the same column, any answer to the first question is a rule about aboutness standing
in for a rule about audience, and the next document filed against a Unit inherits whatever that rule
decided. A `link_role` already exists on `document_link` (`SUBJECT`, `EVIDENCE`) and may be the seam,
or may be the wrong one — it currently describes the document's relation to the entity, not its
readership.

## Why it is not urgent, and why it must not be silently dropped

There is no tenant-facing retrieval surface. `searchPassages`'s only production caller is the office
turn with administrator stance, so nothing reaches the Tenancy bound today and no tenant is currently
being denied anything. #124 closed the door before the room was built.

The danger is the opposite of urgency. **The day a tenant route ships, this question gets answered by
whoever is building the route, in the course of building it, probably by widening the bound until the
screen looks right.** That is how the original defect was born: the Unit bound was correct for the
office, and tenant stance was permitted on it because nobody had asked who else would hold it. An
unowned question with a cheap wrong answer is the shape of the next leak, which is why it is a file
rather than a sentence in a closed issue.

## What a good answer looks like

Not a filter added at the call site. A rule stated in `SPEC-evidence.md` about which link carries
readable-by-the-household paper, with `CONTEXT.md` naming the distinction if a new term falls out of
it, and a policy case red first — the same shape #124 used. If the answer turns out to be "the
Tenancy bound stays exactly as it is", that is a real answer and this issue closes on it; it has to
be decided rather than defaulted.

## Blocked by

None. It is a product question before it is an engineering one, and the director owns it — which is
what `needs-triage` means here.

## Related

- #124 — the Tenancy bound, and where the strict first cut is argued.
- The `verify` third verb (`SPEC-evidence.md`, *Which declared fields are copies*), still named and
  unbuilt, is the same family of question asked about `address` and `apartment_number`: a document's
  relationship to the record it was filed against is not yet modelled.
