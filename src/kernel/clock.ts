import { KernelError } from './errors.ts';

// The clock, and — from slice 7.2b — the one place in this repository where an instant becomes a
// date.
//
// **An instant does not know what day it is.** `now()` answers *when*; only a zone turns that into a
// calendar date, and until 7.2b every date in this system was derived from the instant in UTC.
// Israel is UTC+2 in winter and UTC+3 in summer, so for the two or three hours after midnight that
// answer is the country's yesterday. 7.2 met it as a wrong stamp on a schema row, which is
// cosmetic. Counting the call sites afterwards found eleven, and one of them was the isolation join
// binding the day to its tenancy-active predicate: a letting that starts today not yet active, one
// that ended yesterday still is. That is the scope computed in the wrong zone, and the scope is the
// one thing this product may not get wrong.
//
// So: `today(clock)` is how anything asks what day it is, `dayIn(at, zone)` is underneath it, and
// guard five (`no-utc-day` in `scripts/guards.ts`) allows the UTC-day expression in this file and
// nowhere else — so the fix cannot be undone by somebody simplifying it back.

export interface Clock {
  now(): Date;
  /**
   * The zone the day is answered in. On the clock rather than passed beside it, because a caller
   * that can pass an instant can pass the wrong one, and every call site of `today` already had a
   * clock in its hand.
   */
  readonly zone: string;
}

/**
 * The office's zone. A default and not a constant: the real value is a `config_settings` row
 * (`clock.zone`, read by `readClockSettings` in `config.ts`), because a second country is a row and
 * not a release — foundation rule 8's own argument, applied to the one setting that decides what
 * day every screen in the system is having.
 */
export const DEFAULT_ZONE = 'Asia/Jerusalem';

export const systemClock: Clock = {
  now: () => new Date(),
  zone: DEFAULT_ZONE,
};

export interface FixedClock extends Clock {
  advance(ms: number): void;
}

export function fixedClock(
  start: Date,
  zone: string = DEFAULT_ZONE,
): FixedClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    zone,
    advance: (ms) => {
      current += ms;
    },
  };
}

// `Intl.DateTimeFormat` construction is not cheap and the isolation join is the hottest query in
// this system — `scripts/measure-scale.ts` exists because of it — so a formatter is built once per
// zone and kept. There are one or two zones in the life of a process, not one per request.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const held = formatters.get(zone);
  if (held) return held;
  const made = buildFormatter(zone);
  formatters.set(zone, made);
  return made;
}

function buildFormatter(zone: string): Intl.DateTimeFormat {
  try {
    // `en-CA` formats `YYYY-MM-DD` natively, which is the shape every DATE column and every
    // comparison in this system already speaks. Reassembling the parts by hand would be the same
    // answer with more places to get it wrong.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    // ICU raises `RangeError` for a zone it does not know. A configured zone nobody checked would
    // otherwise surface as a crash on a tenant read, hours after the row was edited.
    throw new KernelError('invalid', `unknown time zone: ${zone}`, { zone });
  }
}

/** The calendar date at `at`, in `zone`. `YYYY-MM-DD`. */
export function dayIn(at: Date, zone: string): string {
  return formatterFor(zone).format(at);
}

/** What day is it. The only answer to that question in this repository. */
export function today(clock: Clock): string {
  return dayIn(clock.now(), clock.zone);
}

/**
 * A clock in a named zone, with the zone checked here rather than on the first read that needs it.
 * `serve.ts` builds the application's clock through this, so a wrong `clock.zone` row fails the
 * boot and not a tenant lookup.
 */
export function zonedClock(zone: string): Clock {
  formatterFor(zone);
  return { now: () => new Date(), zone };
}

/**
 * Date arithmetic, and the deliberate opposite of everything above: `isoDate` is already a calendar
 * date, so anchoring it at midnight UTC and adding whole days is **zone-free and correct** — no
 * zone has a day that is not a day long in this arithmetic, because there is no instant involved to
 * be shifted. Written twice before it was written once: `addUtcDays` in tenancy's obligation status
 * and `shift` in the register fixtures were the same six lines, and lifting them here is what lets
 * guard five carry no exclusion list beyond this file.
 */
export function addDays(isoDate: string, days: number): string {
  const anchor = Date.parse(`${isoDate}T00:00:00.000Z`);
  return new Date(anchor + days * 86_400_000).toISOString().slice(0, 10);
}
