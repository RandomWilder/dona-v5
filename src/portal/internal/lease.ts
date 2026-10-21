// The lease bar. Dates are already calendar dates, so the arithmetic is
// zone-free. Which day "today" is has already been answered by the clock.

function parts(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

/** Days since the civil epoch. Howard Hinnant's algorithm, date-only. */
function epochDay(iso: string): number {
  let [year, month, day] = parts(iso);
  if (month <= 2) {
    year -= 1;
    month += 9;
  } else {
    month -= 3;
  }
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * month + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function displayDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

/** Whole months from today until the end date. The end day still counts. */
export function monthsRemaining(today: string, end: string): number {
  const [startYear, startMonth, startDay] = parts(today);
  const [endYear, endMonth, endDay] = parts(end);
  let months = (endYear - startYear) * 12 + (endMonth - startMonth);
  if (endDay < startDay) months -= 1;
  return Math.max(0, months);
}

/** How far today sits between the two dates, 0 to 100. */
export function leasePercent(
  start: string,
  end: string,
  today: string,
): number {
  const total = epochDay(end) - epochDay(start);
  if (total <= 0) return 100;
  const elapsed = epochDay(today) - epochDay(start);
  const ratio = Math.min(Math.max(elapsed / total, 0), 1);
  return Math.round(ratio * 100);
}

export function hourInZone(at: Date, zone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(at)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? '0');
}

export function greetingKey(hour: number): string {
  if (hour < 5 || hour >= 22) return 'home.night';
  if (hour < 12) return 'home.morning';
  if (hour < 17) return 'home.afternoon';
  return 'home.evening';
}
