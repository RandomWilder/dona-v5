-- #283. A file a tenant added to a report, after a clean scan, before the
-- report is a message. The object path is the server's name. The sender's
-- name is only the label. Infected and unchecked files are not rows here.

CREATE TABLE IF NOT EXISTS attachment_hold (
  hold_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  object_path text NOT NULL,
  -- not-pii: the sender's filename, kept as a label after it is cleaned. Not a person's name.
  display_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT attachment_hold_path_is_quarantine CHECK (
    object_path ~ '^quarantine/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT attachment_hold_name_short CHECK (
    char_length(display_name) BETWEEN 1 AND 80
  ),
  CONSTRAINT attachment_hold_size_capped CHECK (
    byte_size >= 0 AND byte_size <= 104857600
  )
);

CREATE INDEX IF NOT EXISTS attachment_hold_owner
  ON attachment_hold (owner_id, submission_id);
