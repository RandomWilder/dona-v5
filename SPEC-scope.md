# SPEC: scope

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here.

- **Owns:** **the isolation join, and nothing else.** The module exists so foundation rule 1 has one
  address and the CI guard has a target.
- **Entities:** none. It writes no tables; the current-occupancy VIEW is its only artefact.
- **Depends on:** parties, tenancy, estate — none of which exist yet.
- **Builds:** week 2, slice 2.3. **The join itself landed early, at week 1 slice 1.7**, because the
  two policy cases that gate it cannot be honest without it: a case that writes its own copy of the
  join proves that copy, and puts a second copy outside this module — the exact drift the guard
  exists to stop.
- **Carries:** the five hops, in SQL, in one file, resolved **before any model call**:
  `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`. Two
  temporal predicates, both asserted. **The scope is a view, never a column** — no `current_tenant`
  column exists anywhere, and a migration introducing one fails the build.

## The join, as it stands at 1.7

`internal/isolation-join.ts` holds the SQL and the relation names it reads; `contract.ts` is what
every other module and the policy suite import. Nothing outside this directory may name
`party_contact` and `tenancy_party` in the same file — `scripts/guards.ts` fails the build on it,
because the way this constraint dies is not a rewrite, it is a second copy that drifts.

Written against the workbook's E5–E8 field names ([docs/model/](docs/model/)), which is a
specification and not a description. The tables arrive at 1.9 (Unit), 2.1 (Party, PartyContact) and
2.2 (Tenancy, TenancyParty); until then the join raises `42P01` and the policy cases report pending
against the named relation. **If the DDL drifts from the workbook, the policy cases go red** — which
is the gate working rather than the gate breaking.

**Two things `today` is not.** It is a parameter, never `CURRENT_DATE`: SPEC.md's clock rule, and a
temporal predicate the tests cannot control is a test that fails on a Tuesday. And it is a `date`,
not a timestamp — both predicates are day-grained, matching the workbook's column types.

## What 2.3 still owes

- The **current-occupancy VIEW**, in a migration, and the resolver reading the view rather than the
  base tables. The join text moves; the policy cases do not.
- The scoped-read **audit line**: SPEC.md's security defaults require every scoped read of tenant
  data to be logged, not only every command. `kernel/audit.ts` exists; this call site does not use it
  yet, and it must before any real phone number reaches it.
- Input validation at the edge — E.164 normalisation, so a number stored in one format and asked in
  another cannot silently resolve to nobody. The workbook is explicit that mixed formats break the
  inbound lookup silently, which is a failure that looks exactly like correct isolation.
