// #240. The letting's title is one sentence, computed, never stored.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tenancyTitle, tenancyTitleName } from './contract.ts';

describe('tenancy · the title', () => {
  it('joins the name, the street and city, the flat and the start date', () => {
    assert.equal(
      tenancyTitle({
        name: 'יוסף כהן',
        address: 'הדקל 44, שוהם',
        unitNumber: '7',
        startDate: '2026-11-01',
      }),
      'יוסף כהן · הדקל 44, שוהם · דירה 7 · 2026-11-01',
    );
  });

  it('leaves out a missing name and nothing else', () => {
    assert.equal(
      tenancyTitle({
        name: null,
        address: 'הדקל 44, שוהם',
        unitNumber: '7',
        startDate: '2026-11-01',
      }),
      'הדקל 44, שוהם · דירה 7 · 2026-11-01',
    );
  });

  it('leaves out a blank segment', () => {
    assert.equal(
      tenancyTitle({
        name: '  ',
        address: null,
        unitNumber: '7',
        startDate: '',
      }),
      'דירה 7',
    );
  });

  it('uses the primary tenant, and otherwise the first co-tenant', () => {
    const people = [
      { role: 'GUARANTOR', name: 'משה לוי' },
      { role: 'CO_TENANT', name: 'רחל כהן' },
      { role: 'OCCUPANT', name: 'ילד כהן' },
    ];
    assert.equal(tenancyTitleName(people), 'רחל כהן');
    assert.equal(
      tenancyTitleName([
        { role: 'CO_TENANT', name: 'רחל כהן' },
        { role: 'PRIMARY_TENANT', name: 'יוסף כהן' },
      ]),
      'יוסף כהן',
    );
    assert.equal(
      tenancyTitleName([{ role: 'GUARANTOR', name: 'משה לוי' }]),
      null,
    );
  });
});
