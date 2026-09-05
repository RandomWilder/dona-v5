-- Slice 1.9. The estate spine, and the first domain table in this repository.
--
-- E1-E4 from the workbook's FIELDS sheet (docs/model/), which SPEC.md treats as a specification and
-- not a description. 0001-0003 are the kernel's own -- the vector extension, the durability tables,
-- their settings seed -- and everything below is estate's.
--
-- Conventions this file follows and does not restate: ids are uuid, enums are text with a CHECK
-- rather than a Postgres enum type (0002's convention -- both cost a migration to widen, and a CHECK
-- is visible in \d and greppable here), migrations are append-only, and DDL and backfill never share
-- a file. There is no `DEFAULT now()` anywhere below and in fact no timestamp column at all: the
-- FIELDS sheet gives E1-E4 none, and a created_at written by anything but the injected clock is a
-- second source of truth no test can see.
--
-- What is deliberately absent is as much of the specification as what is here. Building.unit_count
-- and Unit.occupancy are derived and never stored (R6, and a stored count drifts the first time
-- someone adds a unit), and no column anywhere names the tenant -- foundation rule 1, the scope is a
-- view. src/estate/schema.test.ts asserts all three absences against information_schema.

-- E1 -- PROJECT. Optional container above Building (workbook decision D2). It exists so Shoham can
-- grow into it; fields are added when we know what it must carry.
CREATE TABLE IF NOT EXISTS project (
  project_id uuid PRIMARY KEY,
  name text NOT NULL,
  -- The דירה להשכיר tender code. Moved here from Building by D2 so one fact has one home.
  project_code text NOT NULL,
  tender_ref text,
  status text NOT NULL CHECK (status IN ('PLANNING', 'ACTIVE', 'EXITED'))
);

-- E2 -- BUILDING. project_id is nullable on purpose (R15): a standalone building leaves it empty and
-- loses nothing, and nothing downstream requires a project to exist before it is useful.
CREATE TABLE IF NOT EXISTS building (
  building_id uuid PRIMARY KEY,
  name text NOT NULL,
  address_line text NOT NULL,
  city text NOT NULL,
  project_id uuid REFERENCES project (project_id),
  -- When Dona Dom took possession from the developer. Starts תקופת הבדק.
  handover_date date NOT NULL,
  -- Default end of תקופת הבדק for everything in this building; a unit or an asset may override it
  -- (R14), which is why unit carries a nullable one of its own.
  warranty_end_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'IN_CONSTRUCTION', 'EXITED'))
);

-- E3 -- SPACE. Every addressable place, apartments included. space_kind does most of the work in the
-- responsibility rule (R4): UNIT is the only kind that can ever be the tenant's, COMMON, TECHNICAL
-- and EXTERIOR never are, and PARKING and STORAGE follow the unit they are assigned to.
CREATE TABLE IF NOT EXISTS space (
  space_id uuid PRIMARY KEY,
  -- R1, and mandatory: a garden shared between three cores has to hang off one of them today. See
  -- SPEC-estate.md, "Open".
  building_id uuid NOT NULL REFERENCES building (building_id),
  space_kind text NOT NULL CHECK (
    space_kind IN ('UNIT', 'COMMON', 'TECHNICAL', 'EXTERIOR', 'PARKING', 'STORAGE')
  ),
  name text NOT NULL,
  -- Text, not an integer: ground, basement and roof are not numbers.
  floor text,
  -- pii -- how a technician physically gets into a home. Free text that acquires a name and a phone
  -- number the first week it is used, which is why it is marked here rather than after it has.
  access_note text,
  -- Not decoration and not a second primary key. It is the target R2 and D3 need: a foreign key may
  -- only reference a UNIQUE constraint, so this is what lets `unit` reference a space *and its
  -- kind* in one key, and it is why neither rule needs a trigger.
  UNIQUE (space_id, space_kind)
);

CREATE INDEX IF NOT EXISTS space_building ON space (building_id);
CREATE INDEX IF NOT EXISTS building_project ON building (project_id);

-- E4 -- UNIT. The leasable subset of Space, sharing its key (R2): a unit IS a space.
CREATE TABLE IF NOT EXISTS unit (
  unit_id uuid PRIMARY KEY,
  -- As printed on the door and written in the lease. Text, not a number: '12A' exists.
  unit_number text NOT NULL,
  -- Israeli convention: 3, 3.5, 4.
  rooms numeric NOT NULL,
  area_sqm numeric,
  -- Does it have a ממ"ד. Safety-relevant, and it comes up in service calls about the ventilation and
  -- the door seal.
  has_mamad boolean NOT NULL,
  parking_space_id uuid,
  storage_space_id uuid,
  -- Overrides the building's date when this unit was handed over separately (R14).
  warranty_end_date date,
  -- D6 -- a plain enum, and NOT occupancy. Whether the unit is occupied is derived from tenancy
  -- dates and is never stored here.
  condition_status text NOT NULL CHECK (
    condition_status IN ('READY', 'RENOVATION', 'WITHHELD')
  ),

  -- Three constant discriminators, and the only reason they exist is the three foreign keys below.
  -- Each is pinned to one value by a CHECK, so they carry no fact and nothing writes them: the
  -- default is the whole of their content, which is what lets every insert in the repository name
  -- the workbook's columns and no others.
  space_kind text NOT NULL DEFAULT 'UNIT' CHECK (space_kind = 'UNIT'),
  parking_kind text NOT NULL DEFAULT 'PARKING' CHECK (parking_kind = 'PARKING'),
  storage_kind text NOT NULL DEFAULT 'STORAGE' CHECK (storage_kind = 'STORAGE'),

  -- R2, declared rather than enforced by an application that has to remember to. One key rejects a
  -- unit with no space, rejects a unit on a lobby, and refuses to let a space stop being a UNIT
  -- while its unit exists -- the last of which is the one a trigger would have been written to
  -- catch and would have caught only on insert.
  FOREIGN KEY (unit_id, space_kind) REFERENCES space (space_id, space_kind),

  -- D3, by the same mechanism: a bay is a Space of kind PARKING so it can hold a gate motor and
  -- receive service calls, which is worth nothing if an apartment can be assigned as one. MATCH
  -- SIMPLE leaves the key unenforced while the id is null, and unassigned is the ordinary state.
  FOREIGN KEY (parking_space_id, parking_kind) REFERENCES space (space_id, space_kind),
  FOREIGN KEY (storage_space_id, storage_kind) REFERENCES space (space_id, space_kind)
);

CREATE INDEX IF NOT EXISTS unit_parking ON unit (parking_space_id);
CREATE INDEX IF NOT EXISTS unit_storage ON unit (storage_space_id);
