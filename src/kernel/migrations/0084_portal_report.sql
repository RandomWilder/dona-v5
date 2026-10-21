-- #282. A portal report records three facts that are not the call's Category
-- and do not move its state: the tenant's suggestion, whether the office may
-- enter, and which tenancy the report is about. A question and every other
-- channel leave all three empty. A report names all three.

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS suggested_category_id uuid REFERENCES call_category (category_id),
  ADD COLUMN IF NOT EXISTS entry_permission text,
  ADD COLUMN IF NOT EXISTS tenancy_id uuid REFERENCES tenancy (tenancy_id);

ALTER TABLE service_call DROP CONSTRAINT IF EXISTS service_call_report_is_whole;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_report_is_whole CHECK (
    (
      suggested_category_id IS NULL
      AND entry_permission IS NULL
      AND tenancy_id IS NULL
    )
    OR (
      suggested_category_id IS NOT NULL
      AND entry_permission IS NOT NULL
      AND tenancy_id IS NOT NULL
    )
  );

ALTER TABLE service_call DROP CONSTRAINT IF EXISTS service_call_entry_permission_known;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_entry_permission_known CHECK (
    entry_permission IS NULL
    OR entry_permission IN ('YES', 'ARRANGE', 'HOME')
  );
