// #287. How many business days a call has waited. Sunday to Thursday, less the
// non-working dates. The span is half-open: the open date counts, today does not.
import { addDays, dayIn, weekdayIndex } from '../../kernel/clock.ts';

const FRIDAY = 5;
const SATURDAY = 6;

export function businessDaysElapsed(
  openedAt: Date,
  now: Date,
  zone: string,
  nonWorking: readonly string[],
): number {
  const start = dayIn(openedAt, zone);
  const end = dayIn(now, zone);
  if (end <= start) return 0;
  const closed = new Set(nonWorking);
  let count = 0;
  for (let day = start; day < end; day = addDays(day, 1)) {
    const weekday = weekdayIndex(day);
    if (weekday === FRIDAY || weekday === SATURDAY) continue;
    if (closed.has(day)) continue;
    count += 1;
  }
  return count;
}
