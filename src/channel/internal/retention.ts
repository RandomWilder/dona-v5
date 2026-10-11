// #192. Filtered messages are kept for 6 months. A rescued message stays,
// because it is a call. A call returned to filtered is a filtered message
// again: once the return is older than 6 months its messages go, and the
// call record stays. Nothing else is deleted.

import type { Clock } from '../../kernel/clock.ts';
import type { Queryable } from './types.ts';

export interface SweepReport {
  deleted: number;
}

/** Six calendar months before `at`, in UTC. A day the earlier month does not
 * have lands on that month's last day, so a message still inside six months
 * is kept. */
function sixMonthsBefore(at: Date): Date {
  const day = at.getUTCDate();
  const cutoff = new Date(at.getTime());
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const last = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, last));
  return cutoff;
}

export async function sweepFilteredMessages(
  db: Queryable,
  clock: Clock,
): Promise<SweepReport> {
  const cutoff = sixMonthsBefore(clock.now());
  const { rows } = await db.query<{ deleted: number }>(
    `WITH removed AS (
       DELETE FROM message
        WHERE message_id IN (
          SELECT m.message_id
            FROM message m
            LEFT JOIN service_call sc
              ON sc.service_call_id = m.service_call_id
           WHERE (
                   m.service_call_id IS NULL
                   AND m.is_echo = false
                   AND m.sorter_label = 'noise'
                   AND m.received_at < $1
                 )
              OR (
                   sc.returned_at IS NOT NULL
                   AND sc.returned_at < $1
                 )
        )
       RETURNING message_id
     )
     SELECT count(*)::int AS deleted FROM removed`,
    [cutoff],
  );
  return { deleted: rows[0]?.deleted ?? 0 };
}
