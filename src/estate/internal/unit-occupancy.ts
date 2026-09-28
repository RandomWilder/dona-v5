// A flat on נכסים is only פנויה or מושכרת. #164.
//
// Counts-today is already decided by `resolveOccupiedUnits`. This file only reads the dates
// tenancy already returned and the clock. It does not query, and it does not decide whether a
// letting covers today. A draft's chip is filled afterwards from the activation gate.
import type { LettingOnUnit } from '../../tenancy/contract.ts';

export const UNIT_WORDS = {
  vacant: 'פנויה',
  let: 'מושכרת',
} as const;

export type UnitWord = (typeof UNIT_WORDS)[keyof typeof UNIT_WORDS];

/** The four labels שכירויות already prints. Past chips are not on a tile. */
export type TileChip = 'ready' | 'waiting' | 'draft' | 'active';

export interface TileLine {
  tenancyId: string;
  start: string;
  end: string;
  /** Null until the gate labels a draft. The letting that counts today is פעיל. */
  chip: TileChip | null;
  /** Set only for the letting that counts today. The tile prints the last word. */
  household_name: string | null;
}

export interface UnitTileState {
  word: UnitWord;
  vacant: boolean;
  /** The letting that counts today, then the next draft. The past is absent. */
  lines: TileLine[];
}

function nextDraft(
  lettings: readonly LettingOnUnit[],
  today: string,
): LettingOnUnit | undefined {
  return lettings
    .filter((row) => row.status === 'DRAFT' && row.end_date >= today)
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];
}

function lineOf(
  row: LettingOnUnit,
  chip: TileChip | null,
  householdName: string | null,
): TileLine {
  return {
    tenancyId: row.tenancy_id,
    start: row.start_date,
    end: row.end_date,
    chip,
    household_name: householdName,
  };
}

function oneUnit(input: {
  countsToday: boolean;
  tenancyId: string | null;
  lettings: readonly LettingOnUnit[];
  today: string;
}): UnitTileState {
  const draft = nextDraft(input.lettings, input.today);
  const draftLine = draft ? lineOf(draft, null, null) : null;
  if (!input.countsToday) {
    return {
      word: UNIT_WORDS.vacant,
      vacant: true,
      lines: draftLine ? [draftLine] : [],
    };
  }
  const live = input.lettings.find((row) => row.tenancy_id === input.tenancyId);
  const lines = live ? [lineOf(live, 'active', live.household_name)] : [];
  if (draftLine) lines.push(draftLine);
  return {
    word: UNIT_WORDS.let,
    vacant: false,
    lines,
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
  const states = new Map<string, UnitTileState>();
  for (const unitId of input.unitIds) {
    states.set(
      unitId,
      oneUnit({
        countsToday: occupiedBy.has(unitId),
        tenancyId: occupiedBy.get(unitId) ?? null,
        lettings: byUnit.get(unitId) ?? [],
        today: input.today,
      }),
    );
  }
  return states;
}
