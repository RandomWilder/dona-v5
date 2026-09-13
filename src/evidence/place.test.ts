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
import {
  addressKeysFor,
  CANDIDATE_LIMIT,
  readPlace,
  resolvePlace,
} from './internal/place.ts';

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
});
