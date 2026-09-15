---
number: 101
title: "Retire foundation rule 2; the lease gains four amount fields"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

An administrator uploads a lease and the rent on it is captured, shown and approved like any other
value on the contract. Today the system refuses: a declaration naming money is rejected outright by a
vocabulary guard, so the single most important number on a signed contract cannot enter the system at
all.

The prohibition on money is a foundation rule, and it is retired in full rather than narrowed. That
means all three places it is enforced: the declaration vocabulary guard and everything it exports,
the schema assertions forbidding money-named columns on the tenancy tables, and the agent-facing
prohibition on prices and balances. Money becomes ordinary data — readable, capturable, approvable,
promotable, retrievable, quotable and computable. A guard kept alive after its rule has been retired
is worse than no guard, because the next reader will reason from it; so the cases that enforced this
rule are deleted and nothing replaces them.

The lease document type gains four seeded fields: a rent amount, a rent currency, a deposit amount
and a deposit currency. Currency is paired per amount rather than one per document, because a lease
can price the deposit in one currency and the rent in another. No new value type is introduced —
amounts are a plain number beside a currency, both of which are existing value types, so this change
needs no schema migration. Capture normalises a printed amount to a bare number: separators and
symbols belong to the paper, not the store. Each amount field carries an extraction hint that
excludes the amounts it is not, in the same shape the identifier fields already use.

Rule 3 is unaffected and must be left standing: no model participates in the responsibility decision
or in the service-call state machine, and the state machine still may not branch on any model-derived
value, money included. Removing the money rule does not weaken it, and the change should not read as
though it does.

Because this reverses a numbered foundation rule, it is recorded as an architecture decision record
in its own right, not merely as a spec edit. The foundation rules, the status section, the evidence
spec and the glossary are edited in the same change as the code, per this repo's standing rule.

## Acceptance criteria

- [ ] A lease declaration naming money is accepted; no refusal path for money remains anywhere
- [ ] The money vocabulary module is deleted, along with its re-exports on the module contract and its single enforcement call site
- [ ] The money-field policy case, its route-level mirror, and the tenancy schema assertions forbidding money-named columns are deleted and not replaced
- [ ] Rent amount, rent currency, deposit amount and deposit currency are seeded on the lease document type, each amount paired with its own currency
- [ ] Each amount field carries an extraction hint excluding the amounts it is not
- [ ] A printed amount with separators and a currency symbol is captured as a bare number plus a currency
- [ ] No schema migration is added by this ticket
- [ ] An ADR retiring the rule exists in the decisions directory, and the foundation rules, evidence spec and glossary are edited in the same change
- [ ] Rule 3 remains stated and enforced; nothing in the change implies it was relaxed
- [ ] Both required gates pass, with no silently skipped suite

## Blocked by

None (can start immediately).
