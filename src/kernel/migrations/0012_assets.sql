-- Slice 3.5. E14 Provider (stub) and E11 Asset, from the workbook's FIELDS sheet.
--
-- Provider is first because Asset.warranty_provider_id references it (R11). It is three columns
-- and a unique on name, so a seed can be run twice; everything else about providers waits. It
-- lives in estate's migration because R11 is an Asset fact and a second module for three columns
-- would be a cycle looking for a home (SPEC-estate.md).
--
-- Asset is the workbook's fourteen columns and no others. space_id is NOT NULL (R3). asset_type
-- is a governed list, not a catalogue row, because the responsibility matrix keys on it
-- (foundation rule 8), and the class/type pair is a composite CHECK so a SAFETY sprinkler cannot
-- be filed as a FIXTURE. source_document_id is R12. The index is asset (space_id), for the join
-- Q3 and Q7 both take; an index on next_inspection_due is deferred to a measurement (2.6).
--
-- Conventions this file follows and does not restate: uuid ids, enums as text with a CHECK,
-- migrations append-only, DDL and backfill never in one file, and no DEFAULT now().

-- E14 -- PROVIDER. Stub only. Present so an asset under warranty can point at who must fix it
-- during תקופת הבדק.
CREATE TABLE IF NOT EXISTS provider (
  provider_id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  provider_kind text NOT NULL CHECK (
    provider_kind IN ('IN_HOUSE_CREW', 'CONTRACTOR', 'DEVELOPER_WARRANTY')
  )
);

-- E11 -- ASSET. Anything that breaks, is inspected, or is handed over — in exactly one space.
CREATE TABLE IF NOT EXISTS asset (
  asset_id uuid PRIMARY KEY,

  -- R3. Always exactly one space. This is what makes "what is overdue in this building" and
  -- "which bay is assigned to unit 12" one join each.
  space_id uuid NOT NULL REFERENCES space (space_id),

  asset_class text NOT NULL CHECK (asset_class IN ('FIXTURE', 'SAFETY', 'UTILITY')),

  -- Governed, not admin-editable. The pairs are the workbook's own class examples, enumerated
  -- at 3.5 because a governed list that is nowhere written down is not governed.
  asset_type text NOT NULL CHECK (
    asset_type IN (
      'AC', 'WATER_HEATER', 'OVEN', 'BLINDS', 'PLUMBING',
      'EXTINGUISHER', 'SPRINKLER', 'SMOKE_DETECTOR', 'EMERGENCY_LIGHT', 'MAMAD_BLAST_DOOR',
      'PUMP', 'ELEVATOR', 'BOILER', 'GATE_MOTOR', 'INTERCOM', 'METER'
    )
  ),
  CONSTRAINT asset_type_matches_class CHECK (
    (asset_class = 'FIXTURE' AND asset_type IN (
      'AC', 'WATER_HEATER', 'OVEN', 'BLINDS', 'PLUMBING'
    ))
    OR (asset_class = 'SAFETY' AND asset_type IN (
      'EXTINGUISHER', 'SPRINKLER', 'SMOKE_DETECTOR', 'EMERGENCY_LIGHT', 'MAMAD_BLAST_DOOR'
    ))
    OR (asset_class = 'UTILITY' AND asset_type IN (
      'PUMP', 'ELEVATOR', 'BOILER', 'GATE_MOTOR', 'INTERCOM', 'METER'
    ))
  ),

  make_model text,
  -- -- not-pii: identifies a thing, never a person. Guard three matches identifier-shaped names
  -- and cannot see the difference; the sentence is written where a reviewer asking the obvious
  -- question will find it.
  serial_no text,
  installed_date date,
  warranty_end_date date,

  -- R11. Who owes the fix while it is in warranty. Nullable: an asset out of warranty, or one
  -- whose provider is not yet known, still exists.
  warranty_provider_id uuid REFERENCES provider (provider_id),

  compliance_regime text NOT NULL CHECK (
    compliance_regime IN ('NONE', 'PERIODIC_INSPECTION')
  ),
  next_inspection_due date,
  last_certificate_document_id uuid REFERENCES document (document_id),

  -- R12. The handover protocol that created this row. Nullable because an asset can also arrive
  -- lazily from a service call, which is the published Data Model's fallback when no protocol
  -- is on file.
  source_document_id uuid REFERENCES document (document_id),

  status text NOT NULL CHECK (status IN ('IN_SERVICE', 'FAULTY', 'REMOVED')),

  -- One of each kind in a place: a bay has one gate motor, a flat has one water heater. A second
  -- AC in the same apartment is a later problem; a re-run of the seed creating a second row of
  -- the same type is the problem this stops today.
  UNIQUE (space_id, asset_type)
);

CREATE INDEX IF NOT EXISTS asset_space ON asset (space_id);
