// #149 — the mint plan for נכסים. Named sequences, then `importEstate`.
import { KernelError } from '../../kernel/errors.ts';
import { requireText } from '../../kernel/validate.ts';
import type { SpacePlan, UnitPlan } from './plan.ts';

const MAX_COUNT = 999;

export interface InventoryMint {
  spaces: SpacePlan[];
  units: UnitPlan[];
  unitCount: number;
  parkingCount: number;
  storageCount: number;
  elevatorCount: number;
  unitsFrom: string | null;
  unitsTo: string | null;
  parkingFrom: string | null;
  parkingTo: string | null;
  storageFrom: string | null;
  storageTo: string | null;
  elevatorsFrom: string | null;
  elevatorsTo: string | null;
}

function requireInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  const text = requireText(value, field, 8);
  if (!/^-?\d+$/.test(text)) {
    throw new KernelError('invalid', `${field} is not an integer`);
  }
  const parsed = Number(text);
  if (parsed < min || parsed > max) {
    throw new KernelError('invalid', `${field} is not a number in range`);
  }
  return parsed;
}

function sequence(first: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(first + index));
}

function countedKind(
  form: Record<string, unknown>,
  countField: string,
  firstField: string,
  min: number,
): { count: number; names: string[] } {
  const count = requireInt(form[countField], countField, min, MAX_COUNT);
  if (count === 0) {
    return { count, names: [] };
  }
  const first = requireInt(form[firstField], firstField, 0, 99_999);
  return { count, names: sequence(first, count) };
}

function namedSpaces(kind: SpacePlan['kind'], names: string[]): SpacePlan[] {
  return names.map((name) => ({
    kind,
    name,
    floor: null,
    accessNote: null,
  }));
}

function unitRows(names: string[]): UnitPlan[] {
  return names.map((name) => ({
    spaceName: name,
    unitNumber: name,
    rooms: 0,
    areaSqm: null,
    hasMamad: false,
    parkingSpaceName: null,
    storageSpaceName: null,
    warrantyEndDate: null,
    conditionStatus: 'READY',
  }));
}

function ends(names: string[]): { from: string | null; to: string | null } {
  if (names.length === 0) {
    return { from: null, to: null };
  }
  return { from: names[0] ?? null, to: names[names.length - 1] ?? null };
}

export function inventoryFromForm(body: unknown): InventoryMint {
  const form = (body ?? {}) as Record<string, unknown>;
  const units = countedKind(form, 'unit_count', 'unit_first', 1);
  const parking = countedKind(form, 'parking_count', 'parking_first', 0);
  const storage = countedKind(form, 'storage_count', 'storage_first', 0);
  const elevatorCount = requireInt(
    form.elevator_count,
    'elevator_count',
    0,
    MAX_COUNT,
  );
  const elevators = sequence(1, elevatorCount);
  const unitRange = ends(units.names);
  const parkingRange = ends(parking.names);
  const storageRange = ends(storage.names);
  const elevatorRange = ends(elevators);
  return {
    spaces: [
      ...namedSpaces('UNIT', units.names),
      ...namedSpaces('PARKING', parking.names),
      ...namedSpaces('STORAGE', storage.names),
      ...namedSpaces('TECHNICAL', elevators),
    ],
    units: unitRows(units.names),
    unitCount: units.count,
    parkingCount: parking.count,
    storageCount: storage.count,
    elevatorCount,
    unitsFrom: unitRange.from,
    unitsTo: unitRange.to,
    parkingFrom: parkingRange.from,
    parkingTo: parkingRange.to,
    storageFrom: storageRange.from,
    storageTo: storageRange.to,
    elevatorsFrom: elevatorRange.from,
    elevatorsTo: elevatorRange.to,
  };
}

export function omitExisting(
  mint: InventoryMint,
  known: ReadonlySet<string>,
): Pick<InventoryMint, 'spaces' | 'units'> {
  const key = (kind: string, name: string) => `${kind}\n${name}`;
  const spaces = mint.spaces.filter(
    (space) => !known.has(key(space.kind, space.name)),
  );
  const keptUnits = new Set(
    spaces.filter((space) => space.kind === 'UNIT').map((space) => space.name),
  );
  return {
    spaces,
    units: mint.units.filter((unit) => keptUnits.has(unit.unitNumber)),
  };
}

export function mintAuditInputs(mint: InventoryMint): Record<string, unknown> {
  return {
    unitCount: mint.unitCount,
    parkingCount: mint.parkingCount,
    storageCount: mint.storageCount,
    elevatorCount: mint.elevatorCount,
    unitsFrom: mint.unitsFrom,
    unitsTo: mint.unitsTo,
    parkingFrom: mint.parkingFrom,
    parkingTo: mint.parkingTo,
    storageFrom: mint.storageFrom,
    storageTo: mint.storageTo,
    elevatorsFrom: mint.elevatorsFrom,
    elevatorsTo: mint.elevatorsTo,
  };
}
