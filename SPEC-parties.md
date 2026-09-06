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
| `party` | `party_id` PK · `party_kind` · `full_name` · `national_id?` · `preferred_language` |
| `party_contact` | `contact_id` PK · `party_id` FK → party · `channel` · `value` · `is_primary` · `valid_from` · `valid_to?` · `verified_at?` |

Vocabularies: `party.party_kind` = `PERSON · COMPANY`; `party.preferred_language` = `he · ar · ru ·
fr · en`; `party_contact.channel` = `PHONE · EMAIL`.

`full_name`, `national_id` and `party_contact.value` are commented `-- pii`. The first two are seen
by guard three by name; **the third is not, and the guard was taught to see it** — below.

**`preferred_language` is `NOT NULL DEFAULT 'he'`** where the workbook marks the column optional. The
sheet's own note is "Default he", and a null language is not a behaviour the agent can have: it opens
in *some* language on the first message. The default is what keeps the column honest without making
every writer state it.

**`national_id` is admin-only, unreachable by any agent tool, and access-logged** (SPEC.md, Security
defaults). It is nullable because we frequently do not have it and a required identifier would be
typed as `000000000` within a week. That it never appears in an agent tool's response shape is a
**policy case**, not a review — deterministic, so it belongs in `tests/policy/` beside the isolation
cases, and week 5 owns writing it ([tasks/roadmap.md](tasks/roadmap.md)).

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

## What is deliberately not here

- **No uniqueness on `is_primary`, and 2.4 confirmed it rather than revisiting it.** "At most one
  primary contact per party per channel" is a plausible rule the workbook does not state. The
  register carries one contact per row and does not say which of a party's numbers is primary, so a
  partial unique index would fail an import that touched two rows in the wrong order, on a rule
  nobody asked for.
- **No read model.** `contract.ts` exists from 2.4 and exports two write commands — `upsertParty`
  and `upsertPartyContact` — because the register importer is the caller 2.1 predicted. There is
  still no screen over this module and no query on its contract; `src/scope/` answers who is
  reachable, and 2.6's grid reads estate.

## Guard three learned a table-qualified name here

`party_contact.value` holds a phone number or an email address and is the most person-shaped column
in the system, and guard three **could not see it**: `scripts/guards.ts` matches on bare column names,
and adding `value` to the list would fire on `config_settings.value` in `0002_kernel_durability.sql`
— a false positive that teaches people to work around a guard, which is worse than the gap.

The guard now tracks the enclosing `CREATE TABLE` while it scans, so its list can carry qualified
entries (`party_contact.value`) beside bare ones. Its own comment said *"a column this list misses is
added to it when it is met"*; this is the first one met, and the rule stayed the rule.

## Open

- **Closed at 2.4 — how a party is deduplicated on import.** `national_id_key`, above. It was chosen
  against a *designed* register file rather than against Dona Dom's export, because the real register
  moved to step 4 of the method on 6 Sep ([SPEC-flows.md](SPEC-flows.md)) and the alternative was
  deferring a key that 2.6 needs at volume. What the designed file cannot answer is whether the real
  export carries an identifier on every row; that is slice 2.5's, with the export in hand.
- **Whether a company party needs a contact person.** A `COMPANY` party with a `full_name` of the
  company and a `party_contact` of whoever answers the phone works today. If the operator needs the
  contact's own name recorded, that is a person party and a relationship between them, and it is a
  workbook change before it is a migration.
