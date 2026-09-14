import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  DEFAULT_ZONE,
  dayIn,
  fixedClock,
  systemClock,
  today,
  zonedClock,
} from './clock.ts';
import { KernelError } from './errors.ts';

describe('fixedClock', () => {
  it('advances deterministically, without sleeping', () => {
    const clock = fixedClock(new Date('2026-08-22T10:00:00Z'));
    assert.equal(clock.now().toISOString(), '2026-08-22T10:00:00.000Z');
    clock.advance(90_000);
    assert.equal(clock.now().toISOString(), '2026-08-22T10:01:30.000Z');
  });

  it('returns independent Date instances', () => {
    const clock = fixedClock(new Date(0));
    const first = clock.now();
    clock.advance(1);
    assert.equal(first.getTime(), 0);
  });
});

describe('systemClock', () => {
  it('tracks real time', () => {
    const before = Date.now();
    const observed = systemClock.now().getTime();
    const after = Date.now();
    assert.ok(before <= observed && observed <= after);
  });
});

// Slice 7.2b. The whole claim of this file is that an instant does not know what day it is, so the
// cases are about one instant answering two different dates.
describe('the day an instant falls on', () => {
  // 00:30 on the 15th in Jerusalem, which is 21:30 on the 14th in UTC. This is the instant 7.2's
  // verify click landed on, and the scope's handover case in tests/policy/isolation.test.ts is the
  // same instant asked of the isolation join.
  const AFTER_MIDNIGHT = new Date('2026-09-14T21:30:00Z');

  it('is the office day and not the UTC day', () => {
    assert.equal(dayIn(AFTER_MIDNIGHT, DEFAULT_ZONE), '2026-09-15');
    assert.equal(dayIn(AFTER_MIDNIGHT, 'UTC'), '2026-09-14');
  });

  // The case that stops the cheap fix. Israel is UTC+3 in summer and UTC+2 in winter, so anything
  // that adds a fixed three hours passes the case above and is wrong for half the year — and it
  // would be wrong in the direction nobody checks, in January, months after it shipped.
  it('follows the transition, so a fixed offset cannot pass for the answer', () => {
    const winter = new Date('2026-01-14T22:30:00Z');
    assert.equal(dayIn(winter, DEFAULT_ZONE), '2026-01-15');
    assert.equal(
      dayIn(new Date('2026-01-14T21:30:00Z'), DEFAULT_ZONE),
      '2026-01-14',
    );
    assert.equal(
      dayIn(new Date('2026-09-14T20:30:00Z'), DEFAULT_ZONE),
      '2026-09-14',
    );
  });

  it('is what today(clock) answers, in the clock’s own zone', () => {
    assert.equal(today(fixedClock(AFTER_MIDNIGHT)), '2026-09-15');
    assert.equal(today(fixedClock(AFTER_MIDNIGHT, 'UTC')), '2026-09-14');
    assert.equal(systemClock.zone, DEFAULT_ZONE);
  });

  it('refuses a zone ICU does not know, at construction and not on a read', () => {
    assert.throws(
      () => zonedClock('Middle/Earth'),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'invalid',
    );
    assert.equal(zonedClock('UTC').zone, 'UTC');
  });
});

describe('addDays', () => {
  // The deliberate opposite: no instant, so no zone, so nothing to get wrong. Across the Israeli
  // DST transition it still returns calendar days, which is the property the 60-day obligation
  // window depends on.
  it('is calendar arithmetic and carries no zone', () => {
    assert.equal(addDays('2026-09-15', 60), '2026-11-14');
    assert.equal(addDays('2026-10-24', 1), '2026-10-25');
    assert.equal(addDays('2026-03-26', 1), '2026-03-27');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });
});
