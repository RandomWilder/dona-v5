-- #183. Category is the trade a call needs, and the requester is one party on
-- this call alone.
--
-- Category is an admin-managed catalogue, deactivated and never deleted, and
-- it is not asset_type: the responsibility matrix does not read it. The six
-- rows are placeholders until Dona Dom supplies theirs. Further rows are
-- written at /settings, not by a later migration.
--
-- The guarantor trigger is foundation rule 7 on the link itself. A party who
-- is a guarantor and is not a service contact on any tenancy cannot be the
-- requester. A service contact who also guarantees another lease can, and so
-- can a party on no lease. The update is rejected, not defaulted.

CREATE TABLE IF NOT EXISTS call_category (
  category_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label_he text NOT NULL,
  label_en text,
  is_active boolean NOT NULL
);

CREATE OR REPLACE FUNCTION call_category_is_never_deleted() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'call_category is deactivated, never deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS call_category_is_never_deleted ON call_category;
CREATE TRIGGER call_category_is_never_deleted
  BEFORE DELETE ON call_category
  FOR EACH ROW EXECUTE FUNCTION call_category_is_never_deleted();

INSERT INTO call_category (category_id, code, label_he, label_en, is_active)
VALUES
  ('a1830001-0000-4000-8000-000000000001', 'PLUMBING', 'אינסטלציה', 'Plumbing', true),
  ('a1830002-0000-4000-8000-000000000002', 'ELECTRICAL', 'חשמל', 'Electrical', true),
  ('a1830003-0000-4000-8000-000000000003', 'AIR_CONDITIONING', 'מיזוג', 'Air conditioning', true),
  ('a1830004-0000-4000-8000-000000000004', 'LOCKS', 'מנעולים', 'Locks', true),
  ('a1830005-0000-4000-8000-000000000005', 'GATES', 'שערים', 'Gates', true),
  ('a1830006-0000-4000-8000-000000000006', 'ADMINISTRATIVE', 'מנהלה', 'Administrative', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS requester_party_id uuid REFERENCES party (party_id),
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES call_category (category_id);

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_identified_names_a_party;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_identified_names_a_party CHECK (
    state NOT IN (
      'IDENTIFIED',
      'TRIAGED',
      'RESPONSIBILITY_SET',
      'WINDOWS_COLLECTED',
      'OFFERED',
      'SCHEDULED'
    )
    OR requester_party_id IS NOT NULL
  );

ALTER TABLE service_call
  DROP CONSTRAINT IF EXISTS service_call_triaged_names_a_category;
ALTER TABLE service_call
  ADD CONSTRAINT service_call_triaged_names_a_category CHECK (
    state NOT IN (
      'TRIAGED',
      'RESPONSIBILITY_SET',
      'WINDOWS_COLLECTED',
      'OFFERED',
      'SCHEDULED'
    )
    OR category_id IS NOT NULL
  );

-- One row per command after the call is opened. The open itself stays on
-- service_call (opened_at, opened_by): those columns already name who opened
-- it, and a second copy would be a second fact to keep in step.
CREATE TABLE IF NOT EXISTS service_call_transition (
  transition_id uuid PRIMARY KEY,
  service_call_id uuid NOT NULL REFERENCES service_call (service_call_id),
  kind text NOT NULL CHECK (kind IN ('IDENTIFIED', 'TRIAGED')),
  actor_id uuid NOT NULL REFERENCES staff_account (staff_account_id),
  at timestamptz NOT NULL,
  party_id uuid REFERENCES party (party_id),
  category_id uuid REFERENCES call_category (category_id)
);

CREATE INDEX IF NOT EXISTS service_call_transition_call
  ON service_call_transition (service_call_id);

CREATE OR REPLACE FUNCTION service_call_reject_guarantor_requester()
RETURNS trigger AS $$
BEGIN
  IF NEW.requester_party_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM tenancy_party
        WHERE party_id = NEW.requester_party_id
          AND role = 'GUARANTOR'
     )
     AND NOT EXISTS (
       SELECT 1 FROM tenancy_party
        WHERE party_id = NEW.requester_party_id
          AND is_service_contact
     )
  THEN
    RAISE EXCEPTION
      'a guarantor cannot be the requester for service'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_call_requester_is_not_a_guarantor ON service_call;
CREATE TRIGGER service_call_requester_is_not_a_guarantor
  BEFORE INSERT OR UPDATE ON service_call
  FOR EACH ROW EXECUTE FUNCTION service_call_reject_guarantor_requester();
