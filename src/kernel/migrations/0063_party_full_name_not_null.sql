-- #200. The display name is required. A database that applied 0058 before
-- full_name was declared NOT NULL still has the column nullable, so a party
-- with no name is refused by the kind check instead of by the missing display
-- name. A fresh database already has the constraint from 0058. This makes the
-- rest match.
ALTER TABLE party ALTER COLUMN full_name SET NOT NULL;
