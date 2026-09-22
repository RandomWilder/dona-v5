// The tenancy card. #134.
//
// The view prints typed columns and the captures it is handed. It does not decide which captures
// belong — that is the read model's job — and it does not inspect a capture's value.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { h } from '../kernel/ui/html.ts';
import type { FiledDocumentView, TenancySheet, UnitHit } from './contract.ts';
import { renderTenancyDetailPage } from './contract.ts';

const unit: UnitHit = {
  unit_id: '44444444-4444-4444-8444-444444444444',
  unit_number: '7',
  building_id: '11111111-1111-4111-8111-111111111111',
  building_name: 'בניין',
  address_line: 'רקפת 12',
  city: 'שוהם',
};

const lease: FiledDocumentView = {
  documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  typeKey: 'lease',
  labelHe: 'חוזה שכירות',
  ingestedAt: '2026-09-07',
  validFrom: null,
  validTo: null,
  storageUri: 'gs://x/lease.pdf',
  verificationVerdict: 'unguarded',
};

function sheet(over: Partial<TenancySheet> = {}): TenancySheet {
  return {
    tenancyId: '55555555-5555-4555-8555-555555555555',
    status: 'DRAFT',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    rentAmount: '4500',
    rentCurrency: 'ILS',
    optionEndDate: '2028-08-31',
    parkingSpaceId: null,
    parkingName: null,
    parkingOptions: [],
    unit,
    people: [
      {
        fullName: 'דנה כהן',
        role: 'PRIMARY_TENANT',
        isServiceContact: true,
      },
    ],
    documents: [lease],
    captures: [
      {
        documentId: lease.documentId,
        labelHe: 'סכום הפיקדון',
        value: '12000',
        page: 3,
      },
    ],
    checks: [],
    canActivate: false,
    activatableOn: null,
    flags: [],
    csrf: 'csrf',
    nav: h``,
    ...over,
  };
}

describe('estate · the tenancy card', () => {
  it('shows promoted columns and cites each capture to its page', () => {
    const html = renderTenancyDetailPage(sheet());
    assert.match(html, /4500/);
    assert.match(html, /ILS/);
    assert.match(html, /2028-08-31/);
    assert.match(html, /חניה משויכת/);
    assert.match(html, /12000/);
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=3"/,
    );
    assert.doesNotMatch(html, /UNAPPROVED-SECRET/);
    assert.doesNotMatch(html, /9999/);
  });

  it('offers a reassignment when the building has parking spaces', () => {
    const html = renderTenancyDetailPage(
      sheet({
        parkingSpaceId: '66666666-6666-4666-8666-666666666666',
        parkingName: '574',
        parkingOptions: [
          {
            space_id: '66666666-6666-4666-8666-666666666666',
            name: '574',
          },
          {
            space_id: '77777777-7777-4777-8777-777777777777',
            name: '580',
          },
        ],
      }),
    );
    assert.match(html, />574</);
    assert.match(
      html,
      /action="\/estate\/tenancies\/55555555-5555-4555-8555-555555555555\/parking"/,
    );
    assert.match(html, /העברת חניה/);
  });
});
