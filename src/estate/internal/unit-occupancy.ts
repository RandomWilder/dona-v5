// Four Unit states on נכסים and the Unit page. #159.
//
// Counts-today is already decided by `resolveOccupiedUnits`. This file only reads the dates
// tenancy already returned and the clock. It does not query, and it does not decide whether a
// letting covers today.
import { addDays } from '../../kernel/clock.ts';
import type { LettingOnUnit } from '../../tenancy/contract.ts';
import { EXPIRING_WINDOW_DAYS } from './read-model.ts';

export const UNIT_WORDS = {
  vacant: 'פנויה',
  draft: 'חוזה בטיוטה',
  let: 'מושכרת',
  ending: 'בסיום',
} as const;

export type UnitWord = (typeof UNIT_WORDS)[keyof typeof UNIT_WORDS];

export interface UnitTileState {
  word: UnitWord;
  vacant: boolean;
  waitingStart: string | null;
  endingOn: string | null;
}

function waitingDraft(
  lettings: readonly LettingOnUnit[],
  today: string,
): LettingOnUnit | undefined {
  return lettings
    .filter((row) => row.status === 'DRAFT' && row.end_date >= today)
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];
}

function oneUnit(input: {
  countsToday: boolean;
  tenancyId: string | null;
  lettings: readonly LettingOnUnit[];
  today: string;
  windowEnd: string;
}): UnitTileState {
  const waiting = waitingDraft(input.lettings, input.today);
  if (!input.countsToday) {
    if (waiting) {
      return {
        word: UNIT_WORDS.draft,
        vacant: true,
        waitingStart: waiting.start_date,
        endingOn: null,
      };
    }
    return {
      word: UNIT_WORDS.vacant,
      vacant: true,
      waitingStart: null,
      endingOn: null,
    };
  }
  const live = input.lettings.find((row) => row.tenancy_id === input.tenancyId);
  const inWindow = live !== undefined && live.end_date <= input.windowEnd;
  const ending = inWindow || (live !== undefined && live.notice_date !== null);
  return {
    word: ending ? UNIT_WORDS.ending : UNIT_WORDS.let,
    vacant: false,
    waitingStart: waiting?.start_date ?? null,
    endingOn: inWindow && live ? live.end_date : null,
  };
}

/** One state per unit on the page. Missing lettings are פנויה. */
export function unitTiles(input: {
  unitIds: readonly string[];
  occupied: readonly { unit_id: string; tenancy_id: string }[];
  lettings: readonly LettingOnUnit[];
  today: string;
}): Map<string, UnitTileState> {
  const byUnit = new Map<string, LettingOnUnit[]>();
  for (const row of input.lettings) {
    const list = byUnit.get(row.unit_id);
    if (list) list.push(row);
    else byUnit.set(row.unit_id, [row]);
  }
  const occupiedBy = new Map(
    input.occupied.map((row) => [row.unit_id, row.tenancy_id]),
  );
  const windowEnd = addDays(input.today, EXPIRING_WINDOW_DAYS);
  const states = new Map<string, UnitTileState>();
  for (const unitId of input.unitIds) {
    states.set(
      unitId,
      oneUnit({
        countsToday: occupiedBy.has(unitId),
        tenancyId: occupiedBy.get(unitId) ?? null,
        lettings: byUnit.get(unitId) ?? [],
        today: input.today,
        windowEnd,
      }),
    );
  }
  return states;
}
