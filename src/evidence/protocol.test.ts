// The A6 reader. No database: it maps Hebrew names onto the governed list, and the specimens
// are what it is graded against.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { readHandoverProposal } from './contract.ts';

const textOf = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  assert.ok(found, `${file} is not in the corpus`);
  return found.text;
};

describe('evidence · the handover reader', () => {
  it('reads the unit protocol’s date, apartment and appliances', () => {
    const proposal = readHandoverProposal(
      textOf('handover-protocol.md'),
      'handover_protocol',
    );
    assert.equal(proposal.kind, 'unit');
    assert.equal(proposal.handoverDate, '2024-06-01');
    assert.equal(proposal.apartmentNumber, '12');
    assert.deepEqual(
      proposal.assets.map((asset) => asset.assetType).sort(),
      [
        'AC',
        'BLINDS',
        'MAMAD_BLAST_DOOR',
        'METER',
        'OVEN',
        'PLUMBING',
        'WATER_HEATER',
      ].sort(),
    );
  });

  it('reads the building protocol’s date and shared systems', () => {
    const proposal = readHandoverProposal(
      textOf('building-handover-protocol.md'),
      'building_handover_protocol',
    );
    assert.equal(proposal.kind, 'building');
    assert.equal(proposal.handoverDate, '2024-03-01');
    assert.equal(proposal.apartmentNumber, null);
    assert.deepEqual(
      proposal.assets.map((asset) => asset.assetType).sort(),
      [
        'BOILER',
        'ELEVATOR',
        'EMERGENCY_LIGHT',
        'EXTINGUISHER',
        'GATE_MOTOR',
        'INTERCOM',
        'METER',
        'PUMP',
        'SMOKE_DETECTOR',
        'SPRINKLER',
      ].sort(),
    );
  });

  it('does not treat a lease as a protocol with a date', () => {
    const proposal = readHandoverProposal(
      textOf('lease-standard.md'),
      'handover_protocol',
    );
    assert.equal(proposal.handoverDate, null);
  });
});
