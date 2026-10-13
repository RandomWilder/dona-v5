-- #224. The closed list reads the calls closed in one thirty-day window, newest close first, and
-- the newest close before that window, to send its older link to a window that is not empty.
--
-- Measured inside a transaction that was rolled back, with closed calls spread evenly over
-- the past: 2,908 in one year (one for each party the portfolio holds, as the requester index
-- was measured), 2,912 rows in all, and 29,080 over ten years, 29,084 rows. The window is
-- listClosedCalls for the last 30 days, 239 rows either way. The older close is
-- newestCloseAtOrBefore at the start of that window.
--
--   window, one year:   Seq Scan and Sort, cost 179.90, 119 buffers, 0.296 ms
--                       with: Index Scan Backward, cost 32.69, 9 buffers, 0.083 ms
--   window, ten years:  Seq Scan and Sort, cost 1231.86, 713 buffers, 1.871 ms
--                       with: Index Scan Backward, cost 28.63, 11 buffers, 0.094 ms
--   older, one year:    Seq Scan, sort and Limit, cost 176.02, 119 buffers, 0.367 ms
--                       with: Index Scan Backward and Limit, cost 0.35, 3 buffers, 0.005 ms
--   older, ten years:   Seq Scan, sort and Limit, cost 1293.46, 713 buffers, 3.040 ms
--                       with: Index Scan Backward and Limit, cost 0.34, 3 buffers, 0.005 ms
--
-- The planner chose this index for both reads at both volumes. Only a closed call has a close
-- time, so the index is partial, and an open call pays nothing for it on write.
CREATE INDEX IF NOT EXISTS service_call_closed_at
  ON service_call (closed_at)
  WHERE state = 'CLOSED';
