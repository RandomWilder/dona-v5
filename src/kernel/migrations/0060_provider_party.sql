-- #208. A service provider is a company party. The provider record points at that
-- party. This file adds the link nullable: 0061 fills every provider the importer
-- already created, then refuses a missing party. DDL and backfill stay apart.
--
-- party_kind on provider is the constant COMPANY, the same composite-key technique
-- R2 uses for a unit. The foreign key is (party_id, party_kind), so a provider that
-- names a person is not a provider. party_id is unique: one party, one provider.

ALTER TABLE party
  ADD CONSTRAINT party_id_kind UNIQUE (party_id, party_kind);

ALTER TABLE provider
  ADD COLUMN party_id uuid,
  ADD COLUMN party_kind text NOT NULL DEFAULT 'COMPANY'
    CHECK (party_kind = 'COMPANY');

ALTER TABLE provider
  ADD CONSTRAINT provider_party_is_company
  FOREIGN KEY (party_id, party_kind)
  REFERENCES party (party_id, party_kind);

ALTER TABLE provider
  ADD CONSTRAINT provider_one_party UNIQUE (party_id);
