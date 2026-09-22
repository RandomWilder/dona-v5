-- #141. Estate promotion family: a log for old → new on a place, and two
-- more FieldPromotion targets the lease may establish.
--
-- Tenancy promotion records itself in tenancy_event. Estate had no counterpart,
-- so a promoted room count would replace an operator's typed value with only
-- the evidence-side stamp as history. This table is that counterpart: append-
-- only, at from the injected clock, no DEFAULT now(), kind = amended only and
-- that kind always names a source document.
--
-- One table, keyed by the entity the promotion wrote. document_link already
-- has the discriminator shape; a CHECK enum plus two nullable ids is the
-- cheaper mirror of it. No space_id: unit.rooms and space.floor on the unit's
-- space share unit_id.
--
-- Deliberately not event sourcing. A11, A13 and the register importer do not
-- write here. The typed original is old_value on the first promotion row.
--
-- The CHECK on field_promotion.target is the same cost 4.3 named: a new typed
-- column cannot be added by seeding a catalogue field. unit.rooms and
-- space.floor widen. gush, helka and building_number stay typed.

ALTER TABLE field_promotion DROP CONSTRAINT field_promotion_target_check;

ALTER TABLE field_promotion ADD CONSTRAINT field_promotion_target_check
  CHECK (target IN (
    'tenancy.start_date',
    'tenancy.end_date',
    'tenancy.rent_amount',
    'tenancy.rent_currency',
    'tenancy.option_end_date',
    'unit.rooms',
    'space.floor'
  ));

CREATE TABLE IF NOT EXISTS estate_event (
  estate_event_id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('BUILDING', 'UNIT')),
  building_id uuid REFERENCES building (building_id),
  unit_id uuid REFERENCES unit (unit_id),
  at timestamptz NOT NULL,
  -- pii -- the operator who approved the change, a snapshot.
  actor text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('amended')),
  field text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  source_document_id uuid REFERENCES document (document_id),
  extracted_field_id uuid REFERENCES extracted_field (extracted_field_id),
  CONSTRAINT estate_event_one_entity CHECK (
    (entity_type = 'BUILDING' AND building_id IS NOT NULL AND unit_id IS NULL)
    OR (entity_type = 'UNIT' AND unit_id IS NOT NULL AND building_id IS NULL)
  ),
  CONSTRAINT estate_event_amended_names_its_document CHECK (
    kind <> 'amended' OR source_document_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS estate_event_unit
  ON estate_event (unit_id)
  WHERE unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS estate_event_building
  ON estate_event (building_id)
  WHERE building_id IS NOT NULL;

CREATE OR REPLACE FUNCTION estate_event_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'estate_event is append-only'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estate_event_is_append_only ON estate_event;
CREATE TRIGGER estate_event_is_append_only
  BEFORE UPDATE OR DELETE ON estate_event
  FOR EACH ROW EXECUTE FUNCTION estate_event_is_append_only();
