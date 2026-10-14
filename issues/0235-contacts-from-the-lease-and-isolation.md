---
number: 235
title: "Contacts from the lease, and isolation"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed:
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

Phone numbers and emails printed on a lease reach the people they belong to. The `lease` type declares six new fields as seed rows at a new `effective_from`:
- `main_tenant_phone`, `main_tenant_email`;
- `second_tenant_phone`, `second_tenant_email`;
- `guarantor_phone`, `guarantor_email`.

Guarantor contacts pair with `guarantor_name` by the same ordinal, all-or-nothing rule as identifiers. Any phone or email fields already declared through A14 on staging are reconciled into these keys.

On הקריאה, a phone row can be approved only when it normalises to a valid Israeli mobile number. A nine-digit value starting with 5 (the 14 Oct read `549797236`) is offered back with its leading 0 as the correction. Anything else gets a Hebrew refusal on the row. An email is folded by the existing normaliser.

On פתיחת טיוטה, each approved phone and email is written as a `party_contact` on the party that person became, from today, primary when that party has no open primary on the channel. #206's overlap refusal applies: a value another party holds today refuses the whole draft and names that party. Before falling back to `createParty`, an existing party is matched by an approved phone or email that is an open contact of exactly one party.

Access follows the existing chain and is not granted here. The isolation outcome is asserted as a policy case, written failing first.

Spec: SPEC-parties "Contacts from a lease"; SPEC-flows A2 step 5 as amended.

## Acceptance criteria

- [ ] The six fields are declared as seed rows. The extractor reads them under its existing prompt; if the field hints change the prompt text, the golden set runs.
- [ ] A phone row reading `549797236` is offered as `0549797236`. A value that is not an Israeli mobile number cannot be approved, and the row says why.
- [ ] Opening writes one open `party_contact` per approved phone and email, on the right person, by role.
- [ ] A phone already held by another party today refuses the draft, naming that party. Nothing is written.
- [ ] A person with no ת.ז. but an approved phone held by exactly one existing party is attached to that party, not duplicated.
- [ ] **Policy case, red first,** through the scope contract:
  - the tenant's approved phone resolves to no unit while the tenancy is `DRAFT`;
  - it resolves to the unit once the tenancy is `ACTIVE` on the asked date;
  - the guarantor's approved phone resolves to no unit at any point.
- [ ] Clicked on `:3000`: the people appear in אנשי קשר with their phone and email.

## Blocked by

- #234
