-- #179. A second assigned bay: the other PARKING space this household
-- holds when the lease names two. The first column stays the first bay.
--
-- Same composite-key technique as #146. Promotion of
-- second_parking_space_number lands here, never on the built bay and never
-- on parking_space_id. Extending the CHECK is the same cost 4.3 named.

ALTER TABLE tenancy
  ADD COLUMN second_parking_space_id uuid,
  ADD COLUMN second_parking_kind text NOT NULL DEFAULT 'PARKING'
    CHECK (second_parking_kind = 'PARKING');

ALTER TABLE tenancy
  ADD CONSTRAINT tenancy_second_assigned_bay_is_parking
    FOREIGN KEY (second_parking_space_id, second_parking_kind)
    REFERENCES space (space_id, space_kind);

CREATE INDEX IF NOT EXISTS tenancy_second_parking ON tenancy (second_parking_space_id);

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
    'unit.rooms',
    'space.floor'
  ));
