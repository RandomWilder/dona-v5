-- Slice 2.1. Party and PartyContact -- the agent's front door, and the first tables in this
-- repository with a person in them.
--
-- E5 and E6 from the workbook's FIELDS sheet (docs/model/), 13 columns and no others. Conventions
-- this file follows and does not restate: uuid ids, enums as text with a CHECK rather than a
-- Postgres enum type, migrations append-only, DDL and backfill never in one file, and no
-- `DEFAULT now()` anywhere -- verified_at is written by the injected clock or not at all.
--
-- Why E6 is its own entity, dated, rather than a phone column on E5: v3 stored the number on the
-- party undated, so a tenancy ended, the carrier reassigned the number, and the isolation join
-- still resolved it to the previous tenant's apartment. That was a security defect and not a
-- modelling preference (docs/from-v3.md Tier 3). Foundation rule 1's join reads
-- `PartyContact (valid today)` as its first hop precisely so the case is representable.
--
-- Two of the five relations src/scope/internal/isolation-join.ts has read since 1.7 land here.
-- `tenancy` and `tenancy_party` arrive at 2.2, which is where the seven policy cases stop being
-- pending -- this migration moves their diagnostic from `party` to `tenancy` and nothing more.

-- Needed by party_contact's exclusion constraint below, for the `=` operators on channel and value.
-- A contrib extension, present in pgvector/pgvector:pg16 and supported on Cloud SQL; checked in the
-- local container before this line was written rather than after, which is 0001's own lesson.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- E5 -- PARTY. A person or a company, and never "a tenant": a party *plays* the tenant role in a
-- tenancy, and the role lives on tenancy_party (E8, slice 2.2). One party on three tenancies over
-- five years is one row here.
CREATE TABLE IF NOT EXISTS party (
  party_id uuid PRIMARY KEY,
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON', 'COMPANY')),
  -- pii -- the name of a real person or company.
  full_name text NOT NULL,
  -- pii -- ת.ז. for a person, ח.פ. for a company. Admin-only, unreachable by any agent tool and
  -- access-logged (SPEC.md, Security defaults); that it never appears in an agent tool's response
  -- shape is a policy case, written at week 5 with the staff surface that could leak it.
  --
  -- Nullable because we frequently do not have it, and a required identifier is one that gets typed
  -- as '000000000' within a week. It is deliberately *not* a natural key -- see SPEC-parties.md,
  -- "What is deliberately not here", and slice 2.4, which chooses one against the real export.
  national_id text,
  -- Drives which language the agent opens in. NOT NULL with a default where the workbook marks the
  -- column optional: the sheet's own note is "Default he", and a null language is not a behaviour
  -- the agent can have. A literal default is not a clock and does not breach the DEFAULT now() rule.
  preferred_language text NOT NULL DEFAULT 'he' CHECK (
    preferred_language IN ('he', 'ar', 'ru', 'fr', 'en')
  )
);

-- E6 -- PARTYCONTACT. One channel belonging to one party over one period.
CREATE TABLE IF NOT EXISTS party_contact (
  contact_id uuid PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES party (party_id),
  channel text NOT NULL CHECK (channel IN ('PHONE', 'EMAIL')),
  -- pii -- a real person's phone number or email address. The most person-shaped column in the
  -- system, and the one guard three could not see until this slice taught it table-qualified names:
  -- `value` as a bare name would have fired on config_settings.value in 0002.
  value text NOT NULL,
  is_primary boolean NOT NULL,
  valid_from date NOT NULL,
  -- Null = still current, and the exclusion constraint below reads that as unbounded.
  valid_to date,
  -- When we last confirmed this number really is this person. No default: the clock is injected.
  verified_at timestamptz,

  -- Without this, an inverted pair fails inside the exclusion constraint's daterange() constructor
  -- with a bare "range lower bound must be less than or equal to range upper bound" and no
  -- constraint name. Postgres evaluates CHECKs before index constraints, so this turns that into
  -- 23514 on something a caller can act on. Measured, not assumed.
  CONSTRAINT validity_is_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),

  -- The workbook: "One format, always. Mixed formats break the inbound lookup silently." A number
  -- stored as 052-123-4567 and asked for as +972521234567 resolves to nobody, and that is
  -- indistinguishable from correct isolation -- the failure mode where nothing looks wrong. This is
  -- the backstop that makes it loud; *converting* at the edge is slice 2.3's (SPEC-scope.md).
  CONSTRAINT phone_is_e164 CHECK (
    channel <> 'PHONE' OR value ~ '^\+[1-9][0-9]{7,14}$'
  ),

  -- **The rule this table exists to enforce.** A contact value resolves to at most one party on any
  -- given day, and to different parties over different days. Both halves matter: without the second
  -- a recycled number could never be re-let; without the first the isolation join returns *two*
  -- units for one inbound number, which reads on screen exactly like a correct multi-tenancy
  -- result.
  --
  -- It is a statement about overlap, so it is declared as one rather than left to an application
  -- that has to remember to look before it writes. '[]' is inclusive at both ends, matching the
  -- join's own day-grained reading, so a contact ending 30 June and another starting 30 June
  -- conflict -- on that day the number would resolve to two people. A null valid_to is unbounded,
  -- so a later row is rejected while a current one is open: closing the old contact is a step
  -- somebody takes, not one the schema forgives.
  CONSTRAINT contact_value_resolves_to_one_party EXCLUDE USING gist (
    channel WITH =,
    value WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS party_contact_party ON party_contact (party_id);
