# SPEC: scope

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here.

- **Owns:** **the isolation join, and nothing else.** The module exists so foundation rule 1 has one
  address and the CI guard has a target.
- **Entities:** none. It writes no tables; the `occupancy` VIEW is its only artefact.
- **Depends on:** parties, tenancy, estate — through the view and not through their code. The view
  names their tables once, in a migration, so this module imports no other module's `contract.ts`
  and no other module imports this one's SQL.
- **Builds:** week 2, slice 2.3. **The join itself landed early, at week 1 slice 1.7**, because the
  two policy cases that gate it cannot be honest without it: a case that writes its own copy of the
  join proves that copy, and puts a second copy outside this module — the exact drift the guard
  exists to stop.
- **Carries:** the five hops, in SQL, in one file, resolved **before any model call**:
  `phone → PartyContact (valid today) → Party → TenancyParty → Tenancy (active today) → Unit`. Two
  temporal predicates, both asserted. **The scope is a view, never a column** — no column anywhere
  names the household in occupation, and a migration introducing one fails the build.

## The view is the shape; the resolver is the rule

`0008_occupancy_view.sql` creates `occupancy`: the five hops joined once, with the period columns
carried as data. It contains **no temporal predicate, no status filter and no `CURRENT_DATE`**.
`internal/isolation-join.ts` supplies the day and every rule about it.

Three things forced that split, and each of them on its own is enough:

- **A view cannot take a parameter.** The only way to put `today` inside one is `CURRENT_DATE`,
  which is SPEC.md's clock rule broken — a temporal predicate the tests cannot control is a test
  that fails on a Tuesday.
- **Migrations are scanned by guard two.** `src/kernel/migrations/` is not `src/scope/`, so a view
  carrying the tenancy-active predicate fails the build. The alternative was to add the migrations
  directory to the guard's exclusion list, and `scripts/guards.ts` says why not: an exclusion list
  that grows is how a guard dies.
- **It is the truer line anyway.** What the guard protects is not the join's text, it is the
  decision about *when* a contact or a tenancy counts. Keeping the hops in the view and the rules in
  one TypeScript file means that decision has exactly one home, and the view can serve a question
  that is not about today — Panel 6's tenancy history, for one — without a second view being written.

R6 holds either way: occupancy is a view and a parameter, and never a column.

**`national_id` is not a column of the view**, deliberately. SPEC.md's security defaults make it
admin-only and unreachable by any agent tool, and this view is the surface an agent's scope is built
from. `src/scope/scope.test.ts` asserts its absence against `information_schema.columns` rather than
leaving it to intention.

**Anything that wants occupancy asks this module for it.** A screen reading the view directly would
have to write the day predicate, which puts it in a second file and fails guard two. That is the
guard working rather than an inconvenience: slice 2.6's occupancy chip calls `resolvePartiesInUnit`.

## The two questions, one query each

The workbook's ADMIN VIEWS sheet ends with a test: *if the model is right, these are all one query
each*. Two of them are this module's.

- **Q1 — who lives in unit 12 today?** `resolvePartiesInUnit(db, unitId, today)`. Every party on the
  tenancy that is active today, with their role, their language and how to reach them. It is Panel 1
  of the unit screen, and the contact hop is a LEFT JOIN so a tenant with no number on file still
  appears rather than vanishing.
- **Q2 — this phone number just messaged us, which unit, if any?** `resolveUnitsByPhone(db, phone,
  today)`. The isolation join, and the answer is frequently *none*, which is the point.

Both read `occupancy` and neither restates the join.

## The audit line records what was reached, not what was asked

SPEC.md's security defaults require **every scoped read of tenant data to be logged**, not only
every command. `resolveUnitsByPhone` writes one through `kernel/audit.ts`, on the same connection as
the read, so the line is inside the caller's transaction and cannot be lost separately from the
thing it describes.

It carries `action`, the resolved `party_id` as the subject when there is one, and the number of
rows matched. **It does not carry the number that was asked.** SPEC.md also says PII never in logs,
and the two rules are only reconcilable one way: an Israeli mobile number has around seven digits of
entropy, so a bare hash of one is reversible by anybody who can run a loop, and an HMAC needs a
secret this module would have to own. So the line says which party was reached and how many rows
came back, which is what an access review and a dispute both ask.

The number that was asked is not lost — it is the channel module's, where an inbound message
legitimately lives with its sender, and it arrives with week 9.

## E.164, converted here and enforced at the database

`normalisePhone` turns `052-123-4567`, `+972 52 123 4567`, `00972521234567` and `972521234567` into
`+972521234567`, keeps a number that is already international, and raises `invalid` on anything
else. The workbook is explicit that mixed formats break the inbound lookup silently, which is a
failure that looks exactly like correct isolation — nothing is wrong on any screen.

2.1's `phone_is_e164` CHECK is the storage half and this is the conversion half; they are validated
against the same expression on purpose, so the edge cannot accept what the database will reject.
Written rather than installed: one default region does not justify a runtime dependency
(AGENTS.md), and the whole rule is that an Israeli national number drops its leading zero.

**The importer is the other caller** — a register whose numbers are formatted for a spreadsheet is
rejected by the CHECK row by row unless it normalises first. Slice 2.4.
