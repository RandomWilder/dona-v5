// The word a tenant sees. The table is SPEC-calls. A state it does not name is
// בטיפול, so an internal name never reaches the portal. #281.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tenantStatus } from './contract.ts';

describe('tenant status', () => {
  it('maps the named states and sends anything else to in progress', () => {
    assert.equal(tenantStatus('NEW', null), 'received');
    assert.equal(tenantStatus('IDENTIFIED', null), 'received');
    assert.equal(tenantStatus('TRIAGED', null), 'handling');
    assert.equal(tenantStatus('RESPONSIBILITY_SET', null), 'handling');
    assert.equal(tenantStatus('WINDOWS_COLLECTED', null), 'waiting');
    assert.equal(tenantStatus('OFFERED', null), 'waiting');
    assert.equal(tenantStatus('SCHEDULED', null), 'visit');
    assert.equal(tenantStatus('CLOSED', 'ANSWERED'), 'answered');
    assert.equal(tenantStatus('CLOSED', 'FORWARDED'), 'forwarded');
    assert.equal(tenantStatus('CLOSED', 'DUPLICATE'), 'merged');
    assert.equal(tenantStatus('CLOSED', 'CANCELLED'), 'cancelled');
    assert.equal(tenantStatus('CLOSED', null), 'handling');
    assert.equal(tenantStatus('WHATEVER', null), 'handling');
  });
});
