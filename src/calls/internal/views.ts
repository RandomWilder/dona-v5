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
}

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
}

/** Mirrors channel's `SecretWarning`: channel imports calls, so calls cannot import it back. */
export type SecretNotice =
  | { kind: 'renew'; expires: string }
  | { kind: 'unknown' };

export interface FilteredScreen {
  nav: Html;
  csrf: string;
  rows: readonly FilteredRow[];
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
  documentTypes?: readonly { typeKey: string; labelHe: string }[];
  refusal?: string;
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
    gap: var(--space-2);
    margin: 0;
    padding-inline-start: 1.25rem;
  }
  .calls .back { margin: 0; }
  .calls .message { white-space: pre-wrap; overflow-wrap: anywhere; }
  .calls .file {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
</style>`;

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

function arrange(screen: CallsScreen): {
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

function callRow(call: ServiceCall, screen: CallsScreen): Html {
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
  const marked = call.emergency.flagged ? 'true' : 'false';
  const reviewing = call.toReview ? 'true' : 'false';
  const goal = goalChip(call, screen);
  return h`<article class="call" data-call="${call.id}" data-channel="${call.sourceChannel}" data-call-state="${call.state}" data-emergency="${marked}" data-review="${reviewing}">
    <p class="call-main"><a href="/calls/${call.id}">${call.description}</a></p>
    <p class="call-meta">
      <span class="chip">${CHANNEL_HE[call.sourceChannel]}</span>
      <span class="chip">${CALL_STATE_HE[call.state]}</span>
      ${category}
      ${proposal}
      ${emergency}
      ${review}
      <span>${sender}</span>
      <span>${ageLabel(call.openedAt, screen.now)}</span>
      ${goal}
    </p>
  </article>`;
}

function listHref(screen: CallsScreen, log: boolean): string {
  return callsHref({
    state: screen.state,
    category: screen.categoryId,
    emergency: screen.emergency ? '1' : null,
    review: screen.toReview ? '1' : null,
    goal: screen.band,
    log: log ? '1' : null,
  });
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
  const kept = { category: screen.categoryId, state: openState };
  const current = segmentNow(screen);
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
      href: callsHref(kept),
    },
    {
      id: 'emergency',
      label: 'חירום',
      count: screen.counts.emergency,
      href: callsHref({ ...kept, emergency: '1' }),
    },
    {
      id: 'late',
      label: 'לא בזמן',
      count: screen.counts.late,
      href: callsHref({ ...kept, goal: 'late' }),
    },
    {
      id: 'review',
      label: 'לבדיקה',
      count: screen.counts.toReview,
      href: callsHref({ ...kept, review: '1' }),
    },
    {
      id: 'closed',
      label: 'סגורות',
      count: null,
      href: callsHref({ category: screen.categoryId, state: 'CLOSED' }),
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
  return h`<div class="filters">
    <form method="get" action="/calls">
      ${hidden('state', screen.state)}
      ${hidden('emergency', emergency)}
      ${hidden('review', review)}
      ${hidden('goal', goal)}
      <label>קטגוריה ${categories}</label>
      <button class="btn" type="submit">סינון</button>
    </form>
    <form method="get" action="/calls">
      ${hidden('category', screen.categoryId)}
      ${hidden('emergency', emergency)}
      ${hidden('review', review)}
      ${hidden('goal', goal)}
      <label>מצב ${states}</label>
      <button class="btn" type="submit">סינון</button>
    </form>
  </div>`;
}

function callList(screen: CallsScreen): Html {
  const narrowed =
    screen.state !== null ||
    screen.categoryId !== null ||
    screen.emergency ||
    screen.toReview ||
    screen.band !== null;
  if (screen.calls.length === 0) {
    return h`<p class="lede">${narrowed ? 'אין קריאות תואמות.' : 'אין קריאות פתוחות.'}</p>`;
  }
  const groups = arrange(screen);
  if (groups === null) {
    return h`<div class="call-list">${screen.calls.map((call) => callRow(call, screen))}</div>`;
  }
  const urgent =
    groups.urgent.length === 0
      ? h``
      : h`<section class="group">
          <h2>דורש טיפול עכשיו</h2>
          <div class="call-list">${groups.urgent.map((call) => callRow(call, screen))}</div>
        </section>`;
  const rest =
    groups.rest.length === 0
      ? h``
      : h`<div class="call-list">${groups.rest.map((call) => callRow(call, screen))}</div>`;
  return h`${urgent}${rest}`;
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

export function renderCallsPage(screen: CallsScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const devLink = screen.devIntake
    ? h`<a href="/dev/intake">הודעת בדיקה</a>`
    : h``;
  const counts = screen.counts;
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
  const body = h`
    <div class="calls glass-stage">
      <header class="page-head">
        <div>
          <h1>קריאות</h1>
          <p class="summary">פתוחות ${ltr(counts.open)} · חירום ${ltr(counts.emergency)} · לא בזמן ${ltr(counts.late)} · לבדיקה ${ltr(counts.toReview)}</p>
          <p class="lede">טלפון או הגעה. בלי מסווג. <a href="/calls/filtered">מסוננות <span class="n">${ltr(screen.filteredCount)}</span></a> ${devLink}</p>
        </div>
        <a class="btn btn-primary" href="${listHref(screen, true)}">רישום קריאה</a>
      </header>
      ${mailbox}
      ${echoWarning}
      ${secret}
      <section class="stat-row" aria-label="סיכום">
        <div class="stat glass"><span class="stat-label">פתוחות</span><span class="stat-value">${ltr(counts.open)}</span></div>
        <div class="stat glass"><span class="stat-label">חירום</span><span class="stat-value">${ltr(counts.emergency)}</span></div>
        <div class="stat glass is-alert"><span class="stat-label">מעבר ליעד המענה</span><span class="stat-value">${ltr(counts.past)}</span><span class="stat-note">קרוב ליעד ${ltr(counts.near)}</span></div>
        <div class="stat glass"><span class="stat-label">לבדיקה</span><span class="stat-value">${ltr(counts.toReview)}</span></div>
      </section>
      <div class="toolbar">
        ${segments(screen)}
        ${menus(screen)}
      </div>
      <section class="glass sheet">
        ${callList(screen)}
      </section>
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
      : h` <span data-translation="yes">תרגום: ${message.bodyHe}</span>`;
  return h`<li data-kind="MESSAGE" data-echo="${echo}" data-message="${message.id}"><span class="message">${who} · ${subject}${message.body}${translation}</span>${files} · ${whenLabel(message.at)}</li>`;
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
      : h` · <span data-size="${String(file.byteSize)}">${String(file.byteSize)}</span>`;
  const callId = screen.call.id;
  const open = file.openable
    ? h` <a href="/calls/${callId}/messages/${messageId}/files/${String(file.index)}">פתיחה</a>`
    : h``;
  const filed =
    file.documentId === null
      ? fileForm(screen, messageId, file)
      : h` <a href="/documents/${file.documentId}/read" data-document="${file.documentId}">לא מתוייק</a>`;
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

function emergencyForm(screen: CallScreen): Html {
  const call = screen.call;
  const action = call.emergency.flagged ? 'clear' : 'flag';
  const label = call.emergency.flagged ? 'הסרת סימון חירום' : 'סימון חירום';
  return h`<section class="glass sheet">
    <h2>חירום</h2>
    <form method="post" action="/calls/${call.id}/emergency">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="action" value="${action}" />
      <button class="btn btn-primary" type="submit">${label}</button>
    </form>
  </section>`;
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
  return h`<section class="glass sheet">
    <h2>זיהוי הפונה</h2>
    <p class="lede">מקשר את הקריאה הזו בלבד. לא שומר איש קשר.</p>
    <form class="filters" method="get" action="/calls/${screen.call.id}">
      <label>שם
        <input name="q" type="text" value="${screen.query}" maxlength="80" autocomplete="off" />
      </label>
      <button class="btn" type="submit">חיפוש</button>
    </form>
    ${matches}
  </section>`;
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
  return h`<section class="glass sheet">
    <h2>שמירת איש קשר</h2>
    <p class="lede">ההודעה הבאה מהכתובת הזו תזוהה. הזיהוי עצמו לא שומר.</p>
    <form method="post" action="/calls/${screen.call.id}/contact">
      ${csrfInput(screen.csrf)}
      <button class="btn btn-primary" type="submit">שמירת איש קשר</button>
    </form>
  </section>`;
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
    return h`<section class="glass sheet"><h2>קטגוריה</h2>${held}<p class="lede">אין קטגוריה פעילה.</p></section>`;
  }
  return h`<section class="glass sheet">
    <h2>קטגוריה</h2>
    ${held}
    <form method="post" action="/calls/${screen.call.id}/category">
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
    </form>
  </section>`;
}

function exitForm(screen: CallScreen): Html {
  const matches =
    screen.dupQuery === ''
      ? h``
      : screen.dupMatches.length === 0
        ? h`<p class="lede">אין התאמה.</p>`
        : h`<fieldset class="choice">
            <legend>הקריאה שזו חוזרת עליה</legend>
            ${screen.dupMatches.map(
              (call) =>
                h`<label><input type="radio" name="duplicate_of" value="${call.id}" /> ${call.description}</label>`,
            )}
          </fieldset>`;
  return h`<section class="glass sheet">
    <h2>סגירה</h2>
    <form class="filters" method="get" action="/calls/${screen.call.id}">
      <label>חיפוש קריאה
        <input name="dup" type="text" value="${screen.dupQuery}" maxlength="80" autocomplete="off" />
      </label>
      <button class="btn" type="submit">חיפוש</button>
    </form>
    <form method="post" action="/calls/${screen.call.id}/exit">
      ${csrfInput(screen.csrf)}
      <fieldset class="choice">
        <legend>יציאה</legend>
        ${(Object.keys(EXIT_HE) as ExitKind[]).map(
          (kind, index) =>
            h`<label><input type="radio" name="exit" value="${kind}" ${index === 0 ? h`required` : h``} /> ${EXIT_HE[kind]}</label>`,
        )}
      </fieldset>
      <div class="field">
        <label for="exit-note">סיבה</label>
        <textarea id="exit-note" name="note" rows="3" maxlength="${NOTE_MAX}"></textarea>
      </div>
      <div class="field">
        <label for="exit-department">מחלקה</label>
        <input id="exit-department" name="department" type="text" maxlength="${DEPARTMENT_MAX}" autocomplete="off" />
      </div>
      ${matches}
      <button class="btn btn-primary" type="submit">סגירה</button>
    </form>
  </section>`;
}

function exitFacts(screen: CallScreen): Html {
  const exit = screen.call.exit;
  if (exit === null) return h``;
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
  return h`
    <div><dt>יציאה</dt><dd>${EXIT_HE[exit.kind]}</dd></div>
    ${note}
    ${department}
    ${other}`;
}

function returnForm(screen: CallScreen): Html {
  const call = screen.call;
  if (call.state === 'CLOSED') return h``;
  if (call.returned) {
    return h`<section class="glass sheet">
      <h2>מסוננות</h2>
      <p class="lede">הוחזרה. ${sorterLabel(call.sorterLabel)} <span data-office="returned">משרד: הוחזר</span>${call.returnedBy === null ? h`` : h` · ${call.returnedBy}`}</p>
      <form method="post" action="/calls/filtered">
        ${csrfInput(screen.csrf)}
        <input type="hidden" name="call_id" value="${call.id}" />
        <button class="btn btn-primary" type="submit">הצלה</button>
      </form>
    </section>`;
  }
  return h`<section class="glass sheet">
    <h2>לא קריאה</h2>
    <p class="lede">יוצאת מהרשימה בלי להיסגר. הסימון של המסווג נשאר.</p>
    <form method="post" action="/calls/${call.id}/return">
      ${csrfInput(screen.csrf)}
      <button class="btn" type="submit">החזרה למסוננות</button>
    </form>
  </section>`;
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
  const requester = call.requester?.name ?? 'טרם זוהה';
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
  const step =
    call.state === 'NEW'
      ? identifyForm(screen)
      : call.state === 'IDENTIFIED' || call.state === 'TRIAGED'
        ? categoryForm(screen)
        : h``;
  const saving = saveContactForm(screen);
  const closing =
    canExit(call.state) && !call.returned ? exitForm(screen) : h``;
  const body = h`
    <div class="calls glass-stage" data-call-state="${call.state}">
      <header class="page-head">
        <div>
          <p class="back"><a href="/calls">קריאות</a></p>
          <h1>${call.description}</h1>
        </div>
      </header>
      ${refusal}
      <section class="glass sheet">
        <dl class="facts">
          <div><dt>ערוץ</dt><dd>${CHANNEL_HE[call.sourceChannel]}</dd></div>
          <div><dt>מצב</dt><dd>${CALL_STATE_HE[call.state]}</dd></div>
          <div><dt>נרשם</dt><dd>${sender}</dd></div>
          <div><dt>פונה</dt><dd>${requester}</dd></div>
          <div><dt>קטגוריה</dt><dd>${category}</dd></div>
          ${proposal}
          ${summary}
          ${sorted}
          ${review}
          ${earlier}
          ${ageFact(screen)}
          <div><dt>חירום</dt><dd data-emergency="${call.emergency.flagged ? 'true' : 'false'}">${emergencyLabel(call)}</dd></div>
          ${exitFacts(screen)}
        </dl>
      </section>
      <section class="glass sheet">
        <h2>מהלך</h2>
        <ol class="timeline">${timelineOf(screen)}</ol>
      </section>
      ${repeatedBy(screen)}
      ${emergencyForm(screen)}
      ${step}
      ${saving}
      ${closing}
      ${returnForm(screen)}
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
  return h`<article class="call" data-filtered="${row.kind}" data-filtered-id="${row.id}">
    <p class="call-main">${title}</p>
    <p class="message">${row.body}${translation}</p>
    <p class="call-meta">
      ${sorterLabel(row.sorterLabel)}
      ${office}
      <span>${row.sender}</span>
    </p>
    <form method="post" action="/calls/filtered">
      ${csrfInput(csrf)}
      ${hidden}
      <button class="btn btn-primary" type="submit">הצלה</button>
    </form>
  </article>`;
}

export function renderFilteredPage(screen: FilteredScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const list =
    screen.rows.length === 0
      ? h`<p class="lede">אין הודעות מסוננות.</p>`
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
      <section class="glass sheet">
        ${list}
      </section>
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
