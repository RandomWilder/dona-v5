-- #148. Assigned storage: the STORAGE space this household uses, not the
-- plan's built storage on the unit.
--
-- Same composite-key technique as the assigned bay (#146). Promotion of
-- storage_space_number lands here. Extending the CHECK is the same cost 4.3
-- named: a new typed column cannot be added by seeding a catalogue field.

ALTER TABLE tenancy
  ADD COLUMN storage_space_id uuid,
  ADD COLUMN storage_kind text NOT NULL DEFAULT 'STORAGE'
    CHECK (storage_kind = 'STORAGE');

ALTER TABLE tenancy
  ADD CONSTRAINT tenancy_assigned_storage_is_storage
    FOREIGN KEY (storage_space_id, storage_kind)
    REFERENCES space (space_id, space_kind);

CREATE INDEX IF NOT EXISTS tenancy_storage ON tenancy (storage_space_id);

ALTER TABLE field_promotion DROP CONSTRAINT field_promotion_target_check;

ALTER TABLE field_promotion ADD CONSTRAINT field_promotion_target_check
  CHECK (target IN (
    'tenancy.start_date',
    'tenancy.end_date',
    'tenancy.rent_amount',
    'tenancy.rent_currency',
    'tenancy.option_end_date',
    'tenancy.parking_space_id',
    'tenancy.storage_space_id',
    'unit.rooms',
    'space.floor'
  ));
