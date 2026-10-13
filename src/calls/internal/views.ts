// The קריאות screens. #182 is the list and the manual entry. #183 is one call:
// its timeline, identifying the requester, and setting the trade. #184 closes
// it by an Exit. #186 adds the filtered list, the messages, and return.
//
// Server-rendered, no client JavaScript. The rail count is the open-call count
// for the whole office, passed in by the route, so a filter does not shrink it.
import { DEFAULT_ZONE, dayIn } from '../../kernel/clock.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import {
  ageMinutes,
  CALL_STATES,
  type CallState,
  type CallTransition,
  type CategoryRow,
  canExit,
  DEPARTMENT_MAX,
  DESCRIPTION_MAX,
  type ExitKind,
  MANUAL_CHANNELS,
  NOTE_MAX,
  type ResponseBand,
  type ResponseGoal,
  responseGoalBand,
  SENDER_MAX,
  type ServiceCall,
  type ServiceCallDetail,
  type SorterLabel,
  type SourceChannel,
} from './commands.ts';

export interface TimelineMessage {
  id: string;
  at: Date;
  body: string;
  bodyHe: string | null;
  subject: string | null;
  echo: boolean;
  attachments: readonly {
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
    index: number;
    openable: boolean;
    documentId: string | null;
  }[];
}

export interface FilteredRow {
  kind: 'message' | 'call';
  id: string;
  title: string;
  body: string;
  bodyHe: string | null;
  sender: string;
  sorterLabel: SorterLabel | null;
  channel: SourceChannel;
  /** When the message arrived, or when the office returned the call. */
  at: Date;
}

export interface FilteredCounts {
  all: number;
  sorter: number;
  office: number;
}

export type FilteredOrigin = 'all' | 'sorter' | 'office';

export interface OpenListCounts {
  open: number;
  emergency: number;
  near: number;
  past: number;
  late: number;
  toReview: number;
}

/** What was typed into the log dialog, kept when the entry is refused. */
export interface LogDraft {
  channel: string;
  description: string;
  sender: string;
  senderName: string;
}

export interface CallsScreen {
  nav: Html;
  csrf: string;
  calls: readonly ServiceCall[];
  categories: readonly CategoryRow[];
  state: CallState | null;
  categoryId: string | null;
  emergency: boolean;
  toReview: boolean;
  band: ResponseBand | 'late' | null;
  counts: OpenListCounts;
  /** Noise messages plus returned calls, the rows the filtered list will show. */
  filteredCount: number;
  goal: ResponseGoal;
  devIntake: boolean;
  now: Date;
  /** The shared mailbox has not been read successfully for an hour. */
  mailboxWarning?: boolean;
  /** #193. No echo from the office phone for seven days. */
  whatsappWarning?: boolean;
  /** #198. The mailbox's secret is near expiry, or its expiry is unknown. */
  secretWarning?: SecretNotice | null;
  /** The log dialog is open on this list. A refusal opens it too. */
  logging?: boolean;
  draft?: LogDraft | null;
  refusal?: string;
  /** `list` is the explicit list view. Anything else is the split inbox. */
  layout?: 'split' | 'list';
  /**
   * The call the split inbox previews. Null when the list is empty.
   * Omitted means the first row, with no inbound message loaded.
   */
  preview?: { id: string; excerpt: string } | null;
}

/** Mirrors channel's `SecretWarning`: channel imports calls, so calls cannot import it back. */
export type SecretNotice =
  | { kind: 'renew'; expires: string }
  | { kind: 'unknown' };

export interface FilteredScreen {
  nav: Html;
  csrf: string;
  rows: readonly FilteredRow[];
  origin: FilteredOrigin;
  counts: FilteredCounts;
  refusal?: string;
}

export interface CallScreen {
  nav: Html;
  csrf: string;
  call: ServiceCallDetail;
  categories: readonly CategoryRow[];
  matches: readonly { id: string; name: string }[];
  query: string;
  dupQuery: string;
  dupMatches: readonly { id: string; description: string }[];
  messages: readonly TimelineMessage[];
  goal: ResponseGoal;
  now: Date;
  /** Staff who may file a document. The button is absent otherwise. */
  mayFile?: boolean;
  /** `party.read`. The requester's name links to the profile only then. */
  mayReadParties?: boolean;
  documentTypes?: readonly { typeKey: string; labelHe: string }[];
  refusal?: string;
  /** Drawn only on the arrival after a close. */
  receipt?: boolean;
  /** The first open call. Read only while the receipt is drawn. */
  nextOpen?: { id: string; description: string } | null;
  /** What was posted to an exit, kept when the exit is refused. */
  exitDraft?: ExitDraft;
}

/** The exit a refusal re-renders, with the values that were posted. */
export interface ExitDraft {
  kind: string;
  note: string;
  department: string;
  duplicateOf: string;
}

const CHANNEL_HE: Record<SourceChannel, string> = {
  PHONE: 'טלפון',
  WALK_IN: 'הגעה',
  WHATSAPP: 'וואטסאפ',
  EMAIL: 'דוא״ל',
};

export const CALL_STATE_HE: Record<CallState, string> = {
  NEW: 'חדשה',
  IDENTIFIED: 'זוהתה',
  TRIAGED: 'מוינה',
  RESPONSIBILITY_SET: 'אחריות נקבעה',
  WINDOWS_COLLECTED: 'חלונות נאספו',
  OFFERED: 'הוצעה',
  SCHEDULED: 'נקבעה',
  CLOSED: 'סגורה',
};

const EXIT_HE: Record<ExitKind, string> = {
  ANSWERED: 'נענתה',
  FORWARDED: 'הועברה',
  DUPLICATE: 'כפולה',
  CANCELLED: 'בוטלה',
};

const SORTER_HE: Record<SorterLabel, string> = {
  call: 'קריאה',
  unsure: 'לא בטוח',
  noise: 'רעש',
};

const BAND_HE: Record<ResponseBand, string> = {
  amber: 'קרוב ליעד',
  red: 'מעבר ליעד',
};

const FILTER_STATES = CALL_STATES.filter((state) => state !== 'CLOSED');

const styles = h`<style>
  .calls { display: grid; gap: var(--space-6); }
  .calls .call-form,
  .calls .sheet {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
  }
  .calls dialog.call-form {
    position: fixed;
    z-index: var(--z-dialog);
    inset-block-start: var(--space-10);
    inset-inline: 0;
    inline-size: min(var(--size-form-max), calc(100% - var(--space-8)));
    max-block-size: calc(100dvh - var(--space-10) - var(--space-4));
    margin-block: 0;
    margin-inline: auto;
    overflow: auto;
    border: 0;
  }
  .calls .call-form .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }
  .calls .field {
    display: grid;
    gap: var(--space-2);
    border: 0;
    padding: 0;
    background: transparent;
    min-height: 0;
  }
  .calls .choice,
  .calls .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    border: 0;
    margin: 0;
    padding: 0;
  }
  .calls .choice legend { padding: 0; }
  .calls .choice label,
  .calls .filters label { display: inline-flex; gap: var(--space-2); align-items: center; }
  .calls .refusal,
  .calls .mailbox-warning { margin: 0; color: var(--color-alert); }
  .calls .receipt { margin: 0; }
  .calls .call-list { display: grid; gap: var(--space-3); }
  .calls .group { display: grid; gap: var(--space-3); }
  .calls .group h2 { margin: 0; font-size: var(--text-lg); }
  .calls .summary { margin: 0; }
  .calls .stat.is-alert {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
  }
  .calls .stat.is-alert .stat-label { flex-basis: 100%; }
  .calls .stat.is-alert .stat-value { color: var(--color-alert); }
  .calls .stat-note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .calls .call {
    display: grid;
    gap: var(--space-2);
    padding-block: var(--space-3);
    border-block-end: var(--size-hairline) solid var(--color-divider-soft);
  }
  .calls .call[data-emergency="true"],
  .calls .call[data-emergency="true"] .call-main a,
  .calls .call[data-emergency="true"] .call-meta {
    color: var(--color-alert);
  }
  .calls .call-meta [data-goal="amber"],
  .calls .facts [data-goal="amber"] { color: var(--color-caution); }
  .calls .call-meta [data-goal="red"],
  .calls .facts [data-goal="red"] { color: var(--color-alert); }
  .calls .call.glass {
    padding: var(--space-4);
    border-block-end-color: var(--glass-stroke);
  }
  .calls .call-main { margin: 0; }
  .calls .call-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .calls .timeline {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding-inline-start: 1.25rem;
  }
  .calls .steps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0 0 var(--space-3);
    list-style: none;
    border-block-end: var(--size-hairline) solid var(--color-divider-soft);
  }
  .calls .steps li {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .calls .steps li[aria-current="step"] {
    color: var(--color-text);
    font-weight: 600;
  }
  .calls .steps li.is-done { color: var(--color-ok); }
  .calls .head-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }
  .calls .head-meta .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .calls .back { margin: 0; }
  .calls .message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .calls .timeline .when,
  .calls .timeline [data-translation] {
    margin: 0;
    color: var(--color-text-muted);
  }
  .calls .file {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .calls .call-work {
    display: grid;
    gap: var(--space-6);
    align-items: start;
  }
  .calls .call-record {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .calls .call-aside {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5);
    min-width: 0;
  }
  .calls .aside-block { display: grid; gap: var(--space-3); }
  .calls .call-aside h2 { margin: 0; font-size: var(--text-lg); }
  .calls .head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }
  .calls .head-actions form { margin: 0; }
  .calls .exit {
    display: grid;
    gap: var(--space-3);
    padding-block: var(--space-2);
  }
  .calls .exit summary { cursor: pointer; }
  .calls .exit .btn {
    white-space: normal;
    block-size: auto;
    text-align: start;
  }
  @media (min-width: 64rem) {
    .calls .call-work:has(.call-aside) {
      grid-template-columns: var(--size-retrieval) minmax(0, 1fr);
    }
    .calls .split-work {
      grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
    }
  }
  .calls .split-layout { display: grid; gap: var(--space-6); }
  .calls .list-layout { display: none; }
  .calls.is-list .list-layout { display: grid; gap: var(--space-6); }
  .calls.is-list .split-layout { display: none; }
  .calls .split-work {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .calls .split-rows { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .calls .split-row {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-3);
    color: inherit;
    text-decoration: none;
  }
  .calls .split-row[aria-current="true"] { background: var(--glass-fill-strong); }
  .calls .split-row[data-emergency="true"] { color: var(--color-alert); }
  .calls .preview {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    align-content: start;
  }
  @media (max-width: 63.99rem) {
    .calls .list-layout { display: grid; gap: var(--space-6); }
    .calls .split-layout { display: none; }
  }
</style>`;

function ordinarySize(bytes: number): string {
  const unit = 1024;
  if (bytes < unit) return `${String(bytes)} B`;
  if (bytes < unit * unit) return `${oneDecimal(bytes / unit)} KB`;
  return `${oneDecimal(bytes / (unit * unit))} MB`;
}

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ageLabel(openedAt: Date, now: Date): string {
  const minutes = ageMinutes(openedAt, now);
  if (minutes < 1) return 'עכשיו';
  if (minutes === 1) return 'דקה';
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'שעה';
  if (hours === 2) return 'שעתיים';
  if (hours < 24) return `${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'יום';
  if (days === 2) return 'יומיים';
  return `${days} ימים`;
}

function whenLabel(at: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: DEFAULT_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

function selected(on: boolean): Html {
  return on ? h`selected` : h``;
}

function checked(on: boolean): Html {
  return on ? h`checked` : h``;
}

function ltr(value: number): Html {
  return h`<span dir="ltr">${value}</span>`;
}

function goalChip(call: ServiceCall, screen: CallsScreen): Html {
  if (call.state === 'CLOSED') return h``;
  const band = responseGoalBand(
    call.state,
    call.openedAt,
    screen.now,
    screen.goal,
  );
  if (band === null) return h`<span class="chip">בזמן</span>`;
  return h`<span class="chip" data-goal="${band}">${BAND_HE[band]}</span>`;
}

function compareOpened(
  a: ServiceCall,
  b: ServiceCall,
  newestFirst: boolean,
): number {
  const delta = a.openedAt.getTime() - b.openedAt.getTime();
  const byTime = newestFirst ? -delta : delta;
  if (byTime !== 0) return byTime;
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return newestFirst ? -byId : byId;
}

function arrange(screen: {
  calls: readonly ServiceCall[];
  state: CallState | null;
  now: Date;
  goal: ResponseGoal;
}): {
  urgent: ServiceCall[];
  rest: ServiceCall[];
} | null {
  if (screen.state === 'CLOSED') return null;
  const emergency: ServiceCall[] = [];
  const past: ServiceCall[] = [];
  const rest: ServiceCall[] = [];
  for (const call of screen.calls) {
    if (call.emergency.flagged) emergency.push(call);
    else if (
      responseGoalBand(call.state, call.openedAt, screen.now, screen.goal) ===
      'red'
    ) {
      past.push(call);
    } else rest.push(call);
  }
  emergency.sort((a, b) => compareOpened(a, b, false));
  past.sort((a, b) => compareOpened(a, b, false));
  rest.sort((a, b) => compareOpened(a, b, true));
  return { urgent: [...emergency, ...past], rest };
}

/** The rows the office sees, in the order the list draws them. */
export function shownCalls(screen: {
  calls: readonly ServiceCall[];
  state: CallState | null;
  now: Date;
  goal: ResponseGoal;
}): ServiceCall[] {
  const groups = arrange(screen);
  if (groups === null) return [...screen.calls];
  return [...groups.urgent, ...groups.rest];
}

const EXCERPT_AT = 240;

/** First inbound message, then the summary, then the description. Cut after 240 characters. */
export function previewExcerpt(
  messages: readonly { echo: boolean; body: string }[],
  call: { summary: string | null; description: string },
): string {
  const inbound = messages.find((message) => !message.echo);
  const text = inbound?.body.trim() ?? '';
  if (text.length > EXCERPT_AT) return `${text.slice(0, EXCERPT_AT)}…`;
  if (text.length > 0) return text;
  return call.summary?.trim() || call.description;
}

function callMeta(call: ServiceCall, screen: CallsScreen): Html {
  const sender =
    call.requester?.name ??
    (call.sender.kind === 'unknown' ? 'לא ידוע' : call.sender.name);
  const category =
    call.category === null
      ? h``
      : h`<span class="chip">${call.category.labelHe}</span>`;
  const emergency = call.emergency.flagged
    ? h`<span class="chip">חירום</span>`
    : h``;
  const review = call.toReview ? h`<span class="chip">לבדיקה</span>` : h``;
  const proposal =
    call.proposal === null || call.category !== null
      ? h``
      : h`<span class="chip" data-proposal="${call.proposal.code}">הצעה: ${call.proposal.labelHe}</span>`;
  return h`<span class="chip">${CHANNEL_HE[call.sourceChannel]}</span>
    <span class="chip">${CALL_STATE_HE[call.state]}</span>
    ${category}
    ${proposal}
    ${emergency}
    ${review}
    <span>${sender}</span>
    <span>${ageLabel(call.openedAt, screen.now)}</span>
    ${goalChip(call, screen)}`;
}

function callRow(call: ServiceCall, screen: CallsScreen): Html {
  const marked = call.emergency.flagged ? 'true' : 'false';
  const reviewing = call.toReview ? 'true' : 'false';
  return h`<article class="call" data-call="${call.id}" data-channel="${call.sourceChannel}" data-call-state="${call.state}" data-emergency="${marked}" data-review="${reviewing}">
    <p class="call-main"><a href="/calls/${call.id}">${call.description}</a></p>
    <p class="call-meta">${callMeta(call, screen)}</p>
  </article>`;
}

function filterParams(
  screen: CallsScreen,
  extra: Record<string, string | null> = {},
): Record<string, string | null> {
  return {
    state: screen.state,
    category: screen.categoryId,
    emergency: screen.emergency ? '1' : null,
    review: screen.toReview ? '1' : null,
    goal: screen.band,
    view: screen.layout === 'list' ? 'list' : null,
    ...extra,
  };
}

function listHref(screen: CallsScreen, log: boolean): string {
  return callsHref(filterParams(screen, { log: log ? '1' : null }));
}

function listViewHref(screen: CallsScreen): string {
  return callsHref(
    filterParams(screen, { view: 'list', call: null, log: null }),
  );
}

function splitViewHref(screen: CallsScreen): string {
  return callsHref(filterParams(screen, { view: null, call: null, log: null }));
}

function rowHref(screen: CallsScreen, callId: string): string {
  return callsHref(filterParams(screen, { view: null, call: callId }));
}

function callsHref(params: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query === '' ? '/calls' : `/calls?${query}`;
}

function hidden(name: string, value: string | null): Html {
  if (value === null || value === '') return h``;
  return h`<input type="hidden" name="${name}" value="${value}" />`;
}

function segmentNow(screen: CallsScreen): string | null {
  if (screen.state === 'CLOSED') return 'closed';
  if (screen.emergency) return 'emergency';
  if (screen.band === 'late') return 'late';
  if (screen.toReview) return 'review';
  if (screen.band === null) return 'open';
  return null;
}

function segments(screen: CallsScreen): Html {
  const openState =
    screen.state !== null && screen.state !== 'CLOSED' ? screen.state : null;
  const current = segmentNow(screen);
  const cleared = { emergency: null, review: null, goal: null, call: null };
  const items: {
    id: string;
    label: string;
    count: number | null;
    href: string;
  }[] = [
    {
      id: 'open',
      label: 'פתוחות',
      count: screen.counts.open,
      href: callsHref(filterParams(screen, { state: openState, ...cleared })),
    },
    {
      id: 'emergency',
      label: 'חירום',
      count: screen.counts.emergency,
      href: callsHref(
        filterParams(screen, { state: openState, ...cleared, emergency: '1' }),
      ),
    },
    {
      id: 'late',
      label: 'לא בזמן',
      count: screen.counts.late,
      href: callsHref(
        filterParams(screen, { state: openState, ...cleared, goal: 'late' }),
      ),
    },
    {
      id: 'review',
      label: 'לבדיקה',
      count: screen.counts.toReview,
      href: callsHref(
        filterParams(screen, { state: openState, ...cleared, review: '1' }),
      ),
    },
    {
      id: 'closed',
      label: 'סגורות',
      count: null,
      href: callsHref(filterParams(screen, { ...cleared, state: 'CLOSED' })),
    },
  ];
  return h`<nav class="segmented glass is-raised" aria-label="סינון קריאות">
    ${items.map((item) => {
      const mark = item.id === current ? h`aria-current="true"` : h``;
      const count =
        item.count === null
          ? h``
          : h` <span class="n">${ltr(item.count)}</span>`;
      return h`<a href="${item.href}" ${mark}>${item.label}${count}</a>`;
    })}
  </nav>`;
}

function menus(screen: CallsScreen): Html {
  const goal = screen.band;
  const emergency = screen.emergency ? '1' : null;
  const review = screen.toReview ? '1' : null;
  const categories = h`<select name="category">
    <option value="" ${selected(screen.categoryId === null)}>הכל</option>
    ${screen.categories.map(
      (category) =>
        h`<option value="${category.id}" ${selected(screen.categoryId === category.id)}>${category.labelHe}${category.isActive ? h`` : h` (לא פעיל)`}</option>`,
    )}
  </select>`;
  const states = h`<select name="state">
    <option value="" ${selected(screen.state === null)}>הכל</option>
    ${FILTER_STATES.map(
      (state) =>
        h`<option value="${state}" ${selected(screen.state === state)}>${CALL_STATE_HE[state]}</option>`,
    )}
  </select>`;
  const view = hidden('view', screen.layout === 'list' ? 'list' : null);
  return h`<div class="filters">
    <form method="get" action="/calls">
      ${hidden('state', screen.state)}
      ${hidden('emergency', emergency)}
      ${hidden('review', review)}
      ${hidden('goal', goal)}
      ${view}
      <label>קטגוריה ${categories}</label>
      <button class="btn" type="submit">סינון</button>
    </form>
    <form method="get" action="/calls">
      ${hidden('category', screen.categoryId)}
      ${hidden('emergency', emergency)}
      ${hidden('review', review)}
      ${hidden('goal', goal)}
      ${view}
      <label>מצב ${states}</label>
      <button class="btn" type="submit">סינון</button>
    </form>
  </div>`;
}

function listIsNarrowed(screen: CallsScreen): boolean {
  return (
    screen.state !== null ||
    screen.categoryId !== null ||
    screen.emergency ||
    screen.toReview ||
    screen.band !== null
  );
}

function emptyCopy(screen: CallsScreen): string {
  return listIsNarrowed(screen) ? 'אין קריאות תואמות.' : 'אין קריאות פתוחות.';
}

function groupedRows(
  screen: CallsScreen,
  rowClass: string,
  row: (call: ServiceCall) => Html,
): Html {
  if (screen.calls.length === 0) {
    return h`<p class="lede">${emptyCopy(screen)}</p>`;
  }
  const groups = arrange(screen);
  const rows = (calls: readonly ServiceCall[]) =>
    h`<div class="${rowClass}">${calls.map(row)}</div>`;
  if (groups === null) return rows(screen.calls);
  const urgent =
    groups.urgent.length === 0
      ? h``
      : h`<section class="group"><h2>דורש טיפול עכשיו</h2>${rows(groups.urgent)}</section>`;
  const rest = groups.rest.length === 0 ? h`` : rows(groups.rest);
  return h`${urgent}${rest}`;
}

function callList(screen: CallsScreen): Html {
  return groupedRows(screen, 'call-list', (call) => callRow(call, screen));
}

function logDialog(screen: CallsScreen, refusal: Html): Html {
  const open = screen.logging === true || screen.refusal !== undefined;
  if (!open) return h``;
  const draft = screen.draft ?? null;
  const description = draft?.description ?? '';
  const senderName = draft?.senderName ?? '';
  return h`<dialog class="glass call-form" open aria-labelledby="log-title" aria-modal="false">
    <form method="post" action="${listHref(screen, true)}">
      ${csrfInput(screen.csrf)}
      <h2 id="log-title">רישום קריאה</h2>
      ${refusal}
      <fieldset class="choice">
        <legend>ערוץ</legend>
        ${MANUAL_CHANNELS.map(
          (channel, index) =>
            h`<label><input type="radio" name="channel" value="${channel}" ${checked(draft?.channel === channel)} ${index === 0 ? h`required` : h``} /> ${CHANNEL_HE[channel]}</label>`,
        )}
      </fieldset>
      <div class="field">
        <label for="call-description">תיאור</label>
        <textarea id="call-description" name="description" rows="3" maxlength="${DESCRIPTION_MAX}" required>${description}</textarea>
      </div>
      <fieldset class="choice">
        <legend>נרשם</legend>
        <label><input type="radio" name="sender" value="named" ${checked(draft?.sender === 'named')} required /> שם ידוע</label>
        <input name="sender_name" type="text" maxlength="${SENDER_MAX}" autocomplete="off" placeholder="שם" aria-label="שם" aria-describedby="log-sender-hint" value="${senderName}" />
        <label><input type="radio" name="sender" value="unknown" ${checked(draft?.sender === 'unknown')} /> לא ידוע</label>
        <p class="lede" id="log-sender-hint">את הפונה אפשר לזהות אחר כך מעמוד הקריאה.</p>
      </fieldset>
      <div class="actions">
        <button class="btn btn-primary" type="submit">רישום</button>
        <a class="btn btn-ghost" href="${listHref(screen, false)}">ביטול</a>
      </div>
    </form>
  </dialog>`;
}

function channelWarnings(screen: CallsScreen): Html {
  const mailbox = screen.mailboxWarning
    ? channelWarning('תיבת הדואר לא נקראה כבר שעה.')
    : h``;
  const echoWarning = screen.whatsappWarning
    ? channelWarning('אין הד מהטלפון כבר שבעה ימים. וואטסאפ עלול להתנתק.')
    : h``;
  const secret = secretNotice(
    screen.secretWarning ?? null,
    dayIn(screen.now, DEFAULT_ZONE),
  );
  return h`${mailbox}${echoWarning}${secret}`;
}

function statRow(screen: CallsScreen): Html {
  const counts = screen.counts;
  return h`<section class="stat-row" aria-label="סיכום">
    <div class="stat glass"><span class="stat-label">פתוחות</span><span class="stat-value">${ltr(counts.open)}</span></div>
    <div class="stat glass"><span class="stat-label">חירום</span><span class="stat-value">${ltr(counts.emergency)}</span></div>
    <div class="stat glass is-alert"><span class="stat-label">מעבר ליעד המענה</span><span class="stat-value">${ltr(counts.past)}</span><span class="stat-note">קרוב ליעד ${ltr(counts.near)}</span></div>
    <div class="stat glass"><span class="stat-label">לבדיקה</span><span class="stat-value">${ltr(counts.toReview)}</span></div>
  </section>`;
}

function listHeader(screen: CallsScreen): Html {
  const counts = screen.counts;
  const devLink = screen.devIntake
    ? h`<a href="/dev/intake">הודעת בדיקה</a>`
    : h``;
  const back =
    screen.layout === 'list'
      ? h`<a class="btn btn-glass" href="${splitViewHref(screen)}">מפוצל</a>`
      : h``;
  return h`<header class="page-head">
    <div>
      <h1>קריאות</h1>
      <p class="summary">פתוחות ${ltr(counts.open)} · חירום ${ltr(counts.emergency)} · לא בזמן ${ltr(counts.late)} · לבדיקה ${ltr(counts.toReview)}</p>
      <p class="lede">טלפון או הגעה. בלי מסווג. <a href="/calls/filtered">מסוננות <span class="n">${ltr(screen.filteredCount)}</span></a> ${devLink}</p>
    </div>
    <div class="head-actions">${back}<a class="btn btn-primary" href="${listHref(screen, true)}">רישום קריאה</a></div>
  </header>`;
}

function splitHeader(screen: CallsScreen): Html {
  const counts = screen.counts;
  return h`<header class="page-head">
    <div>
      <h1>קריאות</h1>
      <p class="summary" data-split-summary>פתוחות ${ltr(counts.open)} · חירום ${ltr(counts.emergency)} · מעבר ליעד ${ltr(counts.past)}</p>
      <p class="lede"><a href="/calls/filtered">מסוננות <span class="n">${ltr(screen.filteredCount)}</span></a>${screen.devIntake ? h` <a href="/dev/intake">הודעת בדיקה</a>` : h``}</p>
    </div>
    <div class="head-actions">
      <a class="btn btn-glass" href="${listViewHref(screen)}">רשימה</a>
      <a class="btn btn-primary" href="${listHref(screen, true)}">רישום קריאה</a>
    </div>
  </header>`;
}

function waitingOnCategory(state: CallState): boolean {
  return state === 'NEW' || state === 'IDENTIFIED' || state === 'TRIAGED';
}

function resolvedPreview(screen: CallsScreen): {
  call: ServiceCall;
  excerpt: string;
} | null {
  if (screen.layout === 'list' || screen.calls.length === 0) return null;
  const rows = shownCalls(screen);
  const asked = screen.preview;
  const call =
    (asked ? rows.find((row) => row.id === asked.id) : undefined) ?? rows[0];
  if (!call) return null;
  const excerpt =
    asked && asked.id === call.id
      ? asked.excerpt
      : call.summary?.trim() || call.description;
  return { call, excerpt };
}

function splitRow(
  call: ServiceCall,
  screen: CallsScreen,
  current: string | null,
): Html {
  const marked = call.emergency.flagged ? 'true' : 'false';
  const currentMark = call.id === current ? h`aria-current="true"` : h``;
  return h`<a class="split-row" href="${rowHref(screen, call.id)}" data-split-call="${call.id}" data-emergency="${marked}" ${currentMark}>
    <span class="call-main">${call.description}</span>
    <span class="call-meta">${callMeta(call, screen)}</span>
  </a>`;
}

function previewPane(screen: CallsScreen): Html {
  const preview = resolvedPreview(screen);
  if (!preview)
    return h`<section class="preview glass" aria-label="תצוגה"></section>`;
  const { call, excerpt } = preview;
  const name = call.requester?.name ?? 'טרם זוהה';
  const next = waitingOnCategory(call.state)
    ? h`<p data-next-step><a href="/calls/${call.id}">לעמוד הקריאה</a></p>`
    : h``;
  return h`<section class="preview glass" aria-label="תצוגה" data-preview="${call.id}">
    <h2>${call.description}</h2>
    <p class="call-meta">${goalChip(call, screen)}</p>
    <p>פונה <span data-requester>${name}</span></p>
    <p data-excerpt>${excerpt}</p>
    ${next}
  </section>`;
}

function listLayout(screen: CallsScreen): Html {
  return h`<div class="list-layout" data-layout="list">
    ${listHeader(screen)}
    ${statRow(screen)}
    <div class="toolbar">${segments(screen)}${menus(screen)}</div>
    <section class="glass sheet">${callList(screen)}</section>
  </div>`;
}

function splitLayout(screen: CallsScreen): Html {
  const preview = resolvedPreview(screen);
  const current = preview?.call.id ?? null;
  const list = groupedRows(screen, 'split-rows', (call) =>
    splitRow(call, screen, current),
  );
  return h`<div class="split-layout" data-layout="split">
    ${splitHeader(screen)}
    <div class="toolbar">${segments(screen)}${menus(screen)}</div>
    <div class="split-work">
      <div class="glass sheet">${list}</div>
      ${previewPane(screen)}
    </div>
  </div>`;
}

export function renderCallsPage(screen: CallsScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const explicit = screen.layout === 'list';
  const stage = explicit ? 'calls glass-stage is-list' : 'calls glass-stage';
  const body = h`
    <div class="${stage}">
      ${channelWarnings(screen)}
      ${listLayout(screen)}
      ${explicit ? h`` : splitLayout(screen)}
      ${logDialog(screen, refusal)}
    </div>`;
  return renderPage({
    title: 'קריאות — דונה דום',
    styles,
    nav: screen.nav,
    body,
  });
}

function eventLine(event: CallTransition): Html {
  const when = whenLabel(event.at);
  const who = `${event.actorLabel} · ${when}`;
  if (event.kind === 'OPENED') {
    return h`<li data-kind="OPENED">נפתחה · ${who}</li>`;
  }
  if (event.kind === 'IDENTIFIED') {
    return h`<li data-kind="IDENTIFIED">זוהתה · ${event.partyName} · ${who}</li>`;
  }
  if (event.kind === 'TRIAGED') {
    return h`<li data-kind="TRIAGED">קטגוריה ${event.categoryLabel} · ${who}</li>`;
  }
  if (event.kind === 'FLAGGED') {
    const setter = event.flagBy === 'terms' ? 'המונחים' : event.actorLabel;
    return h`<li data-kind="FLAGGED">סומנה חירום · ${setter} · ${when}</li>`;
  }
  if (event.kind === 'CLEARED') {
    return h`<li data-kind="CLEARED">הוסר סימון חירום · ${who}</li>`;
  }
  if (event.kind === 'ANSWERED') {
    return h`<li data-kind="ANSWERED">נענתה · ${event.note} · ${who}</li>`;
  }
  if (event.kind === 'FORWARDED') {
    return h`<li data-kind="FORWARDED">הועברה אל ${event.department} · ${event.note} · ${who}</li>`;
  }
  if (event.kind === 'DUPLICATE') {
    return h`<li data-kind="DUPLICATE">כפולה של ${event.duplicateOf?.description} · ${who}</li>`;
  }
  return h`<li data-kind="CANCELLED">בוטלה · ${event.note} · ${who}</li>`;
}

function sorterLabel(label: SorterLabel | null): Html {
  if (label === null) return h``;
  return h`<span data-sorter="${label}">מסווג: ${SORTER_HE[label]}</span>`;
}

function messageLine(screen: CallScreen, message: TimelineMessage): Html {
  const echo = message.echo ? 'true' : 'false';
  const subject =
    message.subject === null ? h`` : h`<span>נושא: ${message.subject}</span> `;
  const files =
    message.attachments.length === 0
      ? h``
      : h` ${message.attachments.map((file) => fileBlock(screen, message.id, file))}`;
  const who = message.echo ? 'הד מהמשרד' : 'הודעה';
  const translation =
    message.bodyHe === null
      ? h``
      : h`<p data-translation="yes">תרגום: ${message.bodyHe}</p>`;
  return h`<li data-kind="MESSAGE" data-echo="${echo}" data-message="${message.id}"><p class="message">${who} · ${subject}${message.body}</p>${translation}${files}<p class="when">${whenLabel(message.at)}</p></li>`;
}

function fileBlock(
  screen: CallScreen,
  messageId: string,
  file: TimelineMessage['attachments'][number],
): Html {
  const type =
    file.contentType === null
      ? h``
      : h` · <span data-type="${file.contentType}">${file.contentType}</span>`;
  const size =
    file.byteSize === null
      ? h``
      : h` · <span dir="ltr" data-size="${String(file.byteSize)}">${ordinarySize(file.byteSize)}</span>`;
  const callId = screen.call.id;
  const open = file.openable
    ? h` <a href="/calls/${callId}/messages/${messageId}/files/${String(file.index)}">פתיחה</a>`
    : h``;
  const filed =
    file.documentId === null
      ? fileForm(screen, messageId, file)
      : h` <a href="/documents/${file.documentId}/read" data-document="${file.documentId}">תויק</a>`;
  return h`<div class="file" data-file="${file.fileName}">קובץ: ${file.fileName}${type}${size}${open}${filed}</div>`;
}

function fileForm(
  screen: CallScreen,
  messageId: string,
  file: TimelineMessage['attachments'][number],
): Html {
  const types = screen.documentTypes ?? [];
  if (screen.mayFile !== true || !file.openable || types.length === 0) {
    return h``;
  }
  return h` <form method="post" action="/calls/${screen.call.id}/messages/${messageId}/files/${String(file.index)}">
    ${csrfInput(screen.csrf)}
    <select name="type_key" required>
      <option value="">סוג</option>
      ${types.map(
        (type) => h`<option value="${type.typeKey}">${type.labelHe}</option>`,
      )}
    </select>
    <button class="btn" type="submit">תייק כמסמך</button>
  </form>`;
}

function timelineOf(screen: CallScreen): Html {
  const items: { at: number; html: Html }[] = [];
  for (const event of screen.call.timeline) {
    items.push({ at: event.at.getTime(), html: eventLine(event) });
  }
  for (const message of screen.messages) {
    items.push({
      at: message.at.getTime() - 0.5,
      html: messageLine(screen, message),
    });
  }
  items.sort((a, b) => a.at - b.at);
  return h`${items.map((item) => item.html)}`;
}

function emergencyLabel(call: ServiceCall): string {
  if (!call.emergency.flagged) return 'לא';
  if (call.emergency.by === 'terms') return 'המונחים';
  return call.emergency.actorLabel;
}

function emergencyControl(screen: CallScreen): Html {
  const call = screen.call;
  if (call.state === 'CLOSED') return h``;
  const action = call.emergency.flagged ? 'clear' : 'flag';
  const label = call.emergency.flagged ? 'הסרת סימון חירום' : 'סימון חירום';
  return h`<form method="post" action="/calls/${call.id}/emergency">
    ${csrfInput(screen.csrf)}
    <input type="hidden" name="action" value="${action}" />
    <button class="btn" type="submit">${label}</button>
  </form>`;
}

function identifyForm(screen: CallScreen): Html {
  const matches =
    screen.query === ''
      ? h``
      : screen.matches.length === 0
        ? h`<p class="lede">אין התאמה.</p>`
        : h`<form method="post" action="/calls/${screen.call.id}/identify">
            ${csrfInput(screen.csrf)}
            <fieldset class="choice">
              <legend>בחירת פונה</legend>
              ${screen.matches.map(
                (party, index) =>
                  h`<label><input type="radio" name="party_id" value="${party.id}" ${index === 0 ? h`required` : h``} /> ${party.name}</label>`,
              )}
            </fieldset>
            <button class="btn btn-primary" type="submit">זיהוי</button>
          </form>`;
  return h`<div class="aside-block">
    <h2>זיהוי הפונה</h2>
    <p class="lede">מקשר את הקריאה הזו בלבד. לא שומר איש קשר.</p>
    <form class="filters" method="get" action="/calls/${screen.call.id}">
      <label>שם
        <input name="q" type="text" value="${screen.query}" maxlength="80" autocomplete="off" />
      </label>
      <button class="btn" type="submit">חיפוש</button>
    </form>
    ${matches}
  </div>`;
}

function canSaveContact(call: ServiceCallDetail): boolean {
  if (call.returned) return false;
  if (call.sender.kind === 'unknown') return false;
  if (call.sourceChannel !== 'EMAIL' && call.sourceChannel !== 'WHATSAPP') {
    return false;
  }
  return call.timeline.some(
    (event) => event.kind === 'IDENTIFIED' && event.actorId !== null,
  );
}

function saveContactForm(screen: CallScreen): Html {
  if (!canSaveContact(screen.call)) return h``;
  const form = h`<form method="post" action="/calls/${screen.call.id}/contact">
    ${csrfInput(screen.csrf)}
    <button class="btn btn-primary" type="submit">שמירת איש קשר</button>
  </form>`;
  if (screen.call.state === 'CLOSED') return form;
  return h`<div class="aside-block">
    <h2>שמירת איש קשר</h2>
    <p class="lede">ההודעה הבאה מהכתובת הזו תזוהה. הזיהוי עצמו לא שומר.</p>
    ${form}
  </div>`;
}

/** The six seeded trades. A longer catalogue is the select. */
const CATEGORY_CHOICE_LIMIT = 6;

function categoryControl(screen: CallScreen): Html {
  const current = screen.call.category;
  if (screen.categories.length > CATEGORY_CHOICE_LIMIT) {
    return h`<form method="post" action="/calls/${screen.call.id}/category">
      ${csrfInput(screen.csrf)}
      <label>מקצוע
        <select name="category_id" required>
          <option value="">בחירה</option>
          ${screen.categories.map(
            (category) =>
              h`<option value="${category.id}" ${selected(current?.id === category.id)}>${category.labelHe}</option>`,
          )}
        </select>
      </label>
      <button class="btn btn-primary" type="submit">שמירה</button>
    </form>`;
  }
  return h`<form method="post" action="/calls/${screen.call.id}/category">
    ${csrfInput(screen.csrf)}
    <fieldset class="choice">
      <legend>מקצוע</legend>
      ${screen.categories.map(
        (category, index) =>
          h`<label><input type="radio" name="category_id" value="${category.id}"${index === 0 ? h` required` : h``}${current?.id === category.id ? h` checked` : h``} /> ${category.labelHe}</label>`,
      )}
    </fieldset>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

function categoryForm(screen: CallScreen): Html {
  const current = screen.call.category;
  const held =
    current === null
      ? h``
      : current.active
        ? h`<p class="lede">הקטגוריה: ${current.labelHe}</p>`
        : h`<p class="lede">הקטגוריה: ${current.labelHe} (לא פעיל)</p>`;
  if (screen.categories.length === 0) {
    return h`<div class="aside-block"><h2>קטגוריה</h2>${held}<p class="lede">אין קטגוריה פעילה.</p></div>`;
  }
  return h`<div class="aside-block">
    <h2>קטגוריה</h2>
    ${held}
    ${categoryControl(screen)}
  </div>`;
}

function exitOpen(screen: CallScreen, kind: ExitKind): Html {
  if (screen.exitDraft?.kind === kind) return h` open`;
  if (kind === 'DUPLICATE' && screen.dupQuery !== '') return h` open`;
  return h``;
}

function kept(
  screen: CallScreen,
  kind: ExitKind,
  field: 'note' | 'department',
): string {
  if (screen.exitDraft?.kind !== kind) return '';
  return screen.exitDraft[field];
}

function closeControl(kind: ExitKind): Html {
  return h`<button class="btn btn-primary" type="submit">סגירה — ${EXIT_HE[kind]}. הסגירה סופית. הודעה חדשה פותחת קריאה חדשה.</button>`;
}

function noteField(screen: CallScreen, kind: ExitKind): Html {
  return h`<div class="field">
    <label for="exit-note-${kind}">סיבה</label>
    <textarea id="exit-note-${kind}" name="note" rows="3" maxlength="${NOTE_MAX}">${kept(screen, kind, 'note')}</textarea>
  </div>`;
}

function duplicateSearch(screen: CallScreen): Html {
  return h`<form class="filters" method="get" action="/calls/${screen.call.id}">
    <label>חיפוש קריאה
      <input name="dup" type="text" value="${screen.dupQuery}" maxlength="80" autocomplete="off" />
    </label>
    <button class="btn" type="submit">חיפוש</button>
  </form>`;
}

function duplicateMatches(screen: CallScreen): Html {
  const chosen =
    screen.exitDraft?.kind === 'DUPLICATE' ? screen.exitDraft.duplicateOf : '';
  if (screen.dupQuery === '' && chosen === '') return h``;
  if (screen.dupMatches.length === 0) return h`<p class="lede">אין התאמה.</p>`;
  return h`<fieldset class="choice">
    <legend>הקריאה שזו חוזרת עליה</legend>
    ${screen.dupMatches.map(
      (call) =>
        h`<label><input type="radio" name="duplicate_of" value="${call.id}"${call.id === chosen ? h` checked` : h``} /> ${call.description}</label>`,
    )}
  </fieldset>`;
}

function exitFields(screen: CallScreen, kind: ExitKind): Html {
  const department =
    kind === 'FORWARDED'
      ? h`<div class="field">
          <label for="exit-department">מחלקה</label>
          <input id="exit-department" name="department" type="text" value="${kept(screen, kind, 'department')}" maxlength="${DEPARTMENT_MAX}" autocomplete="off" />
        </div>`
      : h``;
  return h`${noteField(screen, kind)}${department}`;
}

function exitChoice(screen: CallScreen, kind: ExitKind): Html {
  const search = kind === 'DUPLICATE' ? duplicateSearch(screen) : h``;
  const fields =
    kind === 'DUPLICATE' ? duplicateMatches(screen) : exitFields(screen, kind);
  return h`<details class="exit" data-exit="${kind}"${exitOpen(screen, kind)}>
    <summary>${EXIT_HE[kind]}</summary>
    ${search}
    <form method="post" action="/calls/${screen.call.id}/exit">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="exit" value="${kind}" />
      ${fields}
      ${closeControl(kind)}
    </form>
  </details>`;
}

function exitForm(screen: CallScreen): Html {
  return h`<div class="aside-block">
    <h2>סגירה</h2>
    ${(Object.keys(EXIT_HE) as ExitKind[]).map((kind) => exitChoice(screen, kind))}
  </div>`;
}

function returnControl(screen: CallScreen): Html {
  const call = screen.call;
  if (call.state === 'CLOSED' || call.returned) return h``;
  return h`<form method="post" action="/calls/${call.id}/return">
    ${csrfInput(screen.csrf)}
    <button class="btn" type="submit">החזרה למסוננות</button>
  </form>`;
}

function rescueForm(screen: CallScreen): Html {
  const call = screen.call;
  return h`<div class="aside-block">
    <p class="lede">הוחזרה. ${sorterLabel(call.sorterLabel)} <span data-office="returned">משרד: הוחזר</span>${call.returnedBy === null ? h`` : h` · ${call.returnedBy}`}</p>
    <form method="post" action="/calls/filtered">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="call_id" value="${call.id}" />
      <button class="btn btn-primary" type="submit">הצלה — זו קריאה</button>
    </form>
  </div>`;
}

function headerActions(screen: CallScreen): Html {
  if (screen.call.state === 'CLOSED') return h``;
  return h`<div class="head-actions">${emergencyControl(screen)}${returnControl(screen)}</div>`;
}

function nextStep(screen: CallScreen): Html {
  const call = screen.call;
  if (call.state === 'NEW') return identifyForm(screen);
  if (call.state === 'IDENTIFIED' || call.state === 'TRIAGED') {
    return categoryForm(screen);
  }
  return h``;
}

function closingOf(screen: CallScreen): Html {
  if (screen.call.returned) return h``;
  if (!canExit(screen.call.state)) return h``;
  return exitForm(screen);
}

function callAside(screen: CallScreen): Html {
  const call = screen.call;
  if (call.state === 'CLOSED') {
    const save = saveContactForm(screen);
    const body = save.value === '' ? h`<p class="lede">אין פעולות.</p>` : save;
    return h`<aside class="call-aside glass" aria-label="פעולות">${body}</aside>`;
  }
  const rescue = call.returned ? rescueForm(screen) : h``;
  const parts = [
    rescue,
    nextStep(screen),
    saveContactForm(screen),
    closingOf(screen),
  ];
  if (parts.every((part) => part.value === '')) return h``;
  return h`<aside class="call-aside glass" aria-label="פעולות">${parts}</aside>`;
}

function requesterName(screen: CallScreen): Html {
  const requester = screen.call.requester;
  const name = requester?.name ?? 'טרם זוהה';
  if (requester !== null && screen.mayReadParties === true) {
    return h`<a href="/parties/${requester.id}">${name}</a>`;
  }
  return h`${name}`;
}

function repeatedBy(screen: CallScreen): Html {
  if (screen.call.repeatedBy.length === 0) return h``;
  return h`<section class="glass sheet">
    <h2>חוזרות על קריאה זו</h2>
    <ul class="timeline">
      ${screen.call.repeatedBy.map(
        (call) =>
          h`<li><a href="/calls/${call.id}">${call.description}</a></li>`,
      )}
    </ul>
  </section>`;
}

function continuedBy(screen: CallScreen): Html {
  if (screen.call.continuedBy.length === 0) return h``;
  return h`<section class="glass sheet" data-continuations>
    <h2>המשכים</h2>
    <ul class="timeline">
      ${screen.call.continuedBy.map(
        (call) =>
          h`<li><a href="/calls/${call.id}">${call.description}</a></li>`,
      )}
    </ul>
  </section>`;
}

function everEmergency(call: ServiceCallDetail): boolean {
  if (call.emergency.flagged) return true;
  return call.timeline.some((event) => event.kind === 'FLAGGED');
}

function passedStates(call: ServiceCallDetail): CallState[] {
  const kinds = new Set(call.timeline.map((event) => event.kind));
  const passed: CallState[] = [];
  if (kinds.has('OPENED')) passed.push('NEW');
  if (kinds.has('IDENTIFIED')) passed.push('IDENTIFIED');
  if (kinds.has('TRIAGED')) passed.push('TRIAGED');
  if (call.state === 'CLOSED') passed.push('CLOSED');
  return passed;
}

function outcomeCard(screen: CallScreen): Html {
  const call = screen.call;
  const exit = call.exit;
  if (call.state !== 'CLOSED' || exit === null) return h``;
  const note =
    exit.note === null ? h`` : h`<div><dt>סיבה</dt><dd>${exit.note}</dd></div>`;
  const department =
    exit.department === null
      ? h``
      : h`<div><dt>מחלקה</dt><dd>${exit.department}</dd></div>`;
  const other =
    exit.duplicateOf === null
      ? h``
      : h`<div><dt>חוזרת על</dt><dd><a href="/calls/${exit.duplicateOf.id}">${exit.duplicateOf.description}</a></dd></div>`;
  return h`<section class="glass sheet" data-outcome="${exit.kind}">
    <h2>תוצאה</h2>
    <dl class="facts">
      <div><dt>סגר</dt><dd>${exit.actorLabel}</dd></div>
      <div><dt>פתוחה</dt><dd>${ageLabel(call.openedAt, exit.at)}</dd></div>
      <div><dt>עברה</dt><dd><ol class="passed">${passedStates(call).map((state) => h`<li>${CALL_STATE_HE[state]}</li>`)}</ol></dd></div>
      ${note}
      ${department}
      ${other}
    </dl>
  </section>`;
}

function receiptOf(screen: CallScreen): Html {
  const exit = screen.call.exit;
  if (
    screen.receipt !== true ||
    screen.call.state !== 'CLOSED' ||
    exit === null
  ) {
    return h``;
  }
  const next =
    screen.nextOpen == null
      ? h``
      : h` <a data-next-call href="/calls/${screen.nextOpen.id}">הקריאה הבאה</a>`;
  return h`<p class="receipt" role="status" data-receipt="${exit.kind}">הקריאה נסגרה · ${EXIT_HE[exit.kind]}.${next}</p>`;
}

function closedWhen(screen: CallScreen): Html {
  const exit = screen.call.exit;
  if (exit === null) return h``;
  return h`<div><dt>נסגרה</dt><dd>${whenLabel(exit.at)}</dd></div>
    <div><dt>פתוחה</dt><dd>${ageLabel(screen.call.openedAt, exit.at)}</dd></div>`;
}

function stateSteps(state: CallState): Html {
  if (state === 'CLOSED') return h``;
  const current = CALL_STATES.indexOf(state);
  return h`<ol class="steps" aria-label="מצב הקריאה">
    ${CALL_STATES.map((step, index) => {
      const mark =
        index === current
          ? h`aria-current="step"`
          : index < current
            ? h`class="is-done"`
            : h``;
      return h`<li ${mark}>${CALL_STATE_HE[step]}</li>`;
    })}
  </ol>`;
}

function ageFact(screen: CallScreen): Html {
  const age = ageLabel(screen.call.openedAt, screen.now);
  const band = responseGoalBand(
    screen.call.state,
    screen.call.openedAt,
    screen.now,
    screen.goal,
  );
  if (band === null) {
    const words = screen.call.state === 'CLOSED' ? age : h`${age} · בזמן`;
    return h`<div><dt>גיל</dt><dd>${words}</dd></div>`;
  }
  return h`<div><dt>גיל</dt><dd data-goal="${band}">${age} · ${BAND_HE[band]}</dd></div>`;
}

export function renderCallPage(screen: CallScreen): string {
  const call = screen.call;
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const category = call.category?.labelHe ?? 'טרם נבחרה';
  const sender = call.sender.kind === 'unknown' ? 'לא ידוע' : call.sender.name;
  const proposal =
    call.proposal === null
      ? h``
      : h`<div><dt>הצעה</dt><dd data-proposal="${call.proposal.code}">${call.proposal.labelHe}</dd></div>`;
  const summary =
    call.summary === null
      ? h``
      : h`<div><dt>סיכום</dt><dd data-summary="${call.summary}">${call.summary}</dd></div>`;
  const review = call.toReview
    ? h`<div><dt>לבדיקה</dt><dd data-review="true">כן</dd></div>`
    : h``;
  const sorted =
    call.sorterLabel === null
      ? h``
      : h`<div><dt>מסווג</dt><dd>${sorterLabel(call.sorterLabel)}</dd></div>`;
  const earlier =
    call.predecessor === null
      ? h``
      : h`<div><dt>המשך של</dt><dd><a data-predecessor="${call.predecessor.id}" href="/calls/${call.predecessor.id}">${call.predecessor.description}</a></dd></div>`;
  const emergency =
    call.state === 'CLOSED'
      ? everEmergency(call)
        ? h`<span class="chip">היה חירום</span>`
        : h``
      : call.emergency.flagged
        ? h`<span class="chip">חירום</span>`
        : h``;
  const emergencyWords =
    call.state === 'CLOSED'
      ? everEmergency(call)
        ? 'היה חירום'
        : 'לא'
      : emergencyLabel(call);
  const back = call.state === 'CLOSED' ? '/calls?state=CLOSED' : '/calls';
  const body = h`
    <div class="calls glass-stage" data-call-state="${call.state}">
      <header class="page-head">
        <div>
          <p class="back"><a href="${back}">קריאות</a></p>
          <h1>${call.description}</h1>
          <div class="head-meta">
            <dl class="facts">
              <div><dt>ערוץ</dt><dd>${CHANNEL_HE[call.sourceChannel]}</dd></div>
              ${call.state === 'CLOSED' ? closedWhen(screen) : ageFact(screen)}
            </dl>
            ${emergency}
          </div>
        </div>
        ${headerActions(screen)}
      </header>
      ${refusal}
      ${receiptOf(screen)}
      <div class="call-work">
        ${callAside(screen)}
        <div class="call-record">
      ${call.state === 'CLOSED' ? outcomeCard(screen) : stateSteps(call.state)}
      <section class="glass sheet">
        <dl class="facts">
          <div><dt>מצב</dt><dd>${CALL_STATE_HE[call.state]}</dd></div>
          <div><dt>נרשם</dt><dd>${sender}</dd></div>
          <div><dt>פונה</dt><dd>${requesterName(screen)}</dd></div>
          <div><dt>קטגוריה</dt><dd>${category}</dd></div>
          ${proposal}
          ${summary}
          ${sorted}
          ${review}
          ${earlier}
          <div><dt>חירום</dt><dd data-emergency="${call.emergency.flagged ? 'true' : 'false'}">${emergencyWords}</dd></div>
        </dl>
      </section>
      <section class="glass sheet">
        <h2>מהלך</h2>
        <ol class="timeline">${timelineOf(screen)}</ol>
      </section>
      ${continuedBy(screen)}
      ${repeatedBy(screen)}
        </div>
      </div>
    </div>`;
  return renderPage({
    title: 'קריאה — דונה דום',
    styles,
    nav: screen.nav,
    body,
  });
}

function filteredRow(row: FilteredRow, csrf: string): Html {
  const office =
    row.kind === 'call'
      ? h` <span data-office="returned">משרד: הוחזר</span>`
      : h``;
  const title =
    row.kind === 'call'
      ? h`<a href="/calls/${row.id}">${row.title}</a>`
      : h`<span>${row.title}</span>`;
  const hidden =
    row.kind === 'call'
      ? h`<input type="hidden" name="call_id" value="${row.id}" />`
      : h`<input type="hidden" name="message_id" value="${row.id}" />`;
  const translation =
    row.bodyHe === null
      ? h``
      : h` <span data-translation="yes">תרגום: ${row.bodyHe}</span>`;
  return h`<article class="call glass" data-filtered="${row.kind}" data-filtered-id="${row.id}">
    <p class="call-main">${title}</p>
    <p class="message">${row.body}${translation}</p>
    <p class="call-meta">
      ${sorterLabel(row.sorterLabel)}
      ${office}
      <span class="chip">${CHANNEL_HE[row.channel]}</span>
      <span>${whenLabel(row.at)}</span>
      <span>${row.sender}</span>
    </p>
    <form method="post" action="/calls/filtered">
      ${csrfInput(csrf)}
      ${hidden}
      <button class="btn btn-primary" type="submit">הצלה — זו קריאה</button>
    </form>
  </article>`;
}

function filteredHref(origin: FilteredOrigin): string {
  if (origin === 'all') return '/calls/filtered';
  return `/calls/filtered?origin=${origin}`;
}

function filteredSegments(screen: FilteredScreen): Html {
  const items: {
    id: keyof FilteredScreen['counts'];
    label: string;
    href: string;
  }[] = [
    { id: 'all', label: 'הכל', href: filteredHref('all') },
    { id: 'sorter', label: 'המסווג', href: filteredHref('sorter') },
    { id: 'office', label: 'המשרד', href: filteredHref('office') },
  ];
  return h`<nav class="segmented glass is-raised" aria-label="סינון מסוננות">
    ${items.map((item) => {
      const mark = item.id === screen.origin ? h`aria-current="true"` : h``;
      return h`<a href="${item.href}" ${mark}>${item.label} <span class="n">${ltr(screen.counts[item.id])}</span></a>`;
    })}
  </nav>`;
}

export function renderFilteredPage(screen: FilteredScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const list =
    screen.rows.length === 0
      ? screen.counts.all === 0
        ? h`<p class="lede">אין הודעות מסוננות.</p>`
        : h``
      : h`<div class="call-list">${screen.rows.map((row) => filteredRow(row, screen.csrf))}</div>`;
  const body = h`
    <div class="calls glass-stage">
      <header class="page-head">
        <div>
          <p class="back"><a href="/calls">קריאות</a></p>
          <h1>מסוננות</h1>
          <p class="lede">מה שהמסווג הניח בצד, ומה שהמשרד החזיר.</p>
        </div>
      </header>
      ${refusal}
      ${filteredSegments(screen)}
      ${list}
    </div>`;
  return renderPage({
    title: 'מסוננות — דונה דום',
    styles,
    nav: screen.nav,
    body,
  });
}

function channelWarning(text: string): Html {
  return h`<p class="mailbox-warning" role="status">${text} <a href="/settings">הגדרות</a></p>`;
}

function secretNotice(notice: SecretNotice | null, today: string): Html {
  if (notice === null) return h``;
  if (notice.kind === 'unknown') {
    return channelWarning('תיבת הדואר: תאריך התפוגה של הסוד לא הוגדר.');
  }
  const [year, month, day] = notice.expires.split('-');
  const date = `${day}.${month}.${year}`;
  const state =
    notice.expires < today
      ? `תוקף הסוד של תיבת הדואר פג ב-${date}.`
      : `הסוד של תיבת הדואר בתוקף עד ${date}.`;
  return channelWarning(`${state} יש לבקש סוד חדש ממנהל Microsoft 365.`);
}
