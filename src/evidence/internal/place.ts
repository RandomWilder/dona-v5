// Where a document says it belongs. Slice 6.3, flow A12.
//
// The exact analogue of `protocol.ts`, and deliberately so: **no model, no OCR decision, no
// `ExtractedField`** — a pure function over the text `documentText` already produces, and a lookup
// against the natural key estate already keeps. A2's model extraction still runs after the document
// is filed and still cross-checks the address it captured against the flat; this reads the place
// *before* anything is written, which is a different question and is answered deterministically.
//
// **The anchors are printed in SPEC-evidence.md**, because somebody has to write a lease that
// matches them. Changing one here without changing it there is how a reader and the document it
// reads stop being about the same thing.
import {
  addressKeyOf,
  findUnitsAtAddress,
  searchEstate,
  type UnitHit,
} from '../../estate/contract.ts';
import { apartmentMatches } from './lease.ts';
import type { Queryable } from './types.ts';

export interface PlaceReading {
  /** The street and its number, as printed, without a leading רחוב. Null when nothing matched. */
  addressLine: string | null;
  city: string | null;
  apartmentNumber: string | null;
}

// One label, four spellings of it, and a bare `רחוב` for the lease that writes the address into a
// sentence instead of onto a line. `ברחוב` matches through the same needle: the prefixed ב stays
// outside the capture, which is what makes it harmless.
const ADDRESS =
  /(?:כתובת(?:\s+(?:המושכר|הנכס|הדירה))?\s*:\s*|רחוב\s+)(?:רחוב\s+)?([^,.;:\n]{1,60}?\s+\d+[א-תA-Za-z]?)(?=[\s,.;:]|$)/;

// The city is what follows the address's comma, and nothing else is trusted to be one: a lease
// that writes `רקפת 12` and never names a town resolves to no city and therefore to no exact key,
// which is a candidate list rather than a guess at which רקפת 12 was meant.
const CITY_AFTER =
  /^[^\S\n]*[,–-][^\S\n]*([^,.;:\n]{2,40}?)[^\S\n]*(?=[,.;:\n]|$)/;

// `דירה 12`, `דירה מס׳ 12`, `דירה מספר 12A`. The same sentence 3.5's reader already reads off a
// handover protocol, which is why the shape is the same shape.
const APARTMENT = /דירה\s*(?:מס['׳״"]?\s*|מספר\s*)?(\d+[א-תA-Za-z]?)/;

const LEADING_STREET = /^(?:רחוב|רח['׳])\s+/;

/**
 * What the paper says about where it belongs. Nulls are ordinary: they are the candidate list on the
 * screen, never an error.
 *
 * Whitespace is collapsed for `protocol.ts`'s reason — a PDF breaks a run wherever the line wrapped,
 * so `רקפת  12` and `רקפת 12` are the same address to a reader and two to a regex. **Newlines
 * survive that collapse**, because on a form a line break is where a field ends: flattening them
 * too makes `שוהם` on one line and `דירה 12A` on the next read as a town called `שוהם דירה 12A`.
 */
export function readPlace(text: string): PlaceReading {
  const haystack = text.replace(/[^\S\n]+/g, ' ').replace(/ ?\n+ ?/g, '\n');
  const address = ADDRESS.exec(haystack);
  const addressLine =
    address?.[1]?.replace(/\s+/g, ' ').trim().replace(LEADING_STREET, '') ??
    null;
  let city: string | null = null;
  if (address) {
    const after = haystack.slice(address.index + address[0].length);
    city = CITY_AFTER.exec(after)?.[1]?.trim() ?? null;
  }
  const apartment = APARTMENT.exec(haystack);
  return {
    addressLine: addressLine || null,
    city,
    apartmentNumber: apartment?.[1] ?? null,
  };
}

/**
 * The spellings of one address, as `building.address_key` would hold them.
 *
 * A building created from A11's screen carries whatever the admin typed — `רקפת 12` or
 * `רחוב רקפת 12` — and a register export carries whatever the export carried. Both are the same
 * address and neither is normalised away by the generated column, which normalises case and
 * whitespace and not vocabulary. So the question is asked in both spellings, with `=` each time.
 */
export function addressKeysFor(reading: PlaceReading): string[] {
  if (!reading.addressLine || !reading.city) {
    return [];
  }
  const bare = reading.addressLine.replace(LEADING_STREET, '');
  return [...new Set([bare, `רחוב ${bare}`])].map((line) =>
    addressKeyOf(reading.city as string, line),
  );
}

/**
 * How many flats a refusal may offer before the screen stops being a list and starts being a dump.
 *
 * **Found by clicking, not by thinking.** A lease naming `רקפת 12, דירה 999` matched the building
 * and no flat in it, and the screen came back with **72** radio buttons — a correct answer and an
 * unusable one. The answer an operator can act on there is "we found the building, not the flat",
 * and the way through is the search box that is already on the page, so the list is cut and the
 * real number is printed beside it. The same sentence estate's search makes at `SEARCH_LIMIT`, at
 * the size a radio group can be read at.
 */
export const CANDIDATE_LIMIT = 12;

export type PlaceResolution =
  /** Exactly one flat at that address answers to that apartment number. A12 files against it. */
  | { unit: UnitHit; candidates?: undefined; total?: undefined }
  /**
   * Nothing exact. Whatever the operator might have meant, for them to choose from — capped at
   * `CANDIDATE_LIMIT`, with `total` saying how many there really were so the screen can say it
   * rather than quietly show a twelfth of the answer.
   */
  | { unit: null; candidates: UnitHit[]; total: number };

/**
 * The reading, resolved against the estate — exact first, and a question after that.
 *
 * Four answers in one order: the apartment at the address; the apartments at the address when the
 * number did not match one of them; the units a search of the street finds when the address matched
 * no building at all; and nothing, which is the screen's search box.
 */
export async function resolvePlace(
  db: Queryable,
  reading: PlaceReading,
): Promise<PlaceResolution> {
  const atAddress = await findUnitsAtAddress(db, addressKeysFor(reading));
  const narrowed = reading.apartmentNumber
    ? atAddress.filter((unit) =>
        apartmentMatches(reading.apartmentNumber as string, unit.unit_number),
      )
    : atAddress;
  const one = narrowed.length === 1 ? narrowed[0] : undefined;
  if (one) {
    return { unit: one };
  }
  if (narrowed.length > 1) {
    return offer(narrowed);
  }
  if (atAddress.length > 0) {
    return offer(atAddress);
  }
  if (reading.addressLine) {
    const found = await searchEstate(db, reading.addressLine);
    return offer(found.units);
  }
  return offer([]);
}

function offer(units: UnitHit[]): PlaceResolution {
  return {
    unit: null,
    candidates: units.slice(0, CANDIDATE_LIMIT),
    total: units.length,
  };
}
