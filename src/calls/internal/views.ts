// The קריאות screens. #182 is the list and the manual entry. #183 is one call:
// its timeline, identifying the requester, and setting the trade.
//
// Server-rendered, no client JavaScript. The rail count is the open-call count
// for the whole office, passed in by the route, so a filter does not shrink it.
import { DEFAULT_ZONE } from '../../kernel/clock.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import {
  CALL_STATES,
  type CallState,
  type CallTransition,
  type CategoryRow,
  DESCRIPTION_MAX,
  MANUAL_CHANNELS,
  SENDER_MAX,
  type ServiceCall,
  type ServiceCallDetail,
  type SourceChannel,
} from './commands.ts';

export interface CallsScreen {
  nav: Html;
  csrf: string;
  calls: readonly ServiceCall[];
  categories: readonly CategoryRow[];
  state: CallState | null;
  categoryId: string | null;
  now: Date;
  refusal?: string;
}

export interface CallScreen {
  nav: Html;
  csrf: string;
  call: ServiceCallDetail;
  categories: readonly CategoryRow[];
  matches: readonly { id: string; name: string }[];
  query: string;
  now: Date;
  refusal?: string;
}

const CHANNEL_HE: Record<SourceChannel, string> = {
  PHONE: 'טלפון',
  WALK_IN: 'הגעה',
  WHATSAPP: 'וואטסאפ',
  EMAIL: 'דוא״ל',
};

const STATE_HE: Record<CallState, string> = {
  NEW: 'חדשה',
  IDENTIFIED: 'זוהתה',
  TRIAGED: 'מוינה',
  RESPONSIBILITY_SET: 'אחריות נקבעה',
  WINDOWS_COLLECTED: 'חלונות נאספו',
  OFFERED: 'הוצעה',
  SCHEDULED: 'נקבעה',
  CLOSED: 'סגורה',
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
  .calls .refusal { margin: 0; color: var(--color-alert); }
  .calls .call {
    display: grid;
    gap: var(--space-2);
    padding-block: var(--space-3);
    border-block-end: var(--size-hairline) solid var(--color-divider-soft);
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
    gap: var(--space-2);
    margin: 0;
    padding-inline-start: 1.25rem;
  }
  .calls .back { margin: 0; }
</style>`;

function ageLabel(openedAt: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - openedAt.getTime()) / 60_000),
  );
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

function callRow(call: ServiceCall, now: Date): Html {
  const sender =
    call.requester?.name ??
    (call.sender.kind === 'unknown' ? 'לא ידוע' : call.sender.name);
  const category =
    call.category === null
      ? h``
      : h`<span class="chip">${call.category.labelHe}</span>`;
  return h`<article class="call" data-call="${call.id}" data-channel="${call.sourceChannel}" data-call-state="${call.state}">
    <p class="call-main"><a href="/calls/${call.id}">${call.description}</a></p>
    <p class="call-meta">
      <span class="chip">${CHANNEL_HE[call.sourceChannel]}</span>
      <span class="chip">${STATE_HE[call.state]}</span>
      ${category}
      <span>${sender}</span>
      <span>${ageLabel(call.openedAt, now)}</span>
    </p>
  </article>`;
}

function filters(screen: CallsScreen): Html {
  return h`<form class="filters" method="get" action="/calls">
    <label>מצב
      <select name="state">
        <option value="" ${selected(screen.state === null)}>הכל</option>
        ${FILTER_STATES.map(
          (state) =>
            h`<option value="${state}" ${selected(screen.state === state)}>${STATE_HE[state]}</option>`,
        )}
      </select>
    </label>
    <label>קטגוריה
      <select name="category">
        <option value="" ${selected(screen.categoryId === null)}>הכל</option>
        ${screen.categories.map(
          (category) =>
            h`<option value="${category.id}" ${selected(screen.categoryId === category.id)}>${category.labelHe}${category.isActive ? h`` : h` (לא פעיל)`}</option>`,
        )}
      </select>
    </label>
    <button class="btn" type="submit">סינון</button>
  </form>`;
}

export function renderCallsPage(screen: CallsScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const filtered = screen.state !== null || screen.categoryId !== null;
  const list =
    screen.calls.length === 0
      ? h`<p class="lede">${filtered ? 'אין קריאות תואמות.' : 'אין קריאות פתוחות.'}</p>`
      : h`<div class="call-list">${screen.calls.map((call) => callRow(call, screen.now))}</div>`;
  const body = h`
    <div class="calls glass-stage">
      <header class="page-head">
        <div>
          <h1>קריאות</h1>
          <p class="lede">טלפון או הגעה. בלי מסווג.</p>
        </div>
      </header>
      <form class="glass call-form" method="post" action="/calls">
        ${csrfInput(screen.csrf)}
        <h2>רישום קריאה</h2>
        ${refusal}
        <fieldset class="choice">
          <legend>ערוץ</legend>
          ${MANUAL_CHANNELS.map(
            (channel, index) =>
              h`<label><input type="radio" name="channel" value="${channel}" ${index === 0 ? h`required` : h``} /> ${CHANNEL_HE[channel]}</label>`,
          )}
        </fieldset>
        <div class="field">
          <label for="call-description">תיאור</label>
          <textarea id="call-description" name="description" rows="3" maxlength="${DESCRIPTION_MAX}" required></textarea>
        </div>
        <fieldset class="choice">
          <legend>פונה</legend>
          <label><input type="radio" name="sender" value="named" required /> שם</label>
          <input name="sender_name" type="text" maxlength="${SENDER_MAX}" autocomplete="off" aria-label="שם הפונה" />
          <label><input type="radio" name="sender" value="unknown" /> לא ידוע</label>
        </fieldset>
        <button class="btn btn-primary" type="submit">רישום</button>
      </form>
      <section class="glass sheet">
        <h2>פתוחות</h2>
        ${filters(screen)}
        ${list}
      </section>
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
  if (event.kind === 'OPENED') {
    return h`<li data-kind="OPENED">נפתחה · ${event.actorLabel} · ${when}</li>`;
  }
  if (event.kind === 'IDENTIFIED') {
    return h`<li data-kind="IDENTIFIED">זוהתה · ${event.partyName} · ${event.actorLabel} · ${when}</li>`;
  }
  return h`<li data-kind="TRIAGED">קטגוריה ${event.categoryLabel} · ${event.actorLabel} · ${when}</li>`;
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

export function renderCallPage(screen: CallScreen): string {
  const call = screen.call;
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const requester = call.requester?.name ?? 'טרם זוהה';
  const category = call.category?.labelHe ?? 'טרם נבחרה';
  const sender = call.sender.kind === 'unknown' ? 'לא ידוע' : call.sender.name;
  const action =
    call.state === 'NEW' ? identifyForm(screen) : categoryForm(screen);
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
          <div><dt>מצב</dt><dd>${STATE_HE[call.state]}</dd></div>
          <div><dt>נרשם</dt><dd>${sender}</dd></div>
          <div><dt>פונה</dt><dd>${requester}</dd></div>
          <div><dt>קטגוריה</dt><dd>${category}</dd></div>
          <div><dt>גיל</dt><dd>${ageLabel(call.openedAt, screen.now)}</dd></div>
        </dl>
      </section>
      <section class="glass sheet">
        <h2>מהלך</h2>
        <ol class="timeline">${call.timeline.map(eventLine)}</ol>
      </section>
      ${action}
    </div>`;
  return renderPage({
    title: 'קריאה — דונה דום',
    styles,
    nav: screen.nav,
    body,
  });
}
