// #241. Every call row, split and list, opens with a decorative tile for its
// channel. The text chip stays, and it is what a screen reader hears.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { h } from '../kernel/ui/html.ts';
import type { ServiceCall, SourceChannel } from './contract.ts';
import { type CallsScreen, renderCallsPage } from './contract.ts';

const CHANNELS: Record<SourceChannel, { mark: string; chip: string }> = {
  EMAIL: { mark: 'm22 7-8.991', chip: 'דוא״ל' },
  PHONE: { mark: 'M22 16.92', chip: 'טלפון' },
  WHATSAPP: { mark: 'M2.992 16.342', chip: 'וואטסאפ' },
  WALK_IN: { mark: 'M10 21H2', chip: 'הגעה' },
};

function call(channel: SourceChannel, n: number): ServiceCall {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    sourceChannel: channel,
    state: 'NEW',
    description: `קריאה ${channel}`,
    sender: { kind: 'named', name: 'דנה' },
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
  };
}

function screen(): CallsScreen {
  return {
    nav: h``,
    csrf: 'token',
    calls: (['EMAIL', 'PHONE', 'WHATSAPP', 'WALK_IN'] as const).map(call),
    categories: [],
    state: null,
    categoryId: null,
    emergency: false,
    toReview: false,
    band: null,
    counts: { open: 4, emergency: 0, near: 0, past: 0, late: 0, toReview: 0 },
    filteredCount: 0,
    goal: { amberMinutes: 240, redMinutes: 1440 },
    devIntake: false,
    now: new Date('2026-10-06T12:00:00.000Z'),
  };
}

function row(html: string, kind: 'article' | 'a', description: string): string {
  const open =
    kind === 'article' ? '<article class="call"' : '<a class="split-row"';
  const found = html
    .split(open)
    .find(
      (chunk) => chunk.includes(description) && chunk.includes('class="chip"'),
    );
  assert.ok(found, `${kind} row for ${description}`);
  return found;
}

describe('a call row opens with its channel tile', () => {
  it('shows a decorative tile on the split row and the list row, and keeps the chip', () => {
    const html = renderCallsPage(screen());
    for (const [channel, { mark, chip }] of Object.entries(CHANNELS)) {
      for (const kind of ['article', 'a'] as const) {
        const drawn = row(html, kind, `קריאה ${channel}`);
        assert.match(drawn, new RegExp(`channel-tile"[^>]*>[\\s\\S]*${mark}`));
        assert.match(drawn, /class="channel-tile" aria-hidden="true"/);
        assert.match(drawn, new RegExp(`<span class="chip">${chip}</span>`));
      }
    }
  });
});
