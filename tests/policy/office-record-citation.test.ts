// POLICY CASE — a record citation names only the record the turn loaded.
//
// #227. The model says whether it used the Unit record; it never says which. The id a citation
// links to is the Unit the turn read this turn, and a turn that read no record cites none. A model
// that could name the id could send an operator to another flat's page under this one's answer,
// which is not a judgement a model may make, so the case lives here rather than in evals.
//
// Written red first: with the `record !== null` guard removed from `readReply`, the portfolio case
// kept a record citation and failed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UnitRecord } from '../../src/estate/contract.ts';
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
