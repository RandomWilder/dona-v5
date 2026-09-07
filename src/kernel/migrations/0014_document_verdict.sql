-- Slice 3.6. The 3.3 guard's result, made a property of a list.
--
-- A scan nobody has read yet must not look identical to a lease whose marker terms were all
-- found, and listing cannot re-read the bytes without missing the four-second bar. Audit is
-- who-did-what JSON and is the wrong read model for a card. So the verdict lives on the row.
--
-- This is not figure 5's state (RECEIVED / EXTRACTED / ACCEPTED / REJECTED). That vocabulary is
-- the bulk review queue, deferred with F4, and a refused upload still leaves no row (3.3).
-- The three values here are the three filed outcomes of the door guard. 4.1 may later move
-- unverified → verified once OCR gives the file a text layer, so this column is not on the
-- immutability trigger.
--
-- Nullable in this file because existing rows (3.3 filings already on staging) have no value
-- yet. 0015 adds the CHECK, backfills from audit_log, and then sets NOT NULL. DDL and
-- backfill never share a file (SPEC.md).

ALTER TABLE document ADD COLUMN IF NOT EXISTS verification_verdict text;

-- -- not-pii: a guard outcome (verified / unverified / unguarded), never a person. Named so
-- a later reader asking "is this a status about someone?" finds the sentence rather than
-- inferring from the column not matching the guard's list.
