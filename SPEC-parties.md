# SPEC: parties

**Owns the agent's front door.** Shared conventions live in [SPEC.md](SPEC.md) and are not repeated
here. The column lists below are the workbook's FIELDS sheet ([docs/model/](docs/model/)), which is a
specification and not a description; where this file and the workbook disagree, the workbook is right
and this file is a bug.

- **Owns:** E5, E6 — Party · PartyContact.
- **Depends on:** kernel.
- **Built:** week 2, slice 2.1; the natural key and the module's two write commands at slice 2.4.

## The shape, and why it is this one

**A party is never "a tenant".** It is a person or a company, and it *plays* a role in a tenancy —
one party on three tenancies over five years, two spouses on one lease. The role lives on
`TenancyParty` (E8, slice 2.2) and never here, which is what lets a guarantor and a primary tenant be
the same kind of row and be reached differently.

**A contact is a channel over a period, not an attribute of a person.** This is the whole reason E6
exists as its own entity, and it is a security decision rather than a normalisation preference. v3
stored the phone number on the party, undated: a tenancy ended, the carrier reassigned the number,
and the join still resolved it to the previous tenant's apartment — a stranger reaching someone
else's home ([docs/from-v3.md](docs/from-v3.md) Tier 3). Foundation rule 1's join reads
`PartyContact (valid today)` as its first hop precisely because that case has to be *representable*
before it can be excluded.

## Tables — `src/kernel/migrations/0006_parties.sql`

The workbook's 13 columns and no others. Ids are `uuid`, enums are `text` with a `CHECK`, and the one
timestamp — `verified_at` — has no `DEFAULT now()`: it is written by the injected clock or not at all.

| Table | Columns |
|---|---|
| `party` | `party_id` PK · `party_kind` · `given_name?` · `family_name?` · `legal_name?` · `full_name` · `national_id?` · `preferred_language` |
| `party_contact` | `contact_id` PK · `party_id` FK → party · `channel` · `value` · `label?` · `is_primary` · `valid_from` · `valid_to?` · `verified_at?` |

Vocabularies: `party.party_kind` = `PERSON · COMPANY`; `party.preferred_language` = `he · ar · ru ·
fr · en`; `party_contact.channel` = `PHONE · EMAIL`.

`given_name`, `family_name`, `legal_name`, `full_name`, `national_id`, `party_contact.value` and
`party_contact.label` are commented `-- pii`. Guard three sees the name columns and `national_id` by
name; **`party_contact.value` and `party_contact.label` are not among the bare names, and the guard
was taught to see them** — below.

**#200. A name is stored in parts, and `full_name` is computed.** A `PERSON` has a `family_name` and
no `legal_name`; `given_name` is null when the person is known by one name. A `COMPANY` has a
`legal_name` and neither person name. A `CHECK` (`party_name_matches_kind`) rejects every other
combination. `full_name` is a stored generated column: `given_name` and `family_name` joined by one
space, the family name alone when `given_name` is null, the legal name for a company. Nothing writes
it. Rows that existed before the split keep their previous display string in `full_name_before_split`,
and the generated column uses that string only while the split columns are still null. The migration
does not parse those strings. `createParty` and `upsertParty` take the split fields.

**`preferred_language` is `NOT NULL DEFAULT 'he'`** where the workbook marks the column optional. The
sheet's own note is "Default he", and a null language is not a behaviour the agent can have: it opens
in *some* language on the first message. The default is what keeps the column honest without making
every writer state it.

**`national_id` is admin-only, unreachable by any agent tool, and access-logged** (SPEC.md, Security
defaults). It is nullable because we frequently do not have it and a required identifier would be
typed as `000000000` within a week. That it never appears in an agent tool's response shape is a
**policy case**, not a review — deterministic, so it belongs in `tests/policy/` beside the isolation
cases, and week 5 owns writing it ([archive/tasks-w1-7/roadmap.md](archive/tasks-w1-7/roadmap.md)).

## The rule this schema exists to enforce

> **A contact value resolves to at most one party on any given day, and to different parties over
> different days.**

Both halves matter. Without the second, a recycled number could never be re-let and every export
would fight the schema. Without the first, the isolation join returns **two** units for one inbound
phone number — a leak that reads on screen exactly like a correct multi-tenancy result, which is the
worst kind.

It is a statement about **overlap**, so it is declared as an overlap constraint and not as
application code that every future writer has to remember:

```sql
EXCLUDE USING gist (channel WITH =, value WITH =,
                    daterange(valid_from, valid_to, '[]') WITH &&)
```

- `'[]'` is inclusive at both ends, which is the same day-grained inclusive reading the isolation
  join already uses (`pc.valid_from <= $2 AND (pc.valid_to IS NULL OR pc.valid_to >= $2)`). A
  contact ending on 30 June and another starting on 30 June overlap, and are rejected — on that day
  the number would resolve to two people.
- A `NULL` upper bound is **unbounded**, which is what "null = still current" means. Any later row on
  the same value is therefore rejected while a current one is open: closing the old contact is a step
  somebody has to take, not one the schema will quietly forgive.
- `channel` is in the key, so a phone number and an email address that happen to be the same string
  do not collide.
- It needs `btree_gist` for the `=` operators, added by the same `CREATE EXTENSION IF NOT EXISTS`
  form `0001_init.sql` uses for `vector`. Present in `pgvector/pgvector:pg16` and supported on Cloud
  SQL; checked before the line was written, not after (`0001`'s own lesson).

Two CHECKs sit beside it and are not decoration:

- **`validity_is_ordered`** — `valid_to IS NULL OR valid_to >= valid_from`. Without it an inverted
  pair fails inside the exclusion constraint's `daterange()` constructor with a bare *"range lower
  bound must be less than or equal to range upper bound"* and no constraint name. Postgres evaluates
  CHECKs before index constraints, so this one turns that into `23514` on a named constraint.
- **`phone_is_e164`** — `channel <> 'PHONE' OR value ~ '^\+[1-9][0-9]{7,14}$'`. The workbook is
  explicit: *"One format, always. Mixed formats break the inbound lookup silently."* A number stored
  as `052-123-4567` and asked for as `+972521234567` resolves to nobody, and **that is
  indistinguishable from correct isolation** — the failure mode where nothing looks wrong. The CHECK
  makes it loud.

  This is a backstop and **not** the normaliser. Converting `052-123-4567` into `+972521234567` at
  the edge is slice 2.3's, where 1.7 carried it and [SPEC-scope.md](SPEC-scope.md) records it. Until
  then the CHECK is what stands between a badly-formatted import and a silent miss.

## The natural key — `src/kernel/migrations/0009_import_natural_keys.sql`

2.1 left this table with nothing unique but its primary key, deliberately, for the reason 1.9 left
`address_key` out and 1.11 vindicated. **Slice 2.4 chose it**, because that is the slice with an
importer that has to be run twice, and it is `address_key`'s technique applied to the identifier:
the normalisation lives in the database, so every writer gets it rather than every writer
remembering it.

```sql
national_id_key text GENERATED ALWAYS AS (
  CASE WHEN national_id IS NULL THEN NULL ELSE party_kind || ':' || <normalised> END
) STORED,  -- pii
CONSTRAINT party_natural_key UNIQUE (national_id_key)
```

Three decisions are inside that expression, and 2.1 named all three:

- **Leading zeros.** Every spreadsheet export drops them, so `042…` and `42…` are one person. An
  all-digit identifier of nine characters or fewer is left-padded to nine. A naive
  `UNIQUE (national_id)` is a key that disagrees with itself the first time a register arrives.
- **Two registries.** A ת.ז. and a ח.פ. can be the same nine digits, so `party_kind` is in the key.
- **Nullable.** A `UNIQUE` index ignores nulls, so a party with no identifier has no natural key —
  correct rather than a gap, because the lease flow (A2, [SPEC-flows.md](SPEC-flows.md)) legitimately
  creates a party from a document that names no ת.ז. An identifier that is *not* all digits — a
  passport — is normalised for case and separators only; padding it would be inventing a fact.

**The key is `-- pii`.** It is a normalised ת.ז., not an enforcement column carrying no fact, which
is where it differs from `address_key`. Guard three sees it by name and asks for the marker.

The register file format goes further than the schema does and **requires** an identifier on every
row ([SPEC-register.md](SPEC-register.md)): no identifier, no idempotence. That is a constraint on
one file format and not on the table, and it is a question put to the client rather than an
assumption made about them.

`party_contact` gains `UNIQUE (party_id, channel, value, valid_from)` in the same migration. That is
less a decision about the domain than one the upsert forces — `ON CONFLICT` needs a unique
constraint as its target and an `EXCLUDE` constraint cannot be one — and it sits *inside* the
exclusion constraint above rather than competing with it: every pair it rejects, the exclusion
constraint already rejected.

## The directory and the profile

**#202, administrator stance only.** An operator or an administrator opens **אנשי קשר** and sees every party. Search is one box. A word of a person's given name or family name, or of a company's legal name, finds that party — a whole word, so a fragment of a name does not. A phone finds the party in whatever form the door already accepts, because the composition root runs `normalisePhone` from `src/scope/` before this module is asked, and the same function is the one the inbound lookup uses. An email finds the party regardless of case, folded by `normaliseEmail` at that same root. A match includes a contact that has since been closed. The row shows the display name, the labels with their unit, the open primary phone, the open primary email and the language, and links to the profile.

The profile shows the given name and the family name, or the legal name, the kind, the language, every label linked to its tenancy, and every contact the party ever held, open and closed, with the dates it held them. Contact edits are #206.

**#203. A label is what the party is to us today, computed on every load and stored nowhere.** The tenancy contract returns each party's roles with each tenancy's status, dates and unit (`listRolesForParties`). This module does not learn them, and it does not decide which letting counts today. The composition root does, from those facts and the clock, and the reading is the isolation join's: the letting is `ACTIVE` and the clock's day falls inside the term, both ends inclusive. That is the same reading the occupancy view is filtered with, and it is not a second predicate — the query that returns the roles carries no day. The day after the term, a letting whose status is `ENDED`, and a letting ended early are past, including on the day after the term while the row is still `ACTIVE`, because the directory does not close lettings. A `DRAFT` is a draft tenancy. A guarantor is a guarantor on every tenancy state and never a tenant; the label carries that tenancy's state — פעיל when it counts today, טיוטה when it is a draft, עבר when it has ended, ended early, or the day is past the term. An occupant is named דייר, distinct from שוכר ראשי and שוכר נוסף. A party on several tenancies carries every label that applies. A party on no tenancy is אין קשר. The directory filters by those labels, and a filter combines with the search: the result is the parties that carry the label and match the box. A letting that is `ACTIVE` and has not started is not a current tenant, not a past tenant, and not אין קשר. The directory shows a dash for that party, the same mark as a missing phone, and none of the filters return them. No column, view or table stores a label or a tenancy state on the party. A service provider is #208, and a party that carries that label is not אין קשר.

**#204.** The profile shows the ת.ז. as a masked suffix to every role that can open it: the last four characters of the normalised identifier, and bullets before them. A party with no identifier shows a dash. That page does not carry the value. Only an administrator, holding `party.national_id.read`, sees a reveal control and a field to add or correct one. Revealing is its own request, `POST /parties/:partyId/national-id/reveal`. It returns the stored value on the profile and writes `parties.national_id.reveal`, naming the actor, the role and the party. A party that holds no identifier has nothing to disclose, so that post writes no audit line. An operator who posts it is refused by the route.

Searching by a ת.ז. is the same permission, through the same one box. A query the door already accepts as a phone or an email stays that search, so a landline is still a landline and an operator looking one up is not refused. A query of one to nine digits that the door refuses — hyphens, spaces, or the leading zero a spreadsheet dropped — is a ת.ז. search, matched by `party_national_id_key` for a person and for a company. An operator who submits one is refused by the route. An administrator's search writes `parties.national_id.search` naming the matched party ids and not the value typed, and the directory still shows no identifier, masked or plain. The box does not echo the value back; the page says the search was by ת.ז. and nothing more.

Adding or correcting a ת.ז. is `POST /parties/:partyId/national-id`, the same permission. It writes the column on that party. The generated key is what rejects a second holder: the statement does not upsert onto whoever already has it. A clash comes back as a conflict on the profile, linking to that party, and the row is unchanged. The audit line is `parties.national_id.write`. It names the party and the field. No audit row for the reveal, the search or the write carries a `national_id` value.

**#205.** An operator corrects a person's given name and family name, or a company's legal name, and the preferred language. The post is `POST /parties/:partyId`, guarded by `party.write`. The kind is not a field of the post. A blank given name is kept: the person is known by one name, and the display name is the family name alone. `party_name_matches_kind` still holds on the update. A person posted with a legal name, a company posted with a given or family name, or a required name left blank is refused, the row is unchanged, and the reason is on the profile. Each edit that changes a field writes one audit row, `parties.identity.write`, with the actor, the role, the party id and the names of the fields that changed. The new values are not on that row. The profile's history reads that party's audit rows back, newest first, and says who, when and which fields. A history row never shows a `national_id` value. When other parties share the display name, the profile says how many and links to each of them. Following a link reads that profile. Nothing is matched or merged on a name.

The directory and profile reads stay on this module's contract. The profile read includes the other parties who share the display name. The profile statement returns the four-character suffix and does not return the column. The reveal command is the one statement that reads `national_id`, and only the reveal route calls it. The write sets the column and leaves the key to the database. The identity update writes the name columns for the party's kind and leaves `full_name` generated. The page is composed at the composition root (`src/party-directory.ts`), so a later section from tenancy, estate or calls is added there, and the history is read there too: the audit log is the kernel's, and this module does not read it. The actor's name on a history row is the staff account's display name, or the email when there is none. This module still depends on the kernel only, and it still does not answer who is reachable on a number today — that remains `src/scope/`'s join. Listing a closed number here is not a scope.

**#206.** An operator adds a phone or an email to a party, starting today or on a date they give, with an optional label such as "יוסי – סדרן". A phone typed in any local form is stored in the international form: the composition root runs `normalisePhone` before this module is asked, the same function the door uses. An email is folded by `normaliseEmail` at that same root. The command stores the value it is given and does not fold it again. `party_contact.label` is nullable free text, `-- pii`, and the profile shows it. Marking a contact primary is what the directory row shows: the row's phone and email stay the open primaries, and the mark clears the other open primary of that channel. There is still no uniqueness constraint on `is_primary`. Closing a contact sets `valid_to` and keeps the row. There is no delete. The end date is the last day the number identifies anyone; from the day after, the isolation join resolves it to no unit. That is the recycled-number case with the close as the step that produces it, and it is a policy case beside that one, asserted through the scope contract. A value another party holds on any day of the new contact's period is refused, naming that party, and nothing is written. The exclusion constraint remains the rule; the command reads the other party back so the page can name them. Once a contact is closed, the same value can be added to its new holder from the following day — the day the periods stop overlapping. A phone search already matches a closed contact; the directory marks that match as a former number when no open contact of that value remains. Each add, primary change and close writes one audit row — `parties.contact.add`, `parties.contact.primary`, `parties.contact.close` — with the actor, the role, the party id, the contact id and the channel. The value and the label are not on that row. The posts are `POST /parties/:partyId/contacts`, `POST /parties/:partyId/contacts/:contactId/primary` and `POST /parties/:partyId/contacts/:contactId/close`, guarded by `party.write`. A viewer is refused.

`party.read` guards the directory and the profile. `party.write` guards `POST /parties/:partyId`, the three contact posts, creating a party by hand (#207), and marking a company a service provider (#208). The reveal, the ת.ז. search and the ת.ז. write are `party.national_id.read`, not `party.write`. A viewer holds neither `party.read` nor `party.write`, the tab is not shown, and those routes refuse.

**#207.** An operator creates a party by hand from the tab. A person takes a family name, an optional given name and a language. A company takes a legal name and a language. The party is kept only when it also carries one contact or a ת.ז. A party with neither is refused, the reason is on the form, and nothing is written. The contact is one phone or one email, open from today and primary, because that is the number the directory row shows. The composition root folds it with `normalisePhone` or `normaliseEmail` before this module is asked, the same functions #206 uses, and the command stores the value it is given. A value another party holds on any day of that open period refuses the whole create and names that party. No party row remains. A ת.ז. on this create is the administrator's, the same permission as #204. An operator who posts one is refused and nothing is written. An administrator may create from a ת.ז. alone. A ת.ז. another party holds refuses the whole create, names that party, and leaves no row. The command is `createPartyByHand`. `createParty` is still the lease path: a name alone, no contact, no identifier, always an insert, because there the lease is the evidence. The form is `GET /parties/new` and the post is `POST /parties`, both guarded by `party.write`. The ת.ז. field is on the form only for a role that holds `party.national_id.read`. One audit row, `parties.create`, names the actor, the role and the new party id. It carries no `national_id` value and no contact value.

**#208.** A service provider is a label, computed on every load and stored nowhere, the same way a tenancy role is. The estate contract returns each party's provider kind (`listProvidersForParties`). This module does not learn it, and it does not import estate. The composition root paints ספק שירות with the kind — צוות פנימי, קבלן, אחריות יזם — on the directory and on the profile. The label does not open a tenancy, because a provider has none. The directory filter ספק שירות returns those parties, and it combines with the search the way the other filters do. A company on no tenancy that is a provider is that label and not אין קשר. Marking is `POST /parties/:partyId/provider`, guarded by `party.write`. The post calls `linkProvider` on the estate contract. A person who is posted is refused, the page says so, and no provider row is written. A company's profile shows the kind already chosen, and posting another kind updates that one provider. A phone or an email on the party is an ordinary contact. Who holds that contact on a day, and whether it reaches a unit, is scope's answer (`partyHoldingContact`, the isolation join). The door uses the holder only when the join returned nobody, and only identifies the call when that party is a provider. The join still resolves the number to no unit, which is a policy case through the scope contract. This module still does not answer who reaches a unit.

## What is deliberately not here

- **No uniqueness on `is_primary`, and 2.4 confirmed it rather than revisiting it.** "At most one
  primary contact per party per channel" is a plausible rule the workbook does not state. The
  register carries one contact per row and does not say which of a party's numbers is primary, so a
  partial unique index would fail an import that touched two rows in the wrong order, on a rule
  nobody asked for.
- **Writes, and two reads that are not the directory.** `contract.ts` exists from 2.4 and exports two write commands — `upsertParty`
  and `upsertPartyContact` — because the register importer is the caller 2.1 predicted. Slice 4.6
  added `createParty` for flow A2: a lease names a person and often no ת.ז., so an upsert on
  `national_id_key` would be an insert wearing an upsert's name. `createParty` is always an insert
  (`national_id` null). Two calls with the same name are two people. **Slice 5.5 kept that:** 0
  nameless parties in the generated portfolio, so no count that would justify matching a name.
  **#107 adds `listPartyNames`**, the narrowest read
  the tenancy page is allowed: ids in, `party_id` and `full_name` out, never a contact and never a
  `national_id`. Who is reachable on a number is still `src/scope/`'s answer. Evidence calls the
  write commands after a human confirms the role, and never matches a name across tenancies.

  **Slice 6.5 narrows `createParty` to the case its comment was written for.** 6.4 put a declared
  ת.ז. on the capture path, so a lease no longer *often* names none — it names one when the paper
  prints one. Where it does, A2 writes the party through **`upsertParty`**, keyed on
  `national_id_key`, and one person signing two leases in two flats is one party with two tenancies.
  Where it does not, `createParty` is still the command, still always an insert, and two calls with
  the same name are still two people. Nothing about matching a **name** changed, and 5.5's 303 shared
  full names are still the reason. What changed is that the identifier this module has always keyed
  on now has a second source besides the register: a human confirming a household at A2's screen.

  **And one function that reads no table.** `countDistinctIdentifiers` answers *how many people do
  these identifiers name*, which A2 asks before it writes anybody: a lease naming two people and
  printing one ת.ז. twice would otherwise put one party under two roles on one letting, and
  `tenancy_party`'s key is `(tenancy_id, party_id)`, so the second row overwrites the first and the
  household comes out a member short of the paper. The comparison cannot be made on the strings —
  `312345678` and `312-345-678` are two strings and one person, which is the whole reason
  `national_id_key` exists — so the fold makes it, in one statement, and **a number comes back**.
  It reads no row and asks what a value *would* key on, never who exists. The directory above is
  the read that names who exists. Who is reachable on a number today is still `src/scope/`'s
  answer.

  **The normalisation still lives in the database, and now has a name.** Slice 6.5 adds
  `party_national_id_key(party_kind, national_id)`, an `IMMUTABLE` function holding the same fold the
  generated column below is written with, because A2's resolution has to normalise an identifier read
  off a document *before* any party row exists to compare it to. The generated column is not
  rewritten — one expression, two callers, and a schema test asserts the function and the column agree
  on every stored row and on the awkward literals (a hyphen, spaces, a dropped leading zero, a
  passport, a `COMPANY`). A second copy of the fold in TypeScript is the thing this avoids: a
  normaliser in two places is one that drifts, which is the reason already written above
  `upsertPartyContact`.
- **No btree on `(channel, value)`, and 2.6 answered that with a measurement rather than deferring
  it again.** 2.1's reasoning was right on the facts: the lookup is served today by
  `contact_value_resolves_to_one_party`, which is a **GiST** index, and GiST is slower than btree at
  plain equality. Measured over 2,871 contacts, the same lookup on three values in one session —
  GiST 4–6 buffers and 0.031–0.062 ms, btree 2–3 buffers and 0.009–0.017 ms. Three times the time,
  and it is the isolation join's first hop.

  **The btree was still not added, because with both indexes present the planner chose the GiST one
  every time** — its estimated startup cost is lower (0.14 against 0.28) and so is its total. An
  index the planner will not choose is not an optimisation, it is a write cost with a comment, and
  the register writes 2,871 rows into this table. The gain is real, it is 0.04 ms per lookup, and it
  is unreachable while the exclusion constraint's index is the cheaper plan. **Reopened when the
  agent goes live on the pilot** (week 12), where the fix is not "add the btree" — that was tried —
  but changing what the exclusion constraint's index looks like to the cost model.

## Guard three learned a table-qualified name here

`party_contact.value` holds a phone number or an email address and is the most person-shaped column
in the system, and guard three **could not see it**: `scripts/guards.ts` matches on bare column names,
and adding `value` to the list would fire on `config_settings.value` in `0002_kernel_durability.sql`
— a false positive that teaches people to work around a guard, which is worse than the gap.

The guard now tracks the enclosing `CREATE TABLE` while it scans, so its list can carry qualified
entries (`party_contact.value`) beside bare ones. Its own comment said *"a column this list misses is
added to it when it is met"*; this is the first one met, and the rule stayed the rule. **#206 taught
it `party_contact.label` the same way.** `label` is a word other tables will use for something that
is not a person, so the bare name stays off the list and the qualified name is what asks for the marker.

## Open

- **Closed at 2.4 — how a party is deduplicated on import.** `national_id_key`, above. It was chosen
  against a *designed* register file rather than against Dona Dom's export, because the real register
  moved to step 4 of the method on 6 Sep ([SPEC-flows.md](SPEC-flows.md)) and the alternative was
  deferring a key that 2.6 needs at volume. What the designed file cannot answer is whether the real
  export carries an identifier on every row; that is slice 2.5's, with the export in hand.
- **Whether a company party needs a contact person.** A `COMPANY` party with a `full_name` of the
  company and a `party_contact` of whoever answers the phone works today. #206 records a short label
  on that contact and does not make the person who answers a party. If the operator needs the
  contact's own record, that is a person party and a relationship between them, and it is a
  workbook change before it is a migration.
