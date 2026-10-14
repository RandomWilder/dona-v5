// POLICY CASE — a record citation names only the record the turn loaded.
//
// #227. The model says whether it used the Unit record; it never says which. The id a citation
// links to is the Unit the turn read this turn, and a turn that read no record cites none. A model
// that could name the id could send an operator to another flat's page under this one's answer,
// which is not a judgement a model may make, so the case lives here rather than in evals.
//
// Written red first: with the `record !== null` guard removed from `readReply`, the portfolio case
// kept a record citation and failed.
//
// #230. On a Building record the model names the Unit lines it drew on, by number. A number the
// loaded record does not hold — another Building's flat, a flat that does not exist, or an id —
// is dropped, and the citation falls back to the Building. Red first by mutation: with
// `recordCitation` taking the model's string as the unitId, the invented-line case linked to it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BuildingRecord, UnitRecord } from '../../src/estate/contract.ts';
import {
  answerOfficeHits,
  OFFICE_TURN_REFUSAL,
} from '../../src/evidence/contract.ts';
import { createFakeExtractor } from '../../src/kernel/extraction.ts';

const RECORD: UnitRecord = {
  unitId: 'unit-loaded-this-turn',
  unitNumber: '12',
  buildingName: 'בניין',
  addressLine: 'רחוב 1',
  city: 'עיר',
  floor: '3',
  rooms: '4',
  areaSqm: '82',
  hasMamad: true,
  tenure: 'FOR_RENT',
  builtParking: null,
  builtStorage: null,
  letting: null,
};

const HIT = {
  passageId: 'p',
  documentId: 'd',
  page: 1,
  text: 'דף',
  documentType: 'lease',
  unitId: null,
  distance: 0.5,
};

function citingRecord(extra: Record<string, unknown> = {}) {
  return createFakeExtractor(() => ({
    answers: true,
    text: 'שטח הדירה 82 מ״ר.',
    hit_indexes: [],
    cites_record: true,
    ...extra,
  }));
}

describe('policy · a record citation is the record loaded this turn', () => {
  it('links to the loaded Unit, whatever id the model offers', async () => {
    const result = await answerOfficeHits(
      {
        extractor: citingRecord({ record_id: 'another-flat', id: 'x' }),
        model: 'fake',
      },
      'מה שטח הדירה?',
      [],
      [],
      null,
      RECORD,
    );
    assert.deepEqual(result.citations, [
      { kind: 'record', record: 'unit', id: RECORD.unitId },
    ]);
  });

  it('is dropped when no record was loaded', async () => {
    const result = await answerOfficeHits(
      { extractor: citingRecord(), model: 'fake' },
      'מה שטח הדירה?',
      [],
      [HIT],
    );
    assert.equal(result.refused, true);
    assert.equal(result.text, OFFICE_TURN_REFUSAL);
    assert.deepEqual(result.citations, []);
  });
});

const BUILDING: BuildingRecord = {
  buildingId: 'building-loaded-this-turn',
  name: 'בניין',
  addressLine: 'רחוב 1',
  city: 'עיר',
  projectName: null,
  handoverDate: '2025-01-01',
  warrantyEndDate: '2026-01-01',
  status: 'ACTIVE',
  units: [
    {
      unitId: 'unit-12-in-this-building',
      unitNumber: '12',
      floor: '3',
      rooms: '4',
      areaSqm: '82',
      tenure: 'FOR_RENT',
      builtParking: null,
      builtStorage: null,
    },
  ],
  parking: { total: 0, assigned: 0 },
  storage: { total: 0, assigned: 0 },
};

async function citeLines(lines: unknown) {
  const result = await answerOfficeHits(
    { extractor: citingRecord({ record_units: lines }), model: 'fake' },
    'באיזו קומה הדירה?',
    [],
    [],
    null,
    BUILDING,
  );
  return result.citations;
}

describe('policy · a Unit-line citation is a line of the Building record loaded this turn', () => {
  it('links to a Unit the record holds', async () => {
    assert.deepEqual(await citeLines(['12']), [
      {
        kind: 'record',
        record: 'building',
        id: BUILDING.buildingId,
        unitId: 'unit-12-in-this-building',
      },
    ]);
  });

  it('drops a line the record does not hold, and cites the Building', async () => {
    for (const lines of [['99'], ['another-building-unit-id'], [12], 'x']) {
      assert.deepEqual(await citeLines(lines), [
        { kind: 'record', record: 'building', id: BUILDING.buildingId },
      ]);
    }
  });
});
