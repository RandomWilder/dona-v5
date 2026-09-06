// The week-1 fixture: one project, one building, 184 spaces, 72 units.
//
// **The address is ours, not Shoham's.** The director's decision this week is that functionality is
// established against mock addresses and example leases and real data is applied to it afterwards --
// which is docs/pipeline.md §1 principle 5: mock data is the development substrate by design and not
// by shortage. Every real address in this system arrives through the week-2 Priority import, through
// this same importer and these same natural keys.
//
// What is deliberate is the *coverage*, not the realism. This fixture is built to exercise the cases
// that break things rather than to look like a spreadsheet:
//
//   - a split unit, `12A` / `12B`, so `unit_number` being text rather than a number is exercised and
//     not merely documented;
//   - the six ground-floor units without a ממ"ד, so `has_mamad` is not constant;
//   - two units carrying a `warranty_end_date` of their own (R14 -- handed over separately, so the
//     building's תקופת הבדק is not theirs);
//   - three `RENOVATION` and one `WITHHELD`, so condition_status is not constant either;
//   - unmeasured areas, because `area_sqm` is nullable in the workbook and something has to prove a
//     screen renders the gap rather than the word "null";
//   - 60 parking bays and 40 storage rooms against 72 units, so both the assigned and the
//     **unassigned** case are present -- D3's ordinary state is unassigned;
//   - all six space kinds, because space_kind is what the responsibility rule reads (R4).
//
// `access_note` is null everywhere. It is the one `-- pii` column in E1-E4, it describes how a
// technician physically gets into a home, and a fixture is not the place to invent one.
import type { EstatePlan, SpacePlan, UnitPlan } from '../internal/plan.ts';

const CITY = 'שוהם';
const ADDRESS_LINE = 'רקפת 12';
const PROJECT_CODE = 'SHM-01';

const UNITS_PER_FLOOR = 6;
const PARKING_BAYS = 60;
const STORAGE_ROOMS = 40;

/** 1-11, then the split 12A / 12B, then 13-71: seventy-two doors over seventy-one numbers. */
function unitNumbers(): string[] {
  const numbers: string[] = [];
  for (let n = 1; n <= 71; n += 1) {
    if (n === 12) {
      numbers.push('12A', '12B');
    } else {
      numbers.push(String(n));
    }
  }
  return numbers;
}

const ROOMS_BY_POSITION = [3, 3.5, 4, 4, 5, 3.5];
const RENOVATING = new Set([17, 40, 63]);
const WITHHELD = 55;
const SEPARATE_HANDOVER = new Set([8, 44]);

function unitSpaceName(unitNumber: string): string {
  return `דירה ${unitNumber}`;
}

function commonSpaces(): SpacePlan[] {
  const spaces: SpacePlan[] = [
    { kind: 'COMMON', name: 'לובי', floor: 'קרקע', accessNote: null },
    { kind: 'COMMON', name: 'חדר מדרגות א', floor: null, accessNote: null },
    { kind: 'COMMON', name: 'חדר מדרגות ב', floor: null, accessNote: null },
    { kind: 'COMMON', name: 'חדר דיירים', floor: 'קרקע', accessNote: null },
    { kind: 'COMMON', name: 'גג משותף', floor: '12', accessNote: null },
    {
      kind: 'TECHNICAL',
      name: 'חדר חשמל ראשי',
      floor: 'מרתף',
      accessNote: null,
    },
    { kind: 'TECHNICAL', name: 'חדר משאבות', floor: 'מרתף', accessNote: null },
    {
      kind: 'TECHNICAL',
      name: 'חדר מכונות מעלית',
      floor: '12',
      accessNote: null,
    },
    { kind: 'TECHNICAL', name: 'ארון תקשורת', floor: 'קרקע', accessNote: null },
    { kind: 'EXTERIOR', name: 'חצר קדמית', floor: null, accessNote: null },
    { kind: 'EXTERIOR', name: 'גינה משותפת', floor: null, accessNote: null },
    { kind: 'EXTERIOR', name: 'שביל גישה', floor: null, accessNote: null },
  ];
  for (let bay = 1; bay <= PARKING_BAYS; bay += 1) {
    spaces.push({
      kind: 'PARKING',
      name: `ח-${bay}`,
      floor: 'מרתף',
      accessNote: null,
    });
  }
  for (let room = 1; room <= STORAGE_ROOMS; room += 1) {
    spaces.push({
      kind: 'STORAGE',
      name: `מ-${room}`,
      floor: 'מרתף',
      accessNote: null,
    });
  }
  return spaces;
}

function buildUnits(): { spaces: SpacePlan[]; units: UnitPlan[] } {
  const spaces: SpacePlan[] = [];
  const units: UnitPlan[] = [];
  unitNumbers().forEach((unitNumber, index) => {
    const floor = Math.floor(index / UNITS_PER_FLOOR) + 1;
    const rooms = ROOMS_BY_POSITION[index % ROOMS_BY_POSITION.length];
    spaces.push({
      kind: 'UNIT',
      name: unitSpaceName(unitNumber),
      floor: String(floor),
      accessNote: null,
    });
    units.push({
      spaceName: unitSpaceName(unitNumber),
      unitNumber,
      rooms,
      // Not yet measured on a handful of doors, which is the state the nullable column exists for.
      areaSqm: index % 17 === 5 ? null : Math.round(rooms * 22.5 * 10) / 10,
      // The ground floor of this core predates the ממ"ד requirement.
      hasMamad: floor > 1,
      parkingSpaceName: index < PARKING_BAYS ? `ח-${index + 1}` : null,
      storageSpaceName: index < STORAGE_ROOMS ? `מ-${index + 1}` : null,
      warrantyEndDate: SEPARATE_HANDOVER.has(index) ? '2027-09-01' : null,
      conditionStatus: RENOVATING.has(index)
        ? 'RENOVATION'
        : index === WITHHELD
          ? 'WITHHELD'
          : 'READY',
    });
  });
  return { spaces, units };
}

export function shohamPlan(): EstatePlan {
  const { spaces, units } = buildUnits();
  return {
    projects: [
      {
        name: 'שוהם — רקפת',
        projectCode: PROJECT_CODE,
        tenderRef: '2024/17',
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: 'בניין רקפת 12',
        addressLine: ADDRESS_LINE,
        city: CITY,
        projectCode: PROJECT_CODE,
        // Handover starts תקופת הבדק; the building's warranty ends two years later, and R14 lets a
        // unit override it.
        handoverDate: '2025-03-01',
        warrantyEndDate: '2027-03-01',
        status: 'ACTIVE',
        spaces: [...spaces, ...commonSpaces()],
        units,
      },
    ],
  };
}
