-- #180. A second assigned storage: the other STORAGE space this household
-- holds when the lease names two. The first column stays the first room.
--
-- Same composite-key technique as #148. Promotion of
-- second_storage_space_number lands here, never on the built storage and
-- never on storage_space_id. Extending the CHECK is the same cost 4.3 named.

ALTER TABLE tenancy
  ADD COLUMN second_storage_space_id uuid,
  ADD COLUMN second_storage_kind text NOT NULL DEFAULT 'STORAGE'
    CHECK (second_storage_kind = 'STORAGE');

ALTER TABLE tenancy
  ADD CONSTRAINT tenancy_second_assigned_storage_is_storage
    FOREIGN KEY (second_storage_space_id, second_storage_kind)
    REFERENCES space (space_id, space_kind);

CREATE INDEX IF NOT EXISTS tenancy_second_storage ON tenancy (second_storage_space_id);

ALTER TABLE field_promotion DROP CONSTRAINT field_promotion_target_check;

ALTER TABLE field_promotion ADD CONSTRAINT field_promotion_target_check
  CHECK (target IN (
    'tenancy.start_date',
    'tenancy.end_date',
    'tenancy.rent_amount',
    'tenancy.rent_currency',
    'tenancy.option_end_date',
    'tenancy.parking_space_id',
    'tenancy.second_parking_space_id',
    'tenancy.storage_space_id',
    'tenancy.second_storage_space_id',
    'unit.rooms',
    'space.floor'
  ));
