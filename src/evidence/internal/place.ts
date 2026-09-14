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
  type BuildingSummary,
  findBuildingAtAddress,
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
  /**
   * **The body says the property is described somewhere this flow does not read. Slice 6.9.**
   *
   * 6.11 ruled the annex out and left the screen unable to say so: a lease that named its property
   * perfectly well, in `נספח א׳`, produced the same `לא נקראה כתובת` a blank page produces, and one
   * of those is a correct answer while the other is a broken scan. They ask the operator for
   * different things, so they get different sentences (SPEC-flows.md A12).
   *
   * **A display fact and never a resolution input.** `resolvePlace` does not read it, so a marker
   * that fires wrongly changes a sentence on a refusal screen and can never change what is filed.
   */
  annexDeferral: boolean;
}

// **Tier one: the property's own label.** `כתובת המושכר:` and its two siblings name the property and
// nothing else on the page, so this anchor is trusted wherever in the document it stands — the tier
// decides and the position does not. That distinction is slice 6.11's, and it is not academic: every
// standard form prints its parties above its property clause, so a reader that simply took the
// leftmost address read a person's home on all of them.
const PROPERTY_LABEL =
  /כתובת\s+(?:המושכר|הנכס|הדירה)\s*:\s*(?:רחוב\s+)?([^,.;:\n]{1,60}?\s+\d+[א-תA-Za-z]?)(?=[\s,.;:]|$)/;

// **Tier two: an address written into a sentence**, read only when tier one found nothing. A bare
// `כתובת:` — which a parties block uses as readily as a property clause — or a street.
//
// **`(?<![א-ת])` is the first half of 6.11.** `רחוב` matches inside `מרחוב`, which is how a person's
// residence is introduced on a standard form and never how a property is: on the week-6 demo's paper
// this needle returned the landlord's own street, and the document was placed by it. The prefixed ב
// of `ברחוב` stays — it is the property's own spelling in a sentence — and every other Hebrew letter
// to the left of the needle disqualifies it.
const LOOSE_ADDRESS =
  /(?:(?<![א-ת])כתובת\s*:\s*|(?<![א-ת])ב?רחוב\s+)(?:רחוב\s+)?([^,.;:\n]{1,60}?\s+\d+[א-תA-Za-z]?)(?=[\s,.;:]|$)/g;

// **The second half of 6.11: a party's address is never the property's.** A tier-two match whose own
// line carries one of these before it is somebody's residence, not the flat being let. The list is
// short and literal on purpose — a marker that guesses is a reader that skips the property clause.
const PARTY_LINE = /ת\.\s?ז|ת["״']\s?ז|תעודת\s+זהות|ח\.\s?פ|המתגורר/;

// The city is what follows the address's comma, and nothing else is trusted to be one: a lease
// that writes `רקפת 12` and never names a town resolves to no city and therefore to no exact key,
// which is a candidate list rather than a guess at which רקפת 12 was meant.
const CITY_AFTER =
  /^[^\S\n]*[,–-][^\S\n]*([^,.;:\n]{2,40}?)[^\S\n]*(?=[,.;:\n]|$)/;

// `דירה 12`, `דירה מס׳ 12`, `דירה מספר 12A`, `דירה מס ' 206-7`. The same sentence 3.5's reader
// already reads off a handover protocol, which is why the shape is the same shape — widened at 6.11
// by what the real form prints: a **hyphenated** number, and the space a scanner leaves before the
// apostrophe. Both halves were needed for one flat: the spaced apostrophe defeated the `מס` branch
// outright, and without the hyphen `206-7` would have read as `206`, which is a different flat.
// No spaces around the hyphen, so `דירה 3 - 5 נפשות` is still one flat and not a range.
const APARTMENT =
  /דירה\s*(?:מס\s*['׳״"]?\s*|מספר\s*)?(\d+(?:[-–]\d+)?[א-תA-Za-z]?)/;

const LEADING_STREET = /^(?:רחוב|רח['׳])\s+/;

// **Slice 6.9.** The body handing its property description to an annex, in the two spellings the
// real project lease and the published standard form both use. Literal and narrow for `PARTY_LINE`'s
// reason: a marker that guesses is a screen that tells an operator the wrong story about why their
// lease would not file.
const ANNEX_DEFERRAL =
  /(?:כמפורט|מפורט(?:ים|ות)?|כמתואר|המתואר)\s+בנספח|בנספח\s+[א-ת]\s*['׳״"]/;

// A parcel identification standing in for an address. On its own it is not a deferral — a lease may
// print גוש and חלקה beside a perfectly readable street — so it counts only where no address was
// read, which is exactly the case the screen has to explain.
const PARCEL = /גוש\s*\d/;
const PARCEL_LOT = /חלק(?:ה|ות)\s*\d/;

/**
 * What the paper says about where it belongs. Nulls are ordinary: they are the candidate list on the
 * screen, never an error.
 *
 * Whitespace is collapsed for `protocol.ts`'s reason — a PDF breaks a run wherever the line wrapped,
 * so `רקפת  12` and `רקפת 12` are the same address to a reader and two to a regex. **Newlines
 * survive that collapse**, because on a form a line break is where a field ends: flattening them
 * too makes `שוהם` on one line and `דירה 12A` on the next read as a town called `שוהם דירה 12A`.
 *
 * **Which is exactly what happened, and until slice 6.8 this comment described a reader nobody had.**
 * `documentText` joined a page's words with a space and put a newline only between pages, so the
 * line breaks this function preserves so carefully were never in the string it was given. Punctuation
 * carried it: the spec's worked example is `רקפת 12, שוהם.` and the full stop is what stops the city.
 * The first scan on staging that printed its address without one read the city as
 * `כפר סבא דירה מספר 3 המשכיר`. 6.8 fixed the text rather than this reader — both pdfjs and Document
 * AI already know where a line ends — so nothing below changed and the sentence above became true.
 *
 * **Slice 6.11 changed what is below, and for the opposite reason.** 6.8 was the first time this
 * reader reached a real project lease, and on it the function answered confidently and wrongly: the
 * landlord's own street, through the bare `רחוב` needle inside `מרחוב`. A null here is a screen; a
 * wrong address is a lease filed against a flat nobody chose. Hence two tiers, a needle that cannot
 * be reached through a Hebrew prefix other than ב, and a line that names a person disqualifying the
 * address printed on it.
 */
export function readPlace(text: string): PlaceReading {
  const haystack = text.replace(/[^\S\n]+/g, ' ').replace(/ ?\n+ ?/g, '\n');
  const address = propertyAddress(haystack);
  const addressLine =
    address?.capture.replace(/\s+/g, ' ').trim().replace(LEADING_STREET, '') ??
    null;
  const city = address
    ? (CITY_AFTER.exec(haystack.slice(address.end))?.[1]?.trim() ?? null)
    : null;
  const apartment = APARTMENT.exec(haystack);
  return {
    addressLine: addressLine || null,
    city,
    apartmentNumber: apartment?.[1] ?? null,
    annexDeferral:
      ANNEX_DEFERRAL.test(haystack) ||
      (!addressLine && PARCEL.test(haystack) && PARCEL_LOT.test(haystack)),
  };
}

/** One accepted address: what it captured, and where it ended, which is where the city starts. */
interface AddressMatch {
  capture: string;
  end: number;
}

/**
 * The property's address, and never a party's.
 *
 * Tier one first, wherever it stands. Then the loose matches **in the order they are printed**,
 * skipping each one that stands on a line naming a person — and where every one of them does, the
 * answer is null. A null is the candidate list and the search box, which is a question an operator
 * can answer; a wrong address is a lease filed against a flat nobody chose, and nothing downstream
 * asks about it. That asymmetry is the whole of this slice.
 */
function propertyAddress(haystack: string): AddressMatch | null {
  const labelled = PROPERTY_LABEL.exec(haystack);
  if (labelled?.[1]) {
    return { capture: labelled[1], end: labelled.index + labelled[0].length };
  }
  for (const loose of haystack.matchAll(LOOSE_ADDRESS)) {
    if (
      loose[1] &&
      loose.index !== undefined &&
      !onAPartyLine(haystack, loose.index)
    ) {
      return { capture: loose[1], end: loose.index + loose[0].length };
    }
  }
  return null;
}

/**
 * Whether the address at `at` is printed on a line that has already named a person.
 *
 * The line and not the paragraph: a party is identified on one line of a standard form — a name, an
 * identifier, then a residence — and widening the window to the paragraph starts rejecting property
 * clauses that merely stand near the parties block.
 */
function onAPartyLine(haystack: string, at: number): boolean {
  return PARTY_LINE.test(
    haystack.slice(haystack.lastIndexOf('\n', at) + 1, at),
  );
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
  | {
      unit: UnitHit;
      candidates?: undefined;
      total?: undefined;
      building?: undefined;
    }
  /**
   * Nothing exact. Whatever the operator might have meant, for them to choose from — capped at
   * `CANDIDATE_LIMIT`, with `total` saying how many there really were so the screen can say it
   * rather than quietly show a twelfth of the answer.
   *
   * **`building` from 6.9**: the building whose `address_key` the reading matched, when one did.
   * Null means this address is in nobody's portfolio, and the difference is the whole of the create
   * offer — *add the flat to this building* against *create the building and the flat*. It says
   * nothing about what may be filed: that is still exactly-one-unit or this refusal.
   */
  | {
      unit: null;
      candidates: UnitHit[];
      total: number;
      building: BuildingSummary | null;
    };

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
  const keys = addressKeysFor(reading);
  const atAddress = await findUnitsAtAddress(db, keys);
  const narrowed = reading.apartmentNumber
    ? atAddress.filter((unit) =>
        apartmentMatches(reading.apartmentNumber as string, unit.unit_number),
      )
    : atAddress;
  const one = narrowed.length === 1 ? narrowed[0] : undefined;
  if (one) {
    return { unit: one };
  }
  // **Asked once, and only on the way to a refusal. Slice 6.9.** The exact-match branch above has
  // already returned, so this costs a query on the path that was about to render a screen anyway
  // and nothing at all on the path that files.
  const building = await findBuildingAtAddress(db, keys);
  if (narrowed.length > 1) {
    return offer(narrowed, building);
  }
  if (atAddress.length > 0) {
    return offer(atAddress, building);
  }
  if (reading.addressLine) {
    const found = await searchEstate(db, reading.addressLine);
    return offer(found.units, building);
  }
  return offer([], building);
}

function offer(
  units: UnitHit[],
  building: BuildingSummary | null,
): PlaceResolution {
  return {
    unit: null,
    candidates: units.slice(0, CANDIDATE_LIMIT),
    total: units.length,
    building,
  };
}
