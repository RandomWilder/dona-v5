// #267. The wide split inbox sizes its two panes from the line between them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { h } from '../kernel/ui/html.ts';
import type { ServiceCall } from './contract.ts';
import { renderCallsPage } from './contract.ts';
import {
  inboxDragDelta,
  inboxWidth,
  SPLIT_INBOX_KEY,
} from './internal/split-resize.ts';

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

function call(): ServiceCall {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sourceChannel: 'PHONE',
    state: 'NEW',
    description: 'נזילה במטבח',
    sender: { kind: 'unknown' },
    openedAt: NOW,
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
  };
}

function page(layout?: 'list'): string {
  return renderCallsPage({
    nav: h``,
    csrf: 'token',
    calls: [call()],
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
    layout,
  });
}

describe('the split inbox separator', () => {
  it('grows the inbox when the pointer moves toward the preview, in either direction', () => {
    assert.equal(inboxDragDelta(false, 100, 140), 40);
    assert.equal(inboxDragDelta(true, 140, 100), 40);
    assert.equal(inboxDragDelta(true, 100, 140), -40);
  });

  it('keeps the inbox between the floor and the room the preview leaves', () => {
    assert.equal(inboxWidth(200, 40, 160, 480), 240);
    assert.equal(inboxWidth(200, -80, 160, 480), 160);
    assert.equal(inboxWidth(200, 400, 160, 480), 480);
    assert.equal(inboxWidth(200.4, 0.4, 160, 480), 201);
  });

  it('puts a resize separator between the inbox and the preview, and remembers the width', () => {
    const html = page();
    const work = html.indexOf('class="split-work"');
    const inbox = html.indexOf('class="glass sheet"', work);
    const handle = html.indexOf('data-split-resize', work);
    const preview = html.indexOf('aria-label="תצוגה"', work);
    assert.ok(inbox >= 0 && handle > inbox && preview > handle);
    assert.match(html, /role="separator"/);
    assert.match(html, /aria-orientation="vertical"/);
    assert.match(html, /cursor:\s*ew-resize/);
    assert.match(html, /min-inline-size:\s*16rem/);
    assert.match(html, /minmax\(20rem,\s*1fr\)/);
    assert.match(html, new RegExp(SPLIT_INBOX_KEY.replaceAll('.', '\\.')));
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    assert.equal(scripts.length, 1);
  });

  it('leaves the list view without a separator', () => {
    const html = page('list');
    assert.doesNotMatch(html, /data-split-resize|<script/);
  });
});
