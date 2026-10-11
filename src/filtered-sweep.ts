// #192. Deletes Filtered messages older than 6 months.
//
//   npm run filtered:sweep
//
// On staging this is a Cloud Run job, started once a day by Cloud Scheduler.
// A second run deletes nothing: the first run already removed the rows.
import { sweepFilteredMessages } from './channel/contract.ts';
import { systemClock } from './kernel/clock.ts';
import { createPool } from './kernel/db.ts';

const pool = createPool();
try {
  const report = await sweepFilteredMessages(pool, systemClock);
  console.log(`filtered:sweep — deleted ${report.deleted}`);
} finally {
  await pool.end();
}
