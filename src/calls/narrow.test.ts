// #225. The strings a Hebrew page would reverse, and the chevrons that point
// the way the page reads. The layout at a narrow width is CSS and is clicked,
// not asserted; these are the bytes a click cannot be trusted to notice.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { h } from '../kernel/ui/html.ts';
import type { ServiceCallDetail } from './contract.ts';
import {
  renderCallPage,
  renderCallsPage,
  renderFilteredPage,
} from './contract.ts';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const GOAL = { amberMinutes: 240, redMinutes: 1440 };
const COUNTS = {
  open: 1,
  emergency: 0,
  near: 0,
  past: 0,
  late: 0,
  toReview: 0,
};

function detail(overrides: Partial<ServiceCallDetail> = {}): ServiceCallDetail {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sourceChannel: 'EMAIL',
    state: 'NEW',
    description: 'נזילה במטבח',
    sender: { kind: 'named', name: 'dana@example.test' },
    openedAt: new Date('2026-10-06T10:00:00.000Z'),
    requester: null,
    category: null,
    emergency: { flagged: false },
    wasEmergency: false,
    toReview: false,
    summary: null,
    proposal: null,
    sorterLabel: null,
    sorterModel: null,
    sorterPrompt: null,
    returned: false,
    exit: null,
    repeatedBy: [],
    continuedBy: [],
    predecessor: null,
    returnedBy: null,
    timeline: [
      {
        kind: 'OPENED',
        at: new Date('2026-10-06T10:00:00.000Z'),
        actorId: null,
        actorLabel: 'המערכת',
        partyName: null,
        categoryLabel: null,
        flagBy: null,
      },
    ],
    ...overrides,
  };
}

function callPage(overrides: Partial<ServiceCallDetail> = {}, receipt = false) {
  return renderCallPage({
    nav: h``,
    csrf: 'token',
    call: detail(overrides),
    categories: [],
    matches: [],
    query: '',
    dupQuery: '',
    dupMatches: [],
    messages: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        at: new Date('2026-10-06T10:00:00.000Z'),
        body: 'יש נזילה',
        bodyHe: null,
        subject: null,
        echo: false,
        attachments: [
          {
            fileName: 'lease.pdf',
            contentType: 'application/pdf',
            byteSize: 2048,
            index: 0,
            openable: true,
            documentId: null,
          },
        ],
      },
    ],
    goal: GOAL,
    now: NOW,
    receipt,
    nextOpen: receipt
      ? { id: '44444444-4444-4444-8444-444444444444', description: 'מפתח' }
      : null,
  });
}

describe('a narrow Hebrew page', () => {
  it('reads an address sender left to right on the list, and a Hebrew name as it is', () => {
    const html = renderCallsPage({
      nav: h``,
      csrf: 'token',
      calls: [
        detail(),
        detail({
          id: '44444444-4444-4444-8444-444444444444',
          sender: { kind: 'named', name: 'יעל כהן' },
        }),
      ],
      categories: [],
      state: null,
      categoryId: null,
      emergency: false,
      toReview: false,
      band: null,
      counts: COUNTS,
      filteredCount: 0,
      goal: GOAL,
      devIntake: false,
      now: NOW,
      layout: 'list',
    });
    assert.match(html, /<span dir="ltr">dana@example\.test<\/span>/);
    assert.match(html, /<span>יעל כהן<\/span>/);
  });

  it('reads the sender and a file name left to right on the call page', () => {
    const html = callPage();
    assert.match(html, /<dd><span dir="ltr">dana@example\.test<\/span><\/dd>/);
    assert.match(html, /<span dir="ltr">lease\.pdf<\/span>/);
  });

  it('reads the staff account that flagged the call left to right', () => {
    const html = callPage({
      emergency: {
        flagged: true,
        by: 'staff',
        actorId: '77777777-7777-4777-8777-777777777777',
        actorLabel: 'ops@example.test',
      },
      wasEmergency: true,
    });
    assert.match(
      html,
      /data-emergency="true"><span dir="ltr">ops@example\.test<\/span><\/dd>/,
    );
  });

  it('draws the thread as a conversation, inbound and echo marked', () => {
    const html = callPage();
    assert.match(html, /<ol class="timeline" data-conversation>/);
    assert.match(html, /data-kind="MESSAGE" data-echo="false"/);
  });

  it('points back to the right and forward to the left', () => {
    const html = callPage(
      {
        state: 'CLOSED',
        exit: {
          kind: 'ANSWERED',
          note: 'נענתה בטלפון',
          department: null,
          duplicateOf: null,
          at: new Date('2026-10-06T11:00:00.000Z'),
          actorId: '77777777-7777-4777-8777-777777777777',
          actorLabel: 'ops@example.test',
        },
      },
      true,
    );
    assert.match(html, /class="back"><a [^>]*><svg class="chev is-back"/);
    assert.match(html, /data-next-call[^>]*>הקריאה הבאה<svg class="chev"/);
  });

  it('reads the filtered sender left to right and points back to the list', () => {
    const html = renderFilteredPage({
      nav: h``,
      csrf: 'token',
      rows: [
        {
          kind: 'message',
          id: '88888888-8888-4888-8888-888888888888',
          title: 'ניוזלטר',
          body: 'מבצע',
          bodyHe: null,
          sender: 'shop@example.test',
          sorterLabel: 'noise',
          channel: 'EMAIL',
          at: NOW,
        },
      ],
      origin: 'all',
      counts: { all: 1, sorter: 1, office: 0 },
    });
    assert.match(html, /<span dir="ltr">shop@example\.test<\/span>/);
    assert.match(html, /class="back"><a [^>]*><svg class="chev is-back"/);
  });
});
