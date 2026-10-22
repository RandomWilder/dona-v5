// #287. Handling age is business days: Sunday to Thursday, less the non-working
// dates. The count is the half-open span from the open date to today.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { businessDaysElapsed } from './contract.ts';

const ZONE = 'Asia/Jerusalem';

// 07:00 UTC is 10:00 in Jerusalem while the zone is UTC+3. 6–13 Oct 2026 is before the clock change.
function at(day: string): Date {
  return new Date(`${day}T07:00:00.000Z`);
}

describe('business days elapsed', () => {
  it('skips Friday and Saturday', () => {
    // Thursday 8 Oct 2026 through Sunday 11 Oct. Thursday counts; Friday and Saturday do not.
    assert.equal(
      businessDaysElapsed(at('2026-10-08'), at('2026-10-11'), ZONE, []),
      1,
    );
  });

  it('skips a non-working date', () => {
    // Sunday 4 Oct through Tuesday 6 Oct. Monday is kept as a non-working date.
    assert.equal(
      businessDaysElapsed(at('2026-10-04'), at('2026-10-06'), ZONE, [
        '2026-10-05',
      ]),
      1,
    );
  });

  it('skips a weekend and a non-working date in one span', () => {
    // Thursday 8 Oct through Tuesday 13 Oct. Sunday 11 Oct is not a working day.
    // Thursday and Monday count.
    assert.equal(
      businessDaysElapsed(at('2026-10-08'), at('2026-10-13'), ZONE, [
        '2026-10-11',
      ]),
      2,
    );
  });
});
