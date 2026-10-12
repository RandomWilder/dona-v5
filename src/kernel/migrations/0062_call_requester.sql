-- #209. The profile lists the calls that name one party as requester.
--
-- The generated register writes no service calls. Measured instead at one call
-- for each of the 2,908 parties that portfolio holds (2.6's count), 2,911 rows
-- once the three calls already in this database were counted, inside a
-- transaction that was rolled back. The query is listCallsByRequester.
--
--   without: Seq Scan on service_call, 2,910 rows removed by the filter,
--            48 buffers, 0.139-0.155 ms
--   with:    Index Scan on a btree of requester_party_id, planner cost
--            0.28..8.30 against the scan's 84.39, 5 buffers, 0.024-0.046 ms
--
-- The planner chose that index. The same column restricted to a non-null
-- requester was chosen at the same estimated cost, because every measured
-- row had a requester. The partial form is the one added: a call still in
-- NEW names nobody, this read never asks for that row, and only a call that
-- names a party pays for the index on write.
CREATE INDEX IF NOT EXISTS service_call_requester
  ON service_call (requester_party_id)
  WHERE requester_party_id IS NOT NULL;
