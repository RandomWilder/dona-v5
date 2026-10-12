-- #212. A flat's rental track, and who a regulated flat was let to.
-- SPEC-estate.md, "Rental track". SPEC-tenancy.md, the eligibility group.
--
-- The developer sheet mixes the two in one column. The track is fixed by the tender per flat.
-- The group is a fact about the letting, filled when a lease is read.

-- Free market is the default: a building whose sheet has no such column (Ramle 103) is one.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS rental_track text NOT NULL DEFAULT 'FREE_MARKET'
  CHECK (rental_track IN ('FREE_MARKET', 'REGULATED'));

-- Null is a letting that names no group. A free-market letting is one of those.
ALTER TABLE tenancy ADD COLUMN IF NOT EXISTS eligibility_group text
  CHECK (eligibility_group IN ('LOCAL_RESIDENT', 'ACTIVE_RESERVE'));

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
    'tenancy.eligibility_group',
    'unit.rooms',
    'space.floor'
  ));
