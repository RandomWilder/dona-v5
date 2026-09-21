-- #132. Three declared fields become copies, and the columns they land on are created.
--
-- Track B's only irreversible step. The CHECK on field_promotion.target is the same cost 4.3
-- named: a new typed column the rest of the product could branch on cannot be added by seeding a
-- catalogue field. rent_amount and rent_currency land together because a half-price on a column
-- arrears will compare is worse than no price; option_end_date lands because the renewal path
-- asks the record, not the paper. Nothing else widens.
--
-- None of the three is NOT NULL. Completeness is a state and never a constraint. A balance is
-- still Priority's; this file writes none.

ALTER TABLE field_promotion DROP CONSTRAINT field_promotion_target_check;

ALTER TABLE field_promotion ADD CONSTRAINT field_promotion_target_check
  CHECK (target IN (
    'tenancy.start_date',
    'tenancy.end_date',
    'tenancy.rent_amount',
    'tenancy.rent_currency',
    'tenancy.option_end_date'
  ));

ALTER TABLE tenancy
  ADD COLUMN rent_amount numeric,
  ADD COLUMN rent_currency text,
  ADD COLUMN option_end_date date;
