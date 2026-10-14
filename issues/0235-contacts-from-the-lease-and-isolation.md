---
number: 235
title: "Contacts from the lease, and isolation"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed: 2026-10-14
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

- [x] The six fields are declared as seed rows. The extractor reads them under its existing prompt; if the field hints change the prompt text, the golden set runs.
- [x] A phone row reading `549797236` is offered as `0549797236`. A value that is not an Israeli mobile number cannot be approved, and the row says why.
- [x] Opening writes one open `party_contact` per approved phone and email, on the right person, by role.
- [x] A phone already held by another party today refuses the draft, naming that party. Nothing is written.
- [x] A person with no ת.ז. but an approved phone held by exactly one existing party is attached to that party, not duplicated.
- [x] **Policy case, red first,** through the scope contract:
  - the tenant's approved phone resolves to no unit while the tenancy is `DRAFT`;
  - it resolves to the unit once the tenancy is `ACTIVE` on the asked date;
  - the guarantor's approved phone resolves to no unit at any point.
- [x] Clicked on `:3000`: the people appear in אנשי קשר with their phone and email.

## Blocked by

- #234

## Closing notes

- The field hints change the reader's schema, so the golden set ran twice. Extraction: required 100% (14/14), optional 92.7%, 3 contradictions under the ceiling of 7. Run 1 also failed sorter `ru-unsure` and corpus `building-lettings-list`; neither reads a lease field, and run 2 was 16/16 with the sorter at 14/14. The specimens' ground truth now carries their phones and emails. Bloch's single phone was keyed to the second tenant after both runs put it there: on the page it sits between her ת.ז. and her email.
- Clicked on :3000 with a fixture lease. `549797236` was offered as `0549797236`. A landline was refused on its row. The draft opened, and the main tenant and guarantor appeared in אנשי קשר with their phones and email.
- "Reconciled into these keys" is done as closing, not copying. The seed closes any open `lease` declaration whose key or label names a tenant's or guarantor's phone or email, other than the six. Values already read under such a key stay under it and are not written as contacts. If the 14 Oct `01a13956` reading approved its phone under an A14 key, that phone does not reach אנשי קשר when the draft opens. It can be added on the person by hand, or the lease re-read.
- Phone and email rows are left out of A15's `אישור כל מה שלא סומן`. #239 owns bulk approval on הקריאה, but without this exclusion the bulk path would sign a number that was never checked.
- Beyond the ticket, the press also refuses one contact approved for two people on the same lease, and two people resolving to one existing party through a contact. Both are the overlap rule applied inside one document (SPEC-parties, amended).
- An approved contact that the ordinal rule pairs with nobody is not written, and פתיחת טיוטה says how many there are.
- The phone rule lives at the composition root (`src/contact-rules.ts`), because evidence may not import scope.

## Comment — 2026-10-14

The closing note above left a phone approved under an old field name off the person. That is no longer the case. פתיחת טיוטה writes it onto the person the old key or label names: the guarantor, the second tenant, or otherwise the main tenant. One person and one such approved value, and only when the new field for that channel did not already pair. A number read without its leading 0 is corrected the same way הקריאה corrects it. A value that is not a mobile number is not written, and the draft still opens. Re-reading `01a13956`, or typing the number on the person afterwards, is not required for that phone to arrive.
