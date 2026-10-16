-- ADR-0016. The field → column map is code (`COLUMN_MAP`). The table, its seed
-- rows and its CHECK named nothing the code did not already allow, and a reset
-- that emptied the table failed every draft.

DROP TABLE IF EXISTS field_promotion;
