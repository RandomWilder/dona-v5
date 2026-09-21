---
number: 131
title: "Declare the lease household by role, and the terms it prints"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [129]
parent: 136
created: 2026-09-21
closed:
---

## What to build

Widen what a lease declares. **All of it is seed rows at a new `effective_from`. No migration.**

### The household is named by role

A lease is signed by more than one person, and the declaration has to say which person each value
belongs to. `extracted_field` permits two rows of one declaration and always has — but two rows of
`tenant_name` and two rows of `tenant_id_number` arrive with **no link between them**. Nothing says
which identifier belongs to which name. On the second specimen the two signatories carry different
*kinds* of identifier, a passport and a ת.ז., one line apart. A pairing heuristic that gets this wrong
writes one person's identifier onto another person's record and looks entirely correct doing it.

The declaration therefore names the role: `main_tenant_name` (required) and `main_tenant_id_number`,
`second_tenant_name` and `second_tenant_id_number`, with `guarantor_name` and `guarantor_id_number`
unchanged. The keys mirror `tenancy_party.role`, which already distinguishes `PRIMARY_TENANT` from
`CO_TENANT`; they name an idea the tenancy module already governs rather than inventing a parallel
one. Pairing is solved by construction — there is no proximity heuristic and no screen that asks an
operator to attach an identifier to a name.

**The cap at two is a seed cap, not a schema cap.** A lease with three signatories is served by a
`third_tenant_name` row at a new `effective_from`. Nothing in the schema needs to change for it.

**The existing `tenant_name` and `tenant_id_number` rows are closed, not edited.** R18 is not
negotiable here: a value extracted in September under the old declaration must keep meaning what it
meant, and an edit would silently rewrite it.

**A duplicate capture is shown, not resolved.** There is no unique key on
`(document_id, document_type_field_id)`, so a model returning two values for `main_tenant_name` writes
two rows. Both survive to the reading screen and the operator picks. A silent first-wins would be the
bug — the point of capture being open is that disagreement reaches a person.

### The terms the specimens print

`maintenance_amount` and `maintenance_currency` (ועד בית, charged monthly beside the rent, paired per
ADR-0008), `deposit_months`, `promissory_note_amount` and `promissory_note_currency` (שטר חוב),
`option_end_date`, and `signed_date` — which is when the document was signed and not when the term
starts.

**`deposit_months` is declared rather than assumed, and this is the fixture's central finding.** Both
specimens compute their deposit as (rent + maintenance) × a multiplier. The first uses two months; the
second uses three, and states so on a page that is *a different document bound into the same PDF* — an
election form filed as part of the lease file. A deposit check hard-coded at two would flag a correct
lease as wrong, on the very lease whose own paperwork explains why.

**`option_end_date` closes a trap the current hints cannot see.** Both leases run five years with a
five-year option and both print all four dates. The live hint for `start_date` says only that the
value is ISO-formatted; nothing distinguishes the original period from the option, so nothing stops
the option's dates landing in `end_date`. Declaring the option separately makes the distinction the
reader's job and gives the scorer something to fail on.

### What is not declared here

`gush`, `helka` and the plan's structure designation are printed on both leases and are facts about
the **building**, not about the letting. They belong to a Building declaration — track A — and
declaring them on the lease type would put a fact where it happened to be printed rather than where it
is true.

## Acceptance criteria

- [ ] The household and terms declarations exist as seed rows at a new `effective_from`
- [ ] No migration is written
- [ ] `tenant_name` and `tenant_id_number` are closed, not edited; September's values still resolve
      against the declaration they were read under
- [ ] `main_tenant_name` is required; every other new key is optional
- [ ] The new keys mirror `tenancy_party.role` rather than inventing a parallel seniority
- [ ] Two captures of one declaration both persist; nothing resolves them silently
- [ ] `gush`, `helka` and the structure designation are not declared on the lease type
- [ ] The golden set from #127 is re-run against the widened declared set and the new denominator
      recorded as a comment

## Blocked by

- #129 — the declared set must hold still while the reader is being measured. Widening it mid-chain
  moves the scorer's denominator under #128 and #129 and makes both deltas meaningless.

## Related

`SPEC-evidence.md`, *What a lease declares, from track B*, under *Seeding the catalogue*.
