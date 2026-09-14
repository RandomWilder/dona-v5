-- Slice 6.5. The identifier fold, named — one definition, two callers.
--
-- `party.national_id_key` has been a GENERATED ... STORED column since 0009, and its expression is
-- the only normalisation of a ת.ז. / ח.פ. in this system: separators removed, the Latin half
-- lowered, the leading zeros a spreadsheet export dropped restored. Every writer got it because the
-- database applied it, which is the technique 0005 established for `address_key`.
--
-- Flow A2 needs it one step earlier than a writer does. The resolution at 6.5 must decide whether a
-- letting already holds one of the people a lease names, and it has to ask that of an identifier
-- read off a document -- before any party row exists for the database to have generated a key from.
-- So the fold has to be callable, not merely applied.
--
-- **The generated column is not rewritten.** Changing its expression means dropping the column and
-- re-adding it, which rebuilds `party_natural_key` over every row in the table, and the gain would
-- be cosmetic: two definitions that agree are a risk only if nothing checks, and
-- `src/parties/schema.test.ts` checks -- the function is asserted against the stored column for
-- every row in `party` and for the literals that are awkward on purpose (a hyphen, spaces, a dot, a
-- dropped leading zero, a passport, a COMPANY, and NULL). The alternative that was actually on the
-- table is worse than either: re-implementing the fold in TypeScript, which is the drift
-- `upsertPartyContact`'s own comment warns about -- a normaliser in two places is one that stops
-- agreeing, and here the two halves disagreeing means two people who are one person.
--
-- IMMUTABLE, because every part of it is: regexp_replace, lower and lpad over one input. STRICT is
-- not used -- a NULL identifier must return NULL and so must a NULL kind, which STRICT would give,
-- but spelling it out keeps this readable beside 0009's CASE, which is the file it has to match.

CREATE OR REPLACE FUNCTION party_national_id_key(
  party_kind text,
  national_id text  -- pii: the identifier itself, normalised and returned. Same admin-only,
                    -- access-logged standing as the column (SPEC.md, Security defaults).
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN national_id IS NULL OR party_kind IS NULL THEN NULL
    ELSE party_kind || ':' ||
      CASE
        WHEN regexp_replace(lower(national_id), '[\s\-./]', '', 'g') ~ '^[0-9]{1,9}$'
          THEN lpad(regexp_replace(lower(national_id), '[\s\-./]', '', 'g'), 9, '0')
        ELSE regexp_replace(lower(national_id), '[\s\-./]', '', 'g')
      END
  END
$$;
