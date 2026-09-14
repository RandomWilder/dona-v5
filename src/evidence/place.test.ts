// The deterministic place reader. Slice 6.3, flow A12.
//
// A pure function over a string, so this suite needs no database, no pdf and no fixture — which is
// the same property `protocol.test.ts` has and the same reason: what is under test is a reading,
// and a reading that needed a bucket to prove would be tested through three other things.
//
// **The cases are the anchors printed in SPEC-evidence.md.** A lease the director invents for the
// demo is written against that section; this file is what says the section is true.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UnitHit } from '../estate/contract.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { apartmentMatches } from './internal/lease.ts';
import {
  addressKeysFor,
  CANDIDATE_LIMIT,
  readPlace,
  resolvePlace,
} from './internal/place.ts';
import { documentText } from './internal/verify.ts';

describe('evidence · reading the place off a document', () => {
  it('reads the labelled address, the city and the apartment', () => {
    const reading = readPlace(
      'הסכם שכירות. כתובת המושכר: רקפת 12, שוהם. דירה 12A. תקופת השכירות שלוש שנים.',
    );
    assert.deepEqual(reading, {
      addressLine: 'רקפת 12',
      city: 'שוהם',
      apartmentNumber: '12A',
    });
  });

  it('reads an address written into a sentence, with the ב prefix outside the capture', () => {
    const reading = readPlace(
      'המושכר הוא דירה מס׳ 4 ברחוב המסמכים 3, עיר מסמכים.',
    );
    assert.deepEqual(reading, {
      addressLine: 'המסמכים 3',
      city: 'עיר מסמכים',
      apartmentNumber: '4',
    });
  });

  it('drops a רחוב the label repeated, so one address has one spelling', () => {
    assert.equal(
      readPlace('כתובת הנכס: רחוב הדס 3, מודיעין;').addressLine,
      'הדס 3',
    );
  });

  it('reads across a line break, because a pdf wraps wherever the page ended', () => {
    const reading = readPlace('כתובת המושכר:  רקפת\n12 ,\tשוהם\n\nדירה   7');
    assert.equal(reading.addressLine, 'רקפת 12');
    assert.equal(reading.city, 'שוהם');
    assert.equal(reading.apartmentNumber, '7');
  });

  it('stops the city at the line end, which is the reading the demo scan never got', async () => {
    // **The week-6 demo, as a case. Slice 6.8, and it was red before it.** A lease scanned on a
    // phone printed its address with no full stop after the town, and the city came back as
    // `כפר סבא דירה מספר 3 המשכיר` — every word to the next punctuation mark, because there was
    // none. The refusal that followed was correct and wrote nothing, and it was about the wrong
    // question.
    //
    // The case runs through `documentText` rather than over a hand-written string, because that is
    // where the defect was: `readPlace` has preserved newlines since 6.3 and was never given any.
    const pages = await createFakePdfText([
      'הסכם שכירות\nכתובת המושכר: נרקיס 45, כפר סבא\nדירה מספר 3\nהמשכיר: אבי לוי',
    ]).pages(Buffer.from('x'));
    const reading = readPlace(documentText(pages));
    assert.equal(reading.addressLine, 'נרקיס 45');
    assert.equal(reading.city, 'כפר סבא');
    assert.equal(reading.apartmentNumber, '3');
  });

  it('reads the wrong city off the same words with the line breaks taken out', () => {
    // The other half of the case above, and the reason it is written down: the reader did not
    // change in 6.8 and does not need to. Flatten the lines — which is exactly what `documentText`
    // did until 6.8 — and the same paper reads the same way it read on staging.
    const flattened =
      'הסכם שכירות כתובת המושכר: נרקיס 45, כפר סבא דירה מספר 3 המשכיר: אבי לוי';
    assert.equal(readPlace(flattened).city, 'כפר סבא דירה מספר 3 המשכיר');
  });

  it('resolves a flat off an address line that ends in no punctuation at all', async () => {
    // 6.7's original bar, unchanged and now provable: the line end is the terminator, so the paper
    // needs no full stop and no comma after the town.
    const pages = await createFakePdfText([
      'כתובת המושכר: נרקיס 45, כפר סבא\nדירה 3',
    ]).pages(Buffer.from('x'));
    const reading = readPlace(documentText(pages));
    // Asserted here and not only through the resolution: the fake database below answers every
    // query with the same row, so a reading that got the city wrong would still resolve the flat
    // and this case would pass while proving nothing.
    assert.equal(reading.city, 'כפר סבא');
    const units: UnitHit[] = [
      {
        unit_id: 'unit-3',
        unit_number: '3',
        building_id: 'building',
        building_name: 'נרקיס 45',
        address_line: 'נרקיס 45',
        city: 'כפר סבא',
      },
    ];
    const db = { query: async () => ({ rows: units }) };
    const resolved = await resolvePlace(db as never, reading);
    assert.equal(resolved.unit?.unit_number, '3');
  });

  it('returns nulls for a document that names no place, and nulls are not an error', () => {
    const reading = readPlace(
      'חוזה שכירות אחיד. תקופת השכירות היא לשלוש שנים.',
    );
    assert.deepEqual(reading, {
      addressLine: null,
      city: null,
      apartmentNumber: null,
    });
  });

  it('reads no city when none was written, which is what stops a guess', () => {
    // רקפת 12 exists in more than one town in this country. Without a city there is no exact key,
    // so A12 offers candidates instead of filing.
    const reading = readPlace('כתובת המושכר: רקפת 12. דירה 3.');
    assert.equal(reading.addressLine, 'רקפת 12');
    assert.equal(reading.city, null);
    assert.deepEqual(addressKeysFor(reading), []);
  });

  it('asks in both spellings of the street, normalised the way the column is', () => {
    assert.deepEqual(
      addressKeysFor({
        addressLine: 'רקפת  12',
        city: ' שוהם ',
        apartmentNumber: null,
      }),
      ['שוהם|רקפת 12', 'שוהם|רחוב רקפת 12'],
    );
  });

  it('cuts a building-sized candidate list, and says how long it really was', async () => {
    // The case the live click found: the address matched a building of 72 flats and the apartment
    // number matched none of them. Every flat is a correct candidate and 72 radio buttons is not a
    // list — so the screen gets `CANDIDATE_LIMIT` of them and the real number to print.
    const units: UnitHit[] = Array.from({ length: 72 }, (_, at) => ({
      unit_id: `unit-${at}`,
      unit_number: String(at + 1),
      building_id: 'building',
      building_name: 'בניין רקפת 12',
      address_line: 'רקפת 12',
      city: 'שוהם',
    }));
    const db = { query: async () => ({ rows: units }) };
    const resolved = await resolvePlace(db as never, {
      addressLine: 'רקפת 12',
      city: 'שוהם',
      apartmentNumber: '999',
    });
    assert.equal(resolved.unit, null);
    assert.equal(resolved.candidates?.length, CANDIDATE_LIMIT);
    assert.equal(resolved.total, 72);
  });

  it('reads a party address as nothing at all, which is slice 6.11', () => {
    // **The week-6 demo's own paper, and red before this slice.** `מרחוב` is how a person's
    // residence is introduced on a standard form and never how a property is, and the bare `רחוב`
    // needle matched inside it: the reader returned `דם המכבים 38`, which is the landlord's street.
    // Nulls here are the candidate list and the search box, which is a question somebody can answer.
    const reading = readPlace(
      'המשכיר: אבי לוי ת.ז 012345678 מרחוב דם המכבים 38, מודיעין',
    );
    assert.deepEqual(reading, {
      addressLine: null,
      city: null,
      apartmentNumber: null,
    });
  });

  it('files nothing against the landlord own flat, which is the danger and not the null', async () => {
    // **The half that matters, and the reason a null is not the defect.** The fake database answers
    // every query with the same row, so a reading that kept the party's street — with a town after
    // its comma, which is an ordinary lease — resolves to exactly one unit, and `fileDocument` runs
    // against it with no screen in between. Red before 6.11: the unit came back.
    const units: UnitHit[] = [
      {
        unit_id: 'unit-landlord',
        unit_number: '7',
        building_id: 'building',
        building_name: 'דם המכבים 38',
        address_line: 'דם המכבים 38',
        city: 'מודיעין',
      },
    ];
    const db = { query: async () => ({ rows: units }) };
    const resolved = await resolvePlace(
      db as never,
      readPlace('המשכיר: אבי לוי ת.ז 012345678 מרחוב דם המכבים 38, מודיעין'),
    );
    assert.equal(resolved.unit, null);
    assert.equal(resolved.candidates?.length, 0);
  });

  it('takes the labelled property address over a party one printed above it', () => {
    // The tier decides and the position does not. Every standard form prints its parties first, so
    // a leftmost-wins reader reads the wrong address on all of them — this one through `ברחוב`,
    // which is a spelling 6.11 deliberately keeps.
    const reading = readPlace(
      'המשכיר: אבי לוי, ת.ז 012345678, ברחוב דם המכבים 38, מודיעין\nכתובת המושכר: נרקיס 45, כפר סבא\nדירה 3',
    );
    assert.equal(reading.addressLine, 'נרקיס 45');
    assert.equal(reading.city, 'כפר סבא');
    assert.equal(reading.apartmentNumber, '3');
  });

  it('skips a street that stands on a line naming a person, and reads the next one', () => {
    // No label anywhere, which is the case tier two exists for: the first address on the page is a
    // tenant's home and the second is the property. The identity marker on the line is what tells
    // them apart, and `ברחוב` alone cannot.
    const reading = readPlace(
      'השוכרת: דנה כהן, ת.ז 023456789, המתגוררת ברחוב האלון 4, חיפה\nהמושכר הוא דירה 9 ברחוב נרקיס 45, כפר סבא',
    );
    assert.equal(reading.addressLine, 'נרקיס 45');
    assert.equal(reading.city, 'כפר סבא');
    assert.equal(reading.apartmentNumber, '9');
  });

  it('reads a hyphenated flat whole, apostrophe spaced the way the scan leaves it', () => {
    // `דירה מס ' 206-7` on the demo's paper: the reader stopped at `206`, and a flat numbered 206 is
    // a different flat. The space before the apostrophe defeated the `מס` branch outright, so what
    // actually came back was null.
    const reading = readPlace(
      "פרטיה ותיאורה של הדירה מס ' 206-7 כמפורט בנספח א'",
    );
    assert.equal(reading.apartmentNumber, '206-7');
    // Asserted against the estate's own comparison rather than left to the screen: `foldPlace`
    // drops the hyphen, so the number the reader now returns is one `apartmentMatches` can use.
    assert.ok(apartmentMatches('206-7', '206-7'));
  });

  it('places nothing off a body that defers to an annex, and that is the ruling', () => {
    // **A12 does not read an annex** (SPEC-evidence.md, slice 6.11). The annex sits past the pages
    // the online OCR call reads and the byte bound is on the request carrying the whole file, so no
    // page selection can reach it; and a גוש/חלקה identification has nothing to resolve against,
    // the estate being keyed on an address. Green before 6.11 as well — it is written down so that
    // a later reader cannot be taught to guess a flat out of a parcel number.
    const reading = readPlace(
      "המושכר: הדירה שפרטיה ותיאורה כמפורט בנספח א' לחוזה זה, גוש 80031 חלקות 43, 46, מגרש 212א",
    );
    assert.deepEqual(reading, {
      addressLine: null,
      city: null,
      apartmentNumber: null,
    });
  });
});
