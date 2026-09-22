-- #146. The assigned bay: where this household parks, not what the plan
-- attached to the flat.
--
-- unit.parking_space_id is the built bay. Promoting a lease's bay number
-- onto it would write a tenancy fact onto an estate row that outlives the
-- letting — the same class of error foundation rule 1 forbids. The assigned bay is
-- a nullable FK on tenancy, constrained to a PARKING space by the same
-- composite-key technique D3 used on unit.
--
-- A landlord may move the household with no amendment and no new document,
-- so tenancy_event gains kind = reassigned, which must not name a source
-- document. amended_names_its_document is not dropped.
--
-- parking_space_number may now be a promotion target. Extending the CHECK
-- is the same cost 4.3 named: a new typed column cannot be added by seeding
-- a catalogue field.

ALTER TABLE tenancy
  ADD COLUMN parking_space_id uuid,
  ADD COLUMN parking_kind text NOT NULL DEFAULT 'PARKING'
    CHECK (parking_kind = 'PARKING');

ALTER TABLE tenancy
  ADD CONSTRAINT tenancy_assigned_bay_is_parking
    FOREIGN KEY (parking_space_id, parking_kind)
    REFERENCES space (space_id, space_kind);

CREATE INDEX IF NOT EXISTS tenancy_parking ON tenancy (parking_space_id);

ALTER TABLE tenancy_event DROP CONSTRAINT tenancy_event_kind_check;

ALTER TABLE tenancy_event ADD CONSTRAINT tenancy_event_kind_check
  CHECK (kind IN (
    'amended', 'terminated', 'activated', 'extended', 'reassigned'
  ));

ALTER TABLE tenancy_event ADD CONSTRAINT reassigned_has_no_document CHECK (
  kind <> 'reassigned'
  OR (source_document_id IS NULL AND extracted_field_id IS NULL)
);

ALTER TABLE field_promotion DROP CONSTRAINT field_promotion_target_check;

ALTER TABLE field_promotion ADD CONSTRAINT field_promotion_target_check
  CHECK (target IN (
    'tenancy.start_date',
    'tenancy.end_date',
    'tenancy.rent_amount',
    'tenancy.rent_currency',
    'tenancy.option_end_date',
    'tenancy.parking_space_id',
    'unit.rooms',
    'space.floor'
  ));
