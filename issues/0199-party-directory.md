---
number: 199
title: "The אנשי קשר tab: a searchable Party directory and a party profile"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-11
closed: 2026-10-12
---

## Problem Statement

The system captures parties from three places — the register import, the lease flow (A2), and the
calls tab when a sender is identified — and there is no screen that shows them. An administrator who
wants to know who a person is, how to reach them, which flat they live in or used to live in, or
whether a phone number still belongs to them has to go through a tenancy page or a call and hope the
party is attached to one. A contractor cannot be recognised at all when they message the office,
because a service provider is a name in the estate with no phone or email. And a party's name is
stored as one string, so the property tile already guesses a family name by taking the last word,
which is wrong for "בן דוד", "אבו חמד" or "da Silva".

The party data is also the source the front door reads to decide who a sender is. A contact that is
never closed when a tenancy ends or a number changes hands is how a recycled number reaches the
previous tenant's flat. Today there is no place where an office worker can close one.

SPEC-parties records "no read model" and "no screen over this module" as deliberate. This spec
reverses that, for the administrator stance only.

## Solution

A new tab, **אנשי קשר** (the Party directory), lists every Party. Staff search it by name, phone,
email or — with permission — ת.ז., and filter it by **Party label**: current tenant, past tenant,
draft tenancy, guarantor, service provider, no relationship. Clicking a name opens the **party
profile**, which shows the party's identity, every contact it ever held with the dates it held them,
each label linked to its tenancy, the calls it opened, and the history of edits made to it.

On the profile, staff correct the name, language and ת.ז.; add a contact, mark one primary, or close
one; and mark a party as a service provider. Staff can also create a party by hand — an owner, a
neighbour, a contractor — which today only the importer and the lease flow can do.

A person's name is stored as a given name and a family name, a company's as a legal name, and the
display name is computed from them. A service provider becomes a COMPANY party, so its phones and
emails are ordinary contacts and the front door can recognise it.

Labels are never stored. They are computed on every load from the tenancies a party holds a role on
and from the provider records that point at it. A **Lead** is not a Party and never appears here.

## User Stories

### Finding a party

1. As an operator, I want a tab listing every party, so that I can find anyone the system knows without going through a flat or a call.
2. As an operator, I want to search by any word of a person's name, so that "לוי" finds "דנה לוי" and "דנה" finds her too.
3. As an operator, I want to search by a company's legal name, so that I can find a contractor or a corporate tenant.
4. As an operator, I want to search by phone number in any format I type, so that `052-123-4567`, `0521234567` and `+972521234567` all find the same party.
5. As an operator, I want to search by email without worrying about capital letters, so that `Dana@Example.com` finds `dana@example.com`.
6. As an operator, I want a phone search to also match numbers a party used to hold, flagged as a former number, so that I can answer "who had this number in March?".
7. As an administrator, I want to search by ת.ז. in any format, so that `312-345-678`, `312345678` and `12345678` with a dropped leading zero find the same person.
8. As an administrator, I want ת.ז. search refused to anyone without the identifier permission, so that an operator cannot find a person's identity by guessing their number.
9. As an administrator, I want every ת.ז. search recorded with who searched and which parties it matched, so that a search is logged the same way reading the number is.
10. As an operator, I want each row to show the name, the labels with their unit, the primary phone, the primary email and the language, so that I can tell two people with the same name apart without opening both.
11. As an operator, I want to filter the list by label, so that I can see every current tenant, every guarantor or every service provider.
12. As an operator, I want to see parties with no relationship to us as their own filter, so that owners, neighbours and parties left behind by a call are visible rather than lost.
13. As an operator, I want the list never to show a ת.ז., so that the directory can be open on a screen in the office.
14. As a viewer, I want the tab hidden from me, so that a read-only account does not expose every tenant's phone number.

### Labels

15. As an operator, I want a party who holds a role on a tenancy that is active today to be labelled a current tenant with the unit, so that I know where they live now.
16. As an operator, I want a party whose tenancy has ended or ended early to be labelled a past tenant, so that a former tenant is not mistaken for a current one.
17. As an operator, I want a party on a draft tenancy to be labelled as such, so that I know a lease is being prepared for them.
18. As an operator, I want a guarantor labelled as a guarantor and never as a tenant, so that nobody treats the parent who co-signed as the household.
19. As an operator, I want an occupant labelled distinctly from a tenant on the lease, so that I know who signed and who only lives there.
20. As an operator, I want one party to carry several labels at once, so that a tenant who also guarantees a sibling's lease shows both.
21. As an operator, I want a service provider labelled with its kind — in-house crew, contractor, developer warranty — so that I know what kind of provider it is.
22. As an operator, I want a label to change the day a tenancy changes, with no one editing the party, so that the directory is never out of date.
23. As an operator, I want each label on the profile to link to its tenancy, so that I reach the lease, the documents and the household from the person.

### The profile

24. As an operator, I want a profile page per party, so that everything about one person or company is in one place.
25. As an operator, I want to see the given name and family name separately, so that I know how to address the person.
26. As an operator, I want to see every contact the party ever held, open and closed, with its validity dates and its label, so that I know how to reach them now and how they were reached before.
27. As an operator, I want to see the calls this party opened, newest first, linked to each call, so that I know their history with us.
28. As an operator, I want to see the edit history of the party — who changed what and when — so that a wrong change can be traced.
29. As an operator, I want a hint when other parties share this name, linking to them, so that I notice a probable duplicate without the system merging anyone.
30. As an administrator, I want the ת.ז. masked on the profile until I click to reveal it, so that it is not on screen by default.
31. As an administrator, I want revealing a ת.ז. recorded, so that every read of an identifier is logged.
32. As an operator, I want the ת.ז. not revealable at all from my role, so that the rule is enforced by the system and not by discretion.
33. As an operator, I want to see no rent, deposit or balance on the profile, so that financial data stays in Priority.

### Editing a party

34. As an operator, I want to correct a person's given name and family name, so that a typo from a lease is fixed once for every screen.
35. As an operator, I want to leave the given name empty for a person known by one name, so that a mononym is stored truthfully.
36. As an operator, I want to correct a company's legal name, so that a contractor's name matches its invoices.
37. As an operator, I want to change a party's preferred language, so that the system answers them in the language they use.
38. As an administrator, I want to add or correct a ת.ז., so that a party created from a lease with no identifier can be keyed later.
39. As an administrator, I want a ת.ז. that another party already holds rejected, with a link to that party, so that I find the duplicate instead of creating a conflict.
40. As an operator, I want every edit recorded with my account, my role and the fields changed, so that the history is complete.
41. As an operator, I want the audit history never to contain a ת.ז. in plain text, so that the log is not a second place the identifier leaks from.

### Contacts

42. As an operator, I want to add a phone or an email to a party, starting today or on a date I give, so that a new number is recognised from the day it is used.
43. As an operator, I want a phone I type in a local format stored in the international format, so that the front door finds it.
44. As an operator, I want a number that another party currently holds rejected, naming the other party, so that one number never resolves to two people on one day.
45. As an operator, I want to put a short label on a contact, such as "יוסי – סדרן", so that I know who answers a company's number.
46. As an operator, I want to mark one contact as primary, so that the list shows the number people should use.
47. As an operator, I want to close a contact on a date, so that a number the tenant gave up stops identifying them from that day.
48. As an operator, I want a closed contact kept and shown, never deleted, so that "who held this number in March" can still be answered.
49. As an operator, I want a closed number to identify nobody at the front door after its end date, so that a recycled number never reaches the previous tenant's flat.
50. As an operator, I want to be able to add a closed number to its new holder once it is closed, so that the number can belong to someone else.

### Creating a party

51. As an operator, I want to create a person by hand with a family name and at least one contact or a ת.ז., so that I can record an owner, a neighbour or a contractor's technician.
52. As an operator, I want to create a company by hand with a legal name and at least one contact or a ת.ז., so that I can record a contractor before any job.
53. As an operator, I want a party with neither a contact nor a ת.ז. refused, so that the directory holds no record that can never be identified or reached.
54. As an operator, I want the new party to open on its profile once created, so that I can carry on adding contacts.

### Service providers

55. As an operator, I want to mark a company as a service provider and choose its kind, so that it is labelled and appears under the service-provider filter.
56. As an operator, I want the providers the property importer already created to each have a party, so that every existing provider appears in the directory on day one.
57. As an operator, I want a contractor who messages from a number on its party to be identified as that contractor, so that their call is not left unidentified.
58. As an operator, I want a provider identified at the front door to reach no unit, so that a contractor's number never opens a tenant's scope.

### Names across the system

59. As an operator filing a lease, I want the household's names proposed as given name and family name on the confirmation screen, so that I correct the split where the lease is the evidence.
60. As an administrator importing a register, I want a person row to carry a given name and a family name and a company row a legal name, so that the import stores names already split.
61. As an administrator, I want a register row that carries only one combined name rejected with its line number, so that no name is split by guessing.
62. As an operator, I want the property tile to show the household's real family name, so that "בן דוד" is not shown as "דוד".

## Implementation Decisions

**Spec first.** SPEC-parties is amended before any code: the "no read model, no screen over this
module" decision is reversed for the administrator stance, and the new commands, the name columns,
the contact label and the read model are written there. SPEC-staff gains the two permissions,
SPEC-register the name columns, SPEC-estate the provider's party, SPEC-flows the split names on A2's
confirmation screen. An ADR records **"A Lead is not a Party"** (hard to reverse; most CRMs unify
them; the trade-off was a clean identity table against one list for everyone).

**Schema** (one migration for DDL, backfill separately, as the convention requires):

- `party` gains `given_name` (nullable), `family_name` and `legal_name`. A CHECK ties them to
  `party_kind`: a PERSON has a `family_name` and no `legal_name`; a COMPANY has a `legal_name` and
  neither person name. All three are `-- pii`.
- `party.full_name` stops being written and becomes a stored generated column: `given_name` and
  `family_name` joined by a space for a PERSON, with no leading space when `given_name` is null;
  `legal_name` for a COMPANY. Every existing reader of `full_name` is untouched.
- `party_contact` gains `label` (nullable free text, `-- pii`).
- `provider` gains `party_id`, a foreign key to a COMPANY party, unique, nullable until the backfill
  has run and then made NOT NULL.
- The generated test register is regenerated with split names rather than converted. Each existing
  provider gets one COMPANY party named after `provider.name`, by a one-off backfill.
- No column records a label, a party type or a tenancy state on the party. Guard one's rule
  stands.

**The parties contract** gains, beside its existing write commands:

- A read model for the directory: search by a free-text query over name words, phone (normalised by
  the same edge normaliser the door uses), email (case-folded), and ת.ז. (through
  `party_national_id_key`, only when the caller holds `party.national_id.read`); includes closed
  contacts and reports which matches were on a former number. Returns parties with their primary
  contacts and never a `national_id`.
- A profile read: the party's identity fields, every contact with its dates and label, the
  same-name count, and the identifier only as a masked suffix.
- A reveal command for the identifier, which checks the permission and writes the audit row.
- Commands: create a party by hand (enforcing "a contact or a ת.ז."), update identity fields,
  add a contact, set the primary contact, close a contact on a date. `upsertParty` and `createParty`
  take split names.
- The parties module still depends on the kernel only.

**Labels are a read, computed at the composition root.** The profile and the directory compose
three contracts: parties (identity, contacts), tenancy (each party's roles with each tenancy's status
and unit, using the same "active today" reading the occupancy view and the isolation join use), and
estate (provider links and kinds). The calls contract provides the calls opened by a requester. No
module reaches into another's tables. The label vocabulary is: current tenant, past tenant, draft
tenancy — each carrying the role (primary tenant, co-tenant, occupant) — guarantor (with its
tenancy's state), service provider (with its kind), no relationship.

**Linking a provider** is an estate command exposed through the estate contract: given a COMPANY
party and a provider kind, create or link the provider row. The profile calls it under
`party.write`.

**Permissions.** `party.read` and `party.write` are new, granted to ADMIN and OPERATOR. VIEWER holds
neither and does not see the tab. `party.national_id.read` stays ADMIN only and gets its first
readers: the reveal, the ת.ז. search, and writing a ת.ז. Closing a contact is `party.write`.

**Audit.** Every write and every reveal or ת.ז. search goes through the kernel audit log with the
staff actor and role. Inputs record the party id, the fields changed and — for a contact — the
channel and the contact id. They never carry a `national_id` value; an identifier search records the
matched party ids, not the searched value.

**Duplicates are not merged.** A ת.ז. already held by another party is rejected with a conflict that
names the other party. Names are never matched to link or merge; the same-name count is a display.

**Screens.** The directory and profile are painted first as a mockup in the live shell, clicked
through by the director, then wired, and the mockup is deleted when the flow is wired. The tab is
labelled אנשי קשר. Server-rendered HTML with form posts, as the calls tab is.

**Names elsewhere.** A2's confirmation screen shows given and family name fields for each household
member, pre-filled from the extraction; the extracted name stays one field and the split is the
human's confirmation. The register importer reads the split columns and rejects a combined-name row
with its line number. The property tile reads `family_name` instead of taking the last word.

## Testing Decisions

A good test drives the system the way the office does and asserts on what the office sees or what
the database keeps: a form post as a signed-in role, then the page or redirect that comes back, the
rows that exist and the audit rows written. It does not call internal functions or assert on query
shape, and the label computation and search query are covered only through the routes.

- **The HTTP routes** are the main seam: `buildApp` with the session helpers, as the calls tab's
  route tests do. Search in every form (name word, each phone format, email case, ת.ז. formats,
  former number), each label filter, the profile's sections, every edit, creating a party by hand,
  linking a provider, the refusals (VIEWER refused the tab; OPERATOR refused reveal and ת.ז. search;
  a duplicate ת.ז.; a contact that overlaps another party's; a party with no contact and no ת.ז.),
  and the audit row for each.
- **Policy cases**, written and seen red before the code: the ת.ז. is absent from every directory
  and search response and from the profile without `party.national_id.read`; closing a contact
  keeps the row and a closed number resolves to no unit after its end date (beside the
  recycled-number case); a provider's contact resolves to no unit.
- **Schema tests** in the parties schema test: the name CHECK for each kind, `full_name` generated
  for a person, a mononym and a company, the contact label, the provider's party link.
- **Existing suites that must stay green**: the register importer and A2 lease flow tests, updated
  for split names; the isolation and guarantor policy cases unchanged.
- **Click before merge**: the directory, a search, a profile, an edit and a contact close are
  clicked on `:3000` after restarting `npm run dev`.

## Out of Scope

- Leads, the leasing funnel and the Lead-to-Party handover, except the one constraint already agreed:
  a lead converts through `upsertParty` keyed on the ת.ז., so a former tenant is reattached rather
  than duplicated. That belongs to SPEC-leasing.
- Merging duplicate parties. A later ticket, under plan mode, because it rewrites tenancy roles,
  calls, contacts and audit across modules.
- Editing tenancy roles from the profile. They stay on the tenancy screen and the lease flow, where
  the lease is the evidence.
- A person-to-company relationship (a named technician as their own party). The contact label
  covers it until staff need the technician's own history.
- Free-text notes on a party.
- Listing documents on the profile; they are reached through the tenancy.
- Any change to the isolation join or to who a sender can reach.
- Any tenant-facing or agent-facing access to the directory.
- Rent, deposits, balances or any financial field.

## Further Notes

- The real register export has not arrived. All 2,871 parties today come from the generated
  register, which already builds names from a first and a last name, so splitting now costs a
  regeneration and not a hand-check of real names. The same split on real data later would cost a
  person reading every row.
- The calls-by-requester read needs an index on the call's requester party; whether it needs one at
  pilot volume is measured at ticketing, not assumed.
- Closing a contact is the most security-relevant action on the profile and is open to operators on
  purpose: a number that never gets closed is the larger risk, and every close is audited.
- Vocabulary for this spec is in CONTEXT.md: Party, PartyContact, Service provider, Lead, Party
  directory (אנשי קשר), Party label.

## Comment — 2026-10-12

Closed. All ten children are closed. The contacts tab lists every party, and the profile shows the identity, the contacts, the labels, the national id, the edit history and the calls this party opened. A person or a company can be created by hand, a service provider is a company party, and a name is stored split. The review of the last child found the calls list matches the ticket. The route test opens the newer call first, so it would not catch a list that followed creation order. The query sorts by the day the call was opened.
