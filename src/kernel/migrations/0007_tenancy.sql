-- Slice 2.2. Tenancy and TenancyParty -- the join between a unit and the people in it, in time, and
-- the table foundation rule 7 is enforced on.
--
-- E7 and E8 from the workbook's FIELDS sheet (docs/model/), 12 columns and no others. Conventions
-- this file follows and does not restate: uuid ids, enums as text with a CHECK rather than a
-- Postgres enum type, migrations append-only, DDL and backfill never in one file, and no
-- `DEFAULT now()` -- the FIELDS sheet gives these entities no timestamp at all, and every date below
-- is a fact somebody records rather than a clock reading.
--
-- The last two relations src/scope/internal/isolation-join.ts has read since 1.7 land here. The
-- seven policy cases that have reported pending since then -- `party` until 2.1, `tenancy` since --
-- start asserting for real the moment this file applies, with no edit to any of them. That is the
-- whole of what this migration is for; the constraints below are what it has to be right about.
--
-- NO RENT. NO DEPOSIT. NO BALANCE, here or ever (foundation rule 2). Financials live in Priority
-- behind read-only keys, and a column here would be the first place someone put an amount the agent
-- could read.

-- The target `Tenancy.terms_profile_id` needs in order to be the NOT NULL foreign key the workbook
-- specifies. Which maintenance annex governs a lease is what the responsibility decision keys on
-- (Q4), so it may not be nullable and quietly absent -- and open question 2, how many profiles are
-- in force, is week 5's, with the matrix that reads them week 6's.
--
-- So this is E1 PROJECT's move at 1.9, for the same reason: identity now, fields when we know what
-- they must carry. What it costs is that the importer has to say which profile each lease is on,
-- which is a question for the client that a nullable column would have hidden until week 6.
CREATE TABLE IF NOT EXISTS terms_profile (
  terms_profile_id uuid PRIMARY KEY,
  name text NOT NULL
);

-- E7 -- TENANCY. One lease term on one unit. It is not a field on the unit, and no column anywhere
-- names the household in occupation -- foundation rule 1, enforced by guard one, whose forbidden
-- column name this comment deliberately does not spell: the guard is absolute and a match in a
-- comment fails the build as readily as a match in DDL, which is the whole of its value at 2am.
-- Who lives in a unit today is computed from these dates on every load. A unit accumulates tenancies
-- and never overwrites them (R5) -- the old one ends and the next one starts, because "who lived
-- here in March 2025" is the question a dispute asks.
CREATE TABLE IF NOT EXISTS tenancy (
  tenancy_id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES unit (unit_id),
  start_date date NOT NULL,
  -- Contractual end. Together with start_date this is the isolation window.
  end_date date NOT NULL,
  status text NOT NULL CHECK (
    status IN ('DRAFT', 'ACTIVE', 'ENDED', 'TERMINATED_EARLY')
  ),
  terms_profile_id uuid NOT NULL REFERENCES terms_profile (terms_profile_id),
  -- When notice was given, if it was.
  notice_date date,
  -- Reality, when it differs from end_date. It is why the constraint below is partial.
  actual_move_out date,

  -- Written as `end_date >= start_date` rather than the other way round, deliberately. Guard two
  -- matches the join's tenancy-active predicate -- a start at or before the day being asked about
  -- and an end at or after it -- over whitespace-collapsed text, and the mirrored spelling cannot
  -- collide with it. This is a question about one row's own period, not about a day being asked
  -- about; 2.1 learned the distinction by tripping the guard on `validity_is_ordered`, and the
  -- predicate is described here in prose rather than quoted for the same reason 2.1's test file was
  -- rewritten: a guard that scans this repository scans its own documentation.
  CONSTRAINT tenancy_period_is_ordered CHECK (end_date >= start_date),

  -- Reality cannot precede the lease. A move-out after end_date is ordinary -- a tenant who
  -- overstays -- so only the lower bound is stated.
  CONSTRAINT move_out_follows_start CHECK (
    actual_move_out IS NULL OR actual_move_out >= start_date
  ),

  -- One lease per unit per start date, so a re-run of the importer is a no-op rather than a
  -- duplicate. It covers every status, where the exclusion constraint below covers only ACTIVE.
  -- 1.9 shipped the estate spine with no natural key and 1.11 measured the cost -- the same fixture
  -- applied twice produced two buildings, 368 spaces and 144 units -- so this one lands with the
  -- table rather than with its first importer (slice 2.4 uses it, and chooses `party`'s, which is
  -- the genuinely open one).
  CONSTRAINT tenancy_natural_key UNIQUE (unit_id, start_date),

  -- **The workbook's own note on end_date, declared rather than hoped for:** "Together with
  -- start_date this is the isolation window. No overlap allowed on one unit." An overlap means Q1 --
  -- who lives in unit 12 today -- returns two households for one apartment, which is the mirror of
  -- 2.1's two-units-for-one-number and is stated the same way, as a statement about overlap.
  -- `'[]'` is inclusive at both ends, matching the join's day-grained reading, so a tenancy ending
  -- 30 June and another starting 30 June conflict: on that day the unit would have two households.
  --
  -- **Partial on ACTIVE, and that is the whole of the design.** A TERMINATED_EARLY tenancy keeps its
  -- contractual end_date while actual_move_out records reality -- a tenant who leaves in June on a
  -- lease running to December, with the next tenancy starting in August, is a correct history that a
  -- blanket constraint would reject. ACTIVE is exactly the set the isolation join reads, so this
  -- covers exactly the rows that can produce the defect and no others.
  --
  -- btree_gist, for the `=` operator on unit_id, was installed by 0006_parties.sql.
  CONSTRAINT one_active_tenancy_per_unit EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS tenancy_unit ON tenancy (unit_id);

-- E8 -- TENANCYPARTY. Who is on the lease, and in what role. A lease usually has more than one name
-- on it (R7): two spouses on one lease are two parties on one tenancy, and one person renting three
-- units over five years is one party on three tenancies. Without this table a second signatory has
-- nowhere to go and gets typed into a notes field, where no rule can read them.
CREATE TABLE IF NOT EXISTS tenancy_party (
  tenancy_id uuid NOT NULL REFERENCES tenancy (tenancy_id),
  party_id uuid NOT NULL REFERENCES party (party_id),
  -- GUARANTOR = ערב. On the lease, but not a resident.
  role text NOT NULL CHECK (
    role IN ('PRIMARY_TENANT', 'CO_TENANT', 'GUARANTOR', 'OCCUPANT')
  ),
  -- May this party open and discuss service calls for the unit?
  is_service_contact boolean NOT NULL,

  -- The workbook's key: one party holds one role on one tenancy.
  PRIMARY KEY (tenancy_id, party_id),

  -- **The rule this table exists to enforce.** Foundation rule 7, D4 in the workbook, and one of the
  -- three things the client called non-negotiable: a guarantor (ערב) never receives service
  -- information. The insert is *rejected*, not defaulted politely -- there is no toggle, no import
  -- path and no agent override, because a default is a thing someone trying to be helpful flips at
  -- 16:00 on a Thursday.
  --
  -- Treating everyone on a lease as "the tenant" leaks a household's business to the parent who
  -- co-signed, and the parent is on the lease precisely because they are not in the apartment.
  --
  -- The constraint is *spent* rather than merely stored: src/scope/'s isolation join carries
  -- `AND tp.is_service_contact` as its fourth hop, so a guarantor resolves to no unit at the front
  -- door. Both sides are policy cases -- the rejection is case 3, and the join asserts it from the
  -- other side in tests/policy/isolation.test.ts.
  CONSTRAINT guarantor_is_never_a_service_contact CHECK (
    role <> 'GUARANTOR' OR is_service_contact = false
  )
);

-- The isolation join's third hop is party -> tenancy_party, and the primary key above is
-- (tenancy_id, party_id), which does not serve it. No index on tenancy.end_date: Q5 -- leases ending
-- in the next 60 days across 1,500 units -- is 2.6's, decided at full row count with a timing in
-- front of it rather than assumed at a few thousand rows.
CREATE INDEX IF NOT EXISTS tenancy_party_party ON tenancy_party (party_id);
