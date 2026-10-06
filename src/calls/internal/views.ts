// The קריאות screen. #182.
//
// Server-rendered, no client JavaScript. The form is the manual entry for a phone
// call or a walk-in. The list is the open calls. The rail count is the length of
// that list, passed in by the route so the number beside קריאות is the number of rows.
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import {
  type CallState,
  DESCRIPTION_MAX,
  SENDER_MAX,
  type ServiceCall,
  type SourceChannel,
} from './commands.ts';

export interface CallsScreen {
  nav: Html;
  csrf: string;
  calls: readonly ServiceCall[];
  now: Date;
  refusal?: string;
}

const CHANNEL_HE: Record<SourceChannel, string> = {
  PHONE: 'טלפון',
  WALK_IN: 'הגעה',
  WHATSAPP: 'וואטסאפ',
  EMAIL: 'דוא״ל',
};

const STATE_HE: Partial<Record<CallState, string>> = {
  NEW: 'חדשה',
};

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
  .calls .choice {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    border: 0;
    margin: 0;
    padding: 0;
  }
  .calls .choice legend { padding: 0; }
  .calls .choice label { display: inline-flex; gap: var(--space-2); align-items: center; }
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

function callRow(call: ServiceCall, now: Date): Html {
  const sender = call.sender.kind === 'unknown' ? 'לא ידוע' : call.sender.name;
  return h`<article class="call" data-call="${call.id}" data-channel="${call.sourceChannel}">
    <p class="call-main">${call.description}</p>
    <p class="call-meta">
      <span class="chip">${CHANNEL_HE[call.sourceChannel]}</span>
      <span class="chip">${STATE_HE[call.state] ?? call.state}</span>
      <span>${sender}</span>
      <span>${ageLabel(call.openedAt, now)}</span>
    </p>
  </article>`;
}

export function renderCallsPage(screen: CallsScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const list =
    screen.calls.length === 0
      ? h`<p class="lede">אין קריאות פתוחות.</p>`
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
          <label><input type="radio" name="channel" value="PHONE" required /> טלפון</label>
          <label><input type="radio" name="channel" value="WALK_IN" /> הגעה</label>
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
