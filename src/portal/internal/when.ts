// A civil day in the office's zone. The day itself comes from the clock. This
// file only formats the time and the weekday a tenant reads.

import { dayIn } from '../../kernel/clock.ts';

export interface Zoned {
  key: string;
  short: string;
  full: string;
  time: string;
  weekdayShort: string;
  weekdayLong: string;
}

export function zoned(at: Date, zone: string): Zoned {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const day = read('day');
  const month = read('month');
  const year = read('year');
  return {
    key: dayIn(at, zone),
    short: `${day}.${month}`,
    full: `${day}.${month}.${year}`,
    time: `${read('hour')}:${read('minute')}`,
    weekdayShort: new Intl.DateTimeFormat('he-IL', {
      timeZone: zone,
      weekday: 'short',
    }).format(at),
    weekdayLong: new Intl.DateTimeFormat('he-IL', {
      timeZone: zone,
      weekday: 'long',
    }).format(at),
  };
}
