import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { obligationStatus } from './status.ts';

const TODAY = '2026-09-12';

describe('obligationStatus', () => {
  it('is MISSING when evidence is required and absent', () => {
    assert.equal(
      obligationStatus({
        requiresEvidence: true,
        evidenceDocumentId: null,
        validTo: '2028-01-01',
        today: TODAY,
      }),
      'MISSING',
    );
  });

  it('is EXPIRED when valid_to is strictly before today', () => {
    assert.equal(
      obligationStatus({
        requiresEvidence: false,
        evidenceDocumentId: null,
        validTo: '2026-09-11',
        today: TODAY,
      }),
      'EXPIRED',
    );
  });

  it('is EXPIRING on today and on the 60th day, SATISFIED on the 61st', () => {
    assert.equal(
      obligationStatus({
        requiresEvidence: false,
        evidenceDocumentId: null,
        validTo: TODAY,
        today: TODAY,
      }),
      'EXPIRING',
    );
    assert.equal(
      obligationStatus({
        requiresEvidence: false,
        evidenceDocumentId: null,
        validTo: '2026-11-11',
        today: TODAY,
      }),
      'EXPIRING',
    );
    assert.equal(
      obligationStatus({
        requiresEvidence: false,
        evidenceDocumentId: null,
        validTo: '2026-11-12',
        today: TODAY,
      }),
      'SATISFIED',
    );
  });

  it('is SATISFIED with no end date when evidence is not required', () => {
    assert.equal(
      obligationStatus({
        requiresEvidence: false,
        evidenceDocumentId: null,
        validTo: null,
        today: TODAY,
      }),
      'SATISFIED',
    );
  });
});
