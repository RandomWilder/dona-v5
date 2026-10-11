---
number: 208
title: Service providers are parties, labelled and linked from the profile
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [203, 206]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

A service provider becomes a role a COMPANY party plays. The provider record points at its party;
every provider the property importer already created gets one company party named after it, by a
one-off backfill in its own migration. On a company's profile an operator marks it a service provider
and chooses its kind — in-house crew, contractor, developer warranty — which creates or links the
provider record through a new command on the estate contract. The party then carries the service
provider label with its kind and appears under that filter. Its phones and emails are ordinary
contacts, so a contractor who messages from one is identified as that party — and reaches no unit.

SPEC-estate is amended first; SPEC-parties records the label.

## Acceptance criteria

- [x] The provider record has a unique reference to a COMPANY party; after the backfill every provider has one and the column is NOT NULL. The importer creates the party when it creates a provider, and a re-run is still a no-op.
- [x] A schema test shows a provider cannot point at a PERSON party.
- [x] Marking a company a service provider from its profile creates or links the provider with the chosen kind and writes an audit row; a person cannot be marked.
- [x] The party is labelled service provider with its kind and is returned by that filter.
- [x] A policy case: a phone on a provider's party resolves to no unit through the scope contract.
- [x] A call from that phone is identified as the provider's party, as the calls tab already allows a party on no lease.
- [x] The parties module does not depend on estate; the composition root composes them.
- [x] Route tests cover marking, the label and the filter.
- [x] The service provider screen is removed from the mockup; clicked on `:3000`.

## Comment — 2026-10-11

Closed. A provider points at one company party. The backfill names a company after each provider that had none, then the column is required. The importer creates that company, and a re-run keeps it. Marking from a company profile writes the provider and an audit row; a person is refused. The label is ספק שירות with the kind, and the filter returns those parties. A phone on the provider resolves to no unit, and a call from it is identified. A guarantor who is also a provider stays unmatched and the message is kept. Parties does not import estate. The mockup screen was already gone with #207. On the restarted server at `:3000`, signed in, the filter ספק שירות returned אין התאמה — the local directory has no company and no provider — and a person profile shows no mark. A company was not created in that directory.

## Blocked by

- #203 — the label and filter machinery.
- #206 — the provider's contacts are managed as contacts.
