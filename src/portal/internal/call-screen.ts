// Turns a tenant's calls into the words and dates the pages show. The status
// word is already decided. This file only lays it out.
//
// The status function arrives from the composition root. Importing it from the
// calls contract here would pull the brief back through the building switch.

import { portalText } from './copy.ts';

export type TenantStatus =
  | 'received'
  | 'handling'
  | 'waiting'
  | 'visit'
  | 'answered'
  | 'forwarded'
  | 'merged'
  | 'cancelled';

/** The fields of a call the pages lay out. The calls module fills them. */
export interface ShownCall {
  id: string;
  number: number;
  sourceChannel: string;
  state: string;
  exitKind: string | null;
  description: string;
  categoryLabel: string | null;
  openedAt: Date;
  cancelNote: string | null;
  visitStarts: Date | null;
  visitEnds: Date | null;
  replies: readonly { at: Date; body: string }[];
}

import { zoned } from './when.ts';

const CHANNELS = new Set(['WHATSAPP', 'EMAIL', 'PHONE', 'WALK_IN', 'PORTAL']);

const CLOSED = new Set(['answered', 'forwarded', 'merged', 'cancelled']);

export type StatusOf = (state: string, exitKind: string | null) => TenantStatus;

export interface CallCard {
  href: string;
  title: string;
  category: string;
  opened: string;
  channel: string | null;
  visitOn: string | null;
  status: TenantStatus;
  note: string | null;
}

export interface VisitCard {
  href: string;
  title: string;
  weekday: string;
  weekdayShort: string;
  date: string;
  from: string;
  to: string;
}

export interface ThreadBubble {
  side: 'tenant' | 'office';
  body: string;
  time: string;
}

export interface ThreadDay {
  key: string;
  label: 'today' | 'past';
  weekday: string;
  date: string;
  bubbles: readonly ThreadBubble[];
}

export interface ThreadScreen {
  title: string;
  number: string;
  category: string;
  opened: string;
  status: TenantStatus;
  visit: VisitCard | null;
  days: readonly ThreadDay[];
}

export function channelWord(channel: string): string {
  if (!CHANNELS.has(channel)) return portalText('calls.channel.other');
  return portalText(`calls.channel.${channel}`);
}

export function callCard(
  call: ShownCall,
  zone: string,
  statusOf: StatusOf,
): CallCard {
  const status = statusOf(call.state, call.exitKind);
  const opened = zoned(call.openedAt, zone);
  const visit =
    status === 'visit' && call.visitStarts !== null
      ? zoned(call.visitStarts, zone).short
      : null;
  return {
    href: `/calls/${call.id}`,
    title: call.description,
    category: call.categoryLabel ?? portalText('calls.no_category'),
    opened: opened.short,
    channel: visit === null ? channelWord(call.sourceChannel) : null,
    visitOn: visit,
    status,
    note: status === 'cancelled' ? call.cancelNote : null,
  };
}

/** The earliest visit that has not ended, on an open call. */
export function nextVisit(
  calls: readonly ShownCall[],
  now: Date,
  zone: string,
): VisitCard | null {
  let chosen: ShownCall | null = null;
  for (const call of calls) {
    if (call.state === 'CLOSED') continue;
    if (call.visitStarts === null || call.visitEnds === null) continue;
    if (call.visitEnds.getTime() <= now.getTime()) continue;
    if (
      chosen === null ||
      call.visitStarts.getTime() < (chosen.visitStarts?.getTime() ?? 0)
    ) {
      chosen = call;
    }
  }
  if (chosen === null) return null;
  return visitCard(chosen, zone);
}

export function threadScreen(
  call: ShownCall,
  messages: readonly { at: Date; body: string; echo: boolean }[],
  zone: string,
  todayKey: string,
  statusOf: StatusOf,
): ThreadScreen {
  const status = statusOf(call.state, call.exitKind);
  const bubbles = threadBubbles(call, messages);
  bubbles.sort((left, right) => left.at.getTime() - right.at.getTime());
  const days: ThreadDay[] = [];
  for (const bubble of bubbles) {
    const when = zoned(bubble.at, zone);
    const item = { side: bubble.side, body: bubble.body, time: when.time };
    const current = days.at(-1);
    if (current === undefined || current.key !== when.key) {
      days.push({
        key: when.key,
        label: when.key === todayKey ? 'today' : 'past',
        weekday: when.weekdayLong,
        date: when.short,
        bubbles: [item],
      });
      continue;
    }
    days[days.length - 1] = { ...current, bubbles: [...current.bubbles, item] };
  }
  const opened = zoned(call.openedAt, zone);
  const visit =
    status === 'visit' && call.visitStarts !== null && call.visitEnds !== null
      ? visitCard(call, zone)
      : null;
  return {
    title: call.description,
    number: String(call.number),
    category: call.categoryLabel ?? portalText('calls.no_category'),
    opened: opened.full,
    status,
    visit,
    days,
  };
}

function visitCard(call: ShownCall, zone: string): VisitCard | null {
  if (call.visitStarts === null || call.visitEnds === null) return null;
  const start = zoned(call.visitStarts, zone);
  const end = zoned(call.visitEnds, zone);
  return {
    href: `/calls/${call.id}`,
    title: call.description,
    weekday: start.weekdayLong,
    weekdayShort: start.weekdayShort,
    date: start.short,
    from: start.time,
    to: end.time,
  };
}

interface TimedBubble extends ThreadBubble {
  at: Date;
}

function threadBubbles(
  call: ShownCall,
  messages: readonly { at: Date; body: string; echo: boolean }[],
): TimedBubble[] {
  const own = messages.filter(
    (message) => !message.echo && message.body.trim() !== '',
  );
  const office = messages.filter(
    (message) => message.echo && message.body.trim() !== '',
  );
  const out: TimedBubble[] = [];
  for (const message of own) {
    out.push({
      at: message.at,
      side: 'tenant',
      body: message.body,
      time: '',
    });
  }
  for (const message of office) {
    out.push({
      at: message.at,
      side: 'office',
      body: message.body,
      time: '',
    });
  }
  for (const reply of call.replies) {
    if (reply.body.trim() === '') continue;
    out.push({ at: reply.at, side: 'office', body: reply.body, time: '' });
  }
  return out;
}

export function isClosedStatus(status: TenantStatus): boolean {
  return CLOSED.has(status);
}
