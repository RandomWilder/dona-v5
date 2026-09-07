-- Slice 3.1. The evidence plane: the type catalogue, the document, and the bindings a document has.
--
-- E15, E16, E12 and E13 from the workbook's FIELDS sheet (docs/model/), in dependency order, with
-- every column that sheet specifies and no others. The catalogue was written at slice 3.0, the
-- workbook pass, precisely so that this file is DDL against a specification rather than against a
-- chat description -- a migration written ahead of the workbook is the anti-pattern this project has
-- already named once.
--
-- Conventions this file follows and does not restate: uuid ids, enums as text with a CHECK rather
-- than a Postgres enum type, migrations append-only, DDL and backfill never in one file, and no
-- `DEFAULT now()` -- `document.ingested_at` comes from the injected clock, because a timestamp the
-- tests cannot control is a test that fails on a Tuesday.
--
-- **The nine seed rows of document_type are NOT in this file, deliberately.** They are data
-- (src/evidence/fixtures/document-types.ts, applied by `npm run seed:doctypes`), because A8's open
-- half is that a new document type costs a seed row and a re-deploy of data. Nine types arriving in
-- a migration would make the tenth a migration too, and the acceptance bar would be false the day it
-- was written.
--
-- NO MONEY. `value_type` has no MONEY member and no money field is ever seeded (foundation rule 2).
-- Capture being open means an amount printed on a page is capturable; it never becomes business
-- truth and it is never quoted to a tenant.

-- E15 -- DOCUMENTTYPE. The catalogue behind Document (A8, R17). "We now also receive a ועד בית
-- agreement" is a row here, not a migration and not a release.
CREATE TABLE IF NOT EXISTS document_type (
  document_type_id uuid PRIMARY KEY,

  -- The stable machine key. Never renamed and never reused: filed documents point at this row, and
  -- those are the records a dispute reads. It is also the seed's natural key, so `npm run
  -- seed:doctypes` is a no-op on its second run -- the lesson 1.11 paid for by importing the Shoham
  -- fixture twice and getting two buildings.
  type_key text NOT NULL UNIQUE,

  -- What the administrator sees and chooses from, in Hebrew, because that is the language the work
  -- happens in.
  label_he text NOT NULL,
  label_en text,

  -- **The whole of slice 3.3's guard, and the reason it is a column.** The marker terms a document
  -- of this type is expected to contain -- right slot, wrong file is the real ingestion error, and
  -- this is the cheap check for it. A `Record<TypeKey, string[]>` in TypeScript would mean every new
  -- type ships unguarded until the next release: A8 true of the catalogue and false of the first
  -- thing that consumes it. Nullable on purpose -- a type with no terms is unguarded rather than
  -- unfileable, which is the right failure direction for a guard whose justification is that it is
  -- cheap (slice 3.0).
  verification_terms text[],

  -- Retired types stay as rows and stop appearing in the "file a document" list. NEVER delete one:
  -- the foreign key from `document` below refuses it, which is R16's rule enforced rather than
  -- asked for. The admin screen for this catalogue is week 5's (A9); until then the hand on the same
  -- mechanism is a seed.
  is_active boolean NOT NULL
);

-- E16 -- DOCUMENTTYPEFIELD. What a type declares it carries, in one version of its schema.
--
-- **This table is the extraction target list. It is not where answers land** (SPEC-flows.md
-- invariant 3): values live on the entity and carry provenance back to the page.
CREATE TABLE IF NOT EXISTS document_type_field (
  document_type_field_id uuid PRIMARY KEY,
  document_type_id uuid NOT NULL REFERENCES document_type (document_type_id),

  -- -- not-pii: names a field, never holds a value. `field_key` is 'tenant_name' and `label_he` is
  -- 'שם השוכר' -- both of them name personal data on a form without ever containing any, and the
  -- extracted value itself lands in ExtractedField at 4.2 under its own marking. Guard three matches
  -- column names and cannot see the difference, so the sentence is written where a reviewer asking
  -- the obvious question will find it. The same applies to label_he and extraction_hint below.
  field_key text NOT NULL,
  -- -- not-pii: what a reviewer reads beside the value on the page. See field_key.
  label_he text NOT NULL,

  -- No MONEY member. READ ME rule 3 binds hardest at promotion: no amount is ever a column on a
  -- business record, and the golden set carries "no tenant-facing price and no balance, ever" as a
  -- standing refusal case.
  value_type text NOT NULL CHECK (
    value_type IN ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'ENUM')
  ),

  -- Is this field expected in a document of this type? A missing required field is a RESULT and not
  -- an error -- a lease commonly names no guarantor (SPEC-flows.md A2), and extraction returning
  -- nothing there is correct. Completeness is a state, never a NOT NULL (invariant 4).
  is_required boolean NOT NULL,

  -- -- not-pii: the Hebrew phrasing as printed on the form, to look for on the page. A hint, never a
  -- key -- the same rule as a Drive path. See field_key.
  extraction_hint text,

  -- **The version.** This row governs values extracted on or after this date, for the reason
  -- policy_version_id exists: a dispute only ever asks about the past, and a schema corrected in
  -- March must not silently rewrite what a value extracted in January meant. An ExtractedField
  -- points at THIS row, so A8's schema_version_id *is* document_type_field_id and there is no
  -- separate version entity (slice 4.2 owes nothing here but the pointer).
  effective_from date NOT NULL,
  -- Null = the current declaration. Closing a row never edits what it said.
  effective_to date,

  -- R18. The same field redeclared is a NEW ROW and never an edit. Without this key an admin
  -- correcting a hint would overwrite the declaration that governed every value already extracted.
  CONSTRAINT document_type_field_natural_key UNIQUE (
    document_type_id, field_key, effective_from
  ),

  -- A declaration cannot close before it opens. This is a question about one row's own period and
  -- not about a day being asked about -- the distinction slice 2.1 learned by tripping guard two on
  -- `validity_is_ordered`, and the reason the guard's exception is written against the column names
  -- rather than against the shape.
  CONSTRAINT document_type_field_version_is_ordered CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX IF NOT EXISTS document_type_field_type
  ON document_type_field (document_type_id);

-- E12 -- DOCUMENT. One file, copied and hashed at ingest. The evidence behind every fact in this
-- system, and the thing a dispute a year later actually reads.
--
-- **Four columns the published Data Model's Document card carries are deliberately absent** --
-- `state`, `superseded_by`, `tenant_visible` and `uploaded_by`. Each omission is a decision with a
-- reason, and the reasons are in SPEC-evidence.md and tasks/evidence/3.1.md rather than here,
-- because a migration is a poor place to argue. The sharpest of the four: a per-row `tenant_visible`
-- boolean would be a second access control standing beside the isolation join, and foundation rule 1
-- is that the scope is a view and never a column.
CREATE TABLE IF NOT EXISTS document (
  document_id uuid PRIMARY KEY,

  -- R17. The kind of a document is a row in a catalogue, not a value in an enum. This foreign key is
  -- also what makes "deactivated, never deleted" true: deleting a type that any document points at
  -- is refused by the database.
  document_type_id uuid NOT NULL REFERENCES document_type (document_type_id),

  -- Our copy, in our object storage. **The path carries the place and never the people**, keyed by
  -- id rather than by a transliterated address: two streets that transliterate alike would file one
  -- flat's lease under another's, which is a correctness failure with isolation flavour and it
  -- arrives quietly. The convention itself is slice 3.2's; this column is where it lands.
  storage_uri text NOT NULL,

  -- Hash taken at ingest, immutable thereafter (the trigger below). Proves the copy is the file we
  -- read. Named file_hash and not sha256 -- SPEC-flows.md A1 names it that, and the name says what
  -- the column is for rather than which algorithm this year uses.
  --
  -- **UNIQUE is load-bearing, not hygiene.** "The same file ingested twice is one document with two
  -- links" is slice 3.1's acceptance criterion, and this is where it is true: the second ingest of
  -- the same bytes finds the row rather than creating a second one, whoever calls it and however
  -- many times.
  file_hash text NOT NULL UNIQUE,

  -- Provenance -- which Google Drive file this came from. Provenance only: Drive is a source, never
  -- the system of record, and a Drive folder name is never a binding. Null until fuse F4 is lit and
  -- slice 3.4 comes back off the shelf.
  drive_file_id text,

  -- For dated documents: a bill period, a policy period, a guarantee's validity. This pair is also
  -- what answers "which certificate is the current one" -- the one whose window covers today, which
  -- is a fact rather than a `superseded_by` pointer somebody has to remember to set.
  valid_from date,
  valid_to date,

  -- From the injected clock, at the edge. No DEFAULT now().
  ingested_at timestamptz NOT NULL,

  -- Same shape and same reasoning as 0006_parties.sql's `validity_is_ordered`, and it rides the same
  -- guard-two exception: comparing valid_to against **the other column of the same row** is a
  -- question about this row's own period, and is true of every well-formed row, so it cannot express
  -- "valid on day D" no matter who writes it. Anything else on the right-hand side still trips the
  -- guard, which is what makes the exception safe by construction rather than by promise.
  CONSTRAINT document_validity_is_ordered CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  )
);

-- **The first trigger in this repository, and a deliberate one.** "file_hash at ingest; immutable
-- thereafter" is otherwise a comment, and slice 2.1's principle is that the claim is what the
-- *database* refuses and not what the application declines to offer. A hash that can be updated is a
-- hash that proves nothing: the whole value of the column is that the row cannot later be made to
-- describe a different file. storage_uri travels with it, because repointing the URI achieves the
-- same substitution without touching the hash.
--
-- Deletion is not blocked here. Retention and the deletion path are the bucket's (1.12,
-- infra/corpus-delete.sh) and a document withdrawn is a separate decision from a document rewritten.
CREATE OR REPLACE FUNCTION document_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.file_hash IS DISTINCT FROM OLD.file_hash
     OR NEW.storage_uri IS DISTINCT FROM OLD.storage_uri THEN
    RAISE EXCEPTION
      'document.file_hash and document.storage_uri are immutable after ingest'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_is_immutable ON document;
CREATE TRIGGER document_is_immutable
  BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION document_reject_mutation();

-- E13 -- DOCUMENTLINK. R13: one document, several bindings.
--
-- A signed lease is evidence about the tenancy AND the unit AND both signatories. Six nullable
-- foreign-key columns on `document` works until the seventh entity needs documents; the join table
-- does not have that ceiling.
--
-- **What it costs, stated rather than left to be noticed:** `entity_id` carries no foreign key,
-- because it points at eight different tables. Referential integrity here is the caller's and the
-- contract tests', not the database's. That is the price of R13 and it was paid knowingly -- the
-- alternative is six nullable columns and a CHECK that exactly one is set, which buys integrity for
-- the entities we thought of and refuses the eighth.
CREATE TABLE IF NOT EXISTS document_link (
  document_id uuid NOT NULL REFERENCES document (document_id),

  -- PROJECT is D2's -- a tender document belongs to the project and not to any one building.
  entity_type text NOT NULL CHECK (
    entity_type IN (
      'PROJECT', 'BUILDING', 'SPACE', 'UNIT', 'TENANCY', 'PARTY', 'ASSET', 'OBLIGATION'
    )
  ),
  entity_id uuid NOT NULL,

  -- A lease links to two parties as SIGNATORY and to the unit as SUBJECT. Nullable: a binding whose
  -- role is not yet known is still a binding.
  link_role text CHECK (
    link_role IN ('SIGNATORY', 'SUBJECT', 'EVIDENCE', 'SOURCE')
  ),

  -- One document binds to one entity once. Filing the same lease against the same unit twice is the
  -- same fact, so the second call is a no-op rather than a duplicate row -- which is the other half
  -- of "the same file ingested twice is one document with two links".
  PRIMARY KEY (document_id, entity_type, entity_id)
);

-- The primary key leads with document_id and serves "what is this document bound to". **Every read
-- this system actually performs goes the other way** -- the documents filed against unit 14 (slice
-- 3.6, and the week's demo is that question answered in four seconds) -- and no prefix of that key
-- answers it. So this index is not an optimisation held for a row count the way 2.6's was: it is the
-- only access path for the primary query, and a sequential scan of every link in the portfolio is
-- what it replaces.
CREATE INDEX IF NOT EXISTS document_link_entity
  ON document_link (entity_type, entity_id);
