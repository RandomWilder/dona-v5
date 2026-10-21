// The tenant portal's pages. Strings come from the copy rows. Colour, type and side live in
// portal.css. Three scripts, each named in SPEC.md: the code form submits on the
// sixth digit, the passkey pages call WebAuthn, and every page registers the
// service worker. Without the first two, the button that does not need a
// ceremony still posts. Without the worker, the page still loads.

import type { CodeChannel } from '../../channel/contract.ts';
import { Html, h } from '../../kernel/ui/html.ts';
import { type IconName, icon } from '../../kernel/ui/icons.ts';
import { csrfInput } from '../../kernel/ui/page.ts';
import type {
  CallCard,
  TenantStatus,
  ThreadDay,
  VisitCard,
} from './call-screen.ts';
import { isClosedStatus } from './call-screen.ts';
import {
  currentPortalLanguage,
  portalDir,
  portalLanguages,
  portalText,
} from './copy.ts';
import { nationalDisplay } from './phone.ts';

function page(title: string, body: Html): string {
  const language = currentPortalLanguage();
  return `<!doctype html>
${h`<html lang="${language}" dir="${portalDir(language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/ui/icons/portal-icon-192.png" />
    <link rel="apple-touch-icon" href="/ui/icons/portal-icon-180.png" />
    <meta name="theme-color" content="rgb(44, 69, 93)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${portalText('install.short')}" />
    <link rel="stylesheet" href="/ui/tokens.css" />
    <link rel="stylesheet" href="/ui/portal.css" />
    <script>
      /* dona.portal.install */
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    </script>
  </head>
  <body class="portal">${body}</body>
</html>`}`;
}

function notice(key: string | null): Html {
  if (key === null) return h``;
  return h`<p class="tp-notice" role="alert">${portalText(key)}</p>`;
}

function languageLabel(): string {
  return portalLanguages()
    .map((language) => portalText('lang.word', language))
    .join(' · ');
}

function languageTitle(): Html {
  const parts = portalLanguages().map(
    (language) =>
      h`<bdi lang="${language}" dir="${portalDir(language)}">${portalText('lang.word', language)}</bdi>`,
  );
  return parts.reduce(
    (title, part, index) => (index === 0 ? part : h`${title} · ${part}`),
    h``,
  );
}

function languageSheet(csrf: string, next: string, row: boolean): Html {
  const current = currentPortalLanguage();
  const opener = row
    ? h`<label for="tp-lang" class="tp-menu-row">${portalText('sign_in.language')}</label>`
    : h`<label for="tp-lang" class="tp-icon-btn is-globe">${icon('globe', { class: 'tp-i i22' })}<span class="tp-sr">${languageLabel()}</span></label>`;
  const choices = portalLanguages().map((language) => {
    const on = language === current;
    return h`<form method="post" action="/language">
      ${csrfInput(csrf)}
      <input type="hidden" name="language" value="${language}" />
      <input type="hidden" name="next" value="${next}" />
      <button class="tp-lang-row" type="submit" lang="${language}" dir="${portalDir(language)}">
        <span class="tp-lang-name">${portalText('lang.name', language)}${on ? h`` : h`<small>${portalText('lang.hint', language)}</small>`}</span>
        ${on ? icon('check', { class: 'tp-i' }) : h``}
      </button>
    </form>`;
  });
  return h`<div class="tp-lang${row ? ' is-row' : ''}">
    <input id="tp-lang" class="tp-lang-toggle" type="checkbox" aria-label="${languageLabel()}" />
    ${opener}
    <div class="tp-sheet-layer">
      <label for="tp-lang" class="tp-scrim-close"><span class="tp-sr">${portalText('ask.close')}</span></label>
      <div class="tp-sheet" role="dialog" aria-labelledby="tp-lang-title">
        <span class="tp-grabber" aria-hidden="true"></span>
        <h2 id="tp-lang-title" class="tp-sheet-title">${languageTitle()}</h2>
        <div class="tp-list">${choices}</div>
      </div>
    </div>
  </div>`;
}

export function renderPhonePage(screen: {
  csrf: string;
  notice: string | null;
  caption: string;
  canSend: boolean;
  options: unknown;
}): string {
  return page(
    portalText('sign_in.page'),
    h`<div class="tp-body is-auth">
      <div class="tp-auth-top">
        <span class="tp-brand"><span class="tp-brand-mark">${portalText('brand.mark')}</span>${portalText('brand')}</span>
        ${languageSheet(screen.csrf, '/', false)}
      </div>
      <div class="tp-stack tp-auth-head">
        <h1 class="tp-display">${portalText('sign_in.title')}</h1>
        <p class="tp-lede">${portalText('sign_in.lede')}</p>
      </div>
      ${notice(screen.notice)}
      ${
        screen.canSend
          ? h`<form method="post" action="/sign-in">
        ${csrfInput(screen.csrf)}
        <label class="tp-label" for="phone">${portalText('sign_in.phone')}</label>
        <div class="tp-phone" dir="ltr">
          <span class="tp-prefix">${portalText('sign_in.prefix')}</span>
          <span class="tp-divider" aria-hidden="true"></span>
          <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="${portalText('sign_in.placeholder')}" required />
        </div>
        <div class="tp-stack tp-auth-actions">
          <button class="tp-primary" type="submit">${portalText('sign_in.submit')}</button>
          <p class="tp-caption">${portalText(screen.caption)}</p>
          <button class="tp-text-btn" type="button" data-portal-passkey="get">${portalText('sign_in.passkey')}</button>
        </div>
      </form>`
          : h`<div class="tp-stack">
        <p class="tp-caption">${portalText(screen.caption)}</p>
        <input type="hidden" name="csrf" value="${screen.csrf}" />
        <button class="tp-text-btn" type="button" data-portal-passkey="get">${portalText('sign_in.passkey')}</button>
      </div>`
      }
      <p class="tp-notice" role="alert" data-portal-passkey-error hidden>${portalText('passkey.failed')}</p>
      ${passkeyOptions(screen.options)}
      ${passkeyScript()}
    </div>`,
  );
}

function waitLabel(seconds: number): string {
  const left = Math.max(0, seconds);
  const minutes = Math.floor(left / 60);
  const rest = left % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function fallbackCard(screen: {
  csrf: string;
  alternate: CodeChannel | null;
}): Html {
  if (screen.alternate === null) return h``;
  const toSms = screen.alternate === 'sms';
  return h`<form class="tp-card is-row tp-fallback" method="post" action="/sign-in/code/send">
    ${csrfInput(screen.csrf)}
    <input type="hidden" name="channel" value="${screen.alternate}" />
    <span class="tp-well is-40">${icon(toSms ? 'message-square' : 'message-circle', { class: 'tp-i i18' })}</span>
    <span class="tp-row-text">
      <b class="tp-row-title">${portalText(toSms ? 'code.fallback_to_sms_title' : 'code.fallback_to_wa_title')}</b>
      <span class="tp-meta">${portalText(toSms ? 'code.fallback_to_sms_body' : 'code.fallback_to_wa_body')}</span>
    </span>
    <button class="tp-link" type="submit">${portalText(toSms ? 'code.fallback_to_sms' : 'code.fallback_to_wa')}</button>
  </form>`;
}

export function renderCodePage(screen: {
  csrf: string;
  phone: string;
  channel: CodeChannel;
  alternate: CodeChannel | null;
  waitSeconds: number;
  notice: string | null;
}): string {
  const waiting = screen.waitSeconds > 0;
  const again = waiting
    ? h`<p class="tp-timer">${icon('clock', { class: 'tp-i i16' })}${portalText('code.wait')} <span dir="ltr">${waitLabel(screen.waitSeconds)}</span></p>`
    : h`<form method="post" action="/sign-in/code/send">
        ${csrfInput(screen.csrf)}
        <button class="tp-text-btn" type="submit">${portalText('code.resend')}</button>
      </form>`;
  return page(
    portalText('code.page'),
    h`<div class="tp-body is-auth">
      <div class="tp-auth-top">
        <a class="tp-icon-btn tp-back" href="/" aria-label="${portalText('code.back')}">${icon('chevron-right', { class: 'tp-i i18' })}</a>
        ${languageSheet(screen.csrf, '/sign-in/code', false)}
      </div>
      <div class="tp-stack">
        <h1 class="tp-display">${portalText('code.title')}</h1>
        <p class="tp-lede">${portalText(screen.channel === 'sms' ? 'code.sent_sms' : 'code.sent')} <b dir="ltr">${nationalDisplay(screen.phone)}</b> · <a class="tp-link" href="/">${portalText('code.change')}</a></p>
      </div>
      ${notice(screen.notice)}
      <form method="post" action="/sign-in/code" data-portal-code="true">
        ${csrfInput(screen.csrf)}
        <label class="tp-sr" for="portal-code">${portalText('code.label')}</label>
        <div class="tp-otp" dir="ltr">
          <span></span><span></span><span></span><span></span><span></span><span></span>
          <input id="portal-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-label="${portalText('code.label')}" />
        </div>
        <button class="tp-primary" type="submit" data-portal-submit="true">${portalText('code.submit')}</button>
      </form>
      ${again}
      ${screen.waitSeconds > 0 ? h`` : fallbackCard(screen)}
      <script>
        /* dona.portal.code */
        document.querySelectorAll('[data-portal-code]').forEach((form) => {
          const input = form.querySelector('input[name="code"]');
          const button = form.querySelector('[data-portal-submit]');
          if (!input || !button || typeof form.requestSubmit !== 'function') return;
          button.hidden = true;
          let sent = false;
          input.addEventListener('input', () => {
            const digits = input.value.replace(/\\D/g, '').slice(0, 6);
            if (input.value !== digits) input.value = digits;
            if (digits.length === 6 && !sent) {
              sent = true;
              form.requestSubmit();
            }
          });
        });
      </script>
    </div>`,
  );
}

export interface PortalChoice {
  id: string;
  label: string;
  city: string;
}

function monthsLeft(months: number): Html {
  if (months <= 0) return h`${portalText('flat.under_month')}`;
  if (months === 1) return h`${portalText('flat.one_month')}`;
  if (months === 2) return h`${portalText('flat.two_months')}`;
  const form = new Intl.PluralRules(currentPortalLanguage()).select(months);
  const word =
    form === 'one'
      ? portalText('flat.months_one')
      : form === 'few'
        ? portalText('flat.months_few')
        : portalText('flat.months');
  const number = h`<span dir="ltr">${String(months)}</span>`;
  const left = portalText('flat.months_left');
  return left === '' ? h`${number} ${word}` : h`${left} ${number} ${word}`;
}

function pill(
  choices: readonly PortalChoice[],
  chosenId: string,
  csrf: string,
  next: string,
): Html {
  const chosen = choices.find((item) => item.id === chosenId) ?? choices[0];
  if (chosen === undefined) return h``;
  if (choices.length < 2) {
    return h`<p class="tp-pill">${icon('house', { class: 'tp-i i16' })}<span data-current>${chosen.label}</span></p>`;
  }
  return h`<div class="tp-choice">
    <input id="tp-tenancy" class="tp-choice-toggle" type="checkbox" />
    <label for="tp-tenancy" class="tp-pill">${icon('house', { class: 'tp-i i16' })}<span class="tp-sr">${portalText('flat.sheet_title')}</span><span data-current>${chosen.label}</span>${icon('chevron', { class: 'tp-i i16' })}</label>
    <div class="tp-sheet-layer">
      <label for="tp-tenancy" class="tp-scrim-close"><span class="tp-sr">${portalText('ask.close')}</span></label>
      <div class="tp-sheet" role="dialog" aria-labelledby="tp-tenancy-title">
        <span class="tp-grabber" aria-hidden="true"></span>
        <h2 id="tp-tenancy-title" class="tp-sheet-title">${portalText('flat.sheet_title')}</h2>
        <p class="tp-sheet-help">${portalText(choices.length === 2 ? 'flat.sheet_help' : 'flat.sheet_help_many')}</p>
        <form class="tp-picks" method="post" action="/tenancy">
          ${csrfInput(csrf)}
          <input type="hidden" name="next" value="${next}" />
          ${choices.map(
            (item) =>
              h`<button class="tp-pick${item.id === chosen.id ? ' is-chosen' : ''}" type="submit" name="tenancy" value="${item.id}">
                <span class="tp-row-title">${item.label}</span>
                <span class="tp-meta">${item.city}</span>
              </button>`,
          )}
        </form>
      </div>
    </div>
  </div>`;
}

function tabBar(current: 'home' | 'calls' | 'flat', flatHref: string): Html {
  const tab = (
    href: string,
    key: string,
    name: 'house' | 'message-square' | 'building' | 'ellipsis',
    on: boolean,
  ): Html =>
    h`<a href="${href}"${on ? h` aria-current="page" class="is-active"` : h``}>${icon(name, { class: 'tp-i i22' })}${portalText(key)}</a>`;
  return h`<nav class="tp-tabs" aria-label="${portalText('nav.label')}">
    ${tab('/', 'nav.home', 'house', current === 'home')}
    ${tab('/calls', 'nav.calls', 'message-square', current === 'calls')}
    <a class="tp-fab" href="/report"><span class="tp-fab-btn">${icon('plus', { class: 'tp-i i24' })}</span>${portalText('nav.report')}</a>
    ${tab(flatHref, 'nav.flat', 'building', current === 'flat')}
    ${tab('/more', 'nav.more', 'ellipsis', false)}
  </nav>`;
}

function documentList(
  documents: readonly { href: string; name: string; kind: string }[],
): Html {
  if (documents.length === 0) return h``;
  return h`<div class="tp-list">${documents.map(
    (doc) =>
      h`<a class="tp-row tp-doc" href="${doc.href}"><span class="tp-well">${icon('file', { class: 'tp-i i18' })}</span><span class="tp-row-text"><span class="tp-row-title">${doc.name}</span><span class="tp-meta">${doc.kind}</span></span>${icon('download', { class: 'tp-i tp-dl', label: portalText('papers.download') })}</a>`,
  )}</div>`;
}

function shell(title: string, body: Html, bar: Html): string {
  return page(title, h`<div class="tp-shell">${body}${bar}</div>`);
}

function statusChip(status: TenantStatus): Html {
  return h`<span class="tp-chip" data-status="${status}">${portalText(`calls.status.${status}`)}</span>`;
}

function callMeta(card: CallCard): Html {
  const tail =
    card.visitOn === null
      ? h`${card.channel}`
      : h`${portalText('calls.visit_on')}<span dir="ltr">${card.visitOn}</span>`;
  return h`<span class="tp-meta tp-ellipsis">${card.category} · <span dir="ltr">${card.opened}</span> · ${tail}</span>`;
}

function stepOf(status: TenantStatus): number {
  if (status === 'received') return 1;
  if (status === 'handling' || status === 'waiting') return 2;
  if (status === 'visit') return 3;
  return 4;
}

function progress(status: TenantStatus): Html {
  if (status === 'waiting') {
    return h`<span class="tp-wait-line">${portalText('calls.waiting')}</span>`;
  }
  const step = String(stepOf(status));
  const closed = isClosedStatus(status) ? ' is-closed' : '';
  return h`<span class="tp-progress${closed}" data-step="${step}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

function callLink(card: CallCard, boxed: boolean): Html {
  const note =
    card.note === null
      ? h``
      : h`<span class="tp-call-note">${portalText('calls.office_note')} ${card.note}</span>`;
  if (!boxed) {
    return h`<a class="tp-row" href="${card.href}"><span class="tp-row-text"><span class="tp-row-title">${card.title}</span>${callMeta(card)}</span>${statusChip(card.status)}</a>`;
  }
  const waiting = card.status === 'waiting' ? ' is-waiting' : '';
  return h`<a class="tp-card tp-call${waiting}" href="${card.href}">
    <span class="tp-call-head"><span class="tp-call-text"><span class="tp-call-title">${card.title}</span>${callMeta(card)}${note}</span>${statusChip(card.status)}</span>
    ${progress(card.status)}
  </a>`;
}

function visitHero(visit: VisitCard): Html {
  return h`<a class="tp-hero" href="${visit.href}">
    <span class="tp-hero-top"><span class="tp-kicker">${portalText('calls.next_visit')}</span>${statusChip('visit')}</span>
    <span class="tp-hero-title">${visit.title}</span>
    <span class="tp-hero-when">${icon('calendar', { class: 'tp-i i18' })}${visit.weekday} · <span dir="ltr">${visit.date}</span> · <span dir="ltr">${visit.from}–${visit.to}</span></span>
  </a>`;
}

function stepper(status: TenantStatus): Html {
  const keys = [
    'calls.status.received',
    'calls.status.handling',
    'calls.status.visit',
    'calls.status.done',
  ] as const;
  const step = stepOf(status);
  const current = step === 4 ? null : step - 1;
  return h`<ol class="tp-stepper" aria-label="${portalText('calls.stepper')}">${keys.map(
    (key, index) => {
      const done = current === null || index < current;
      const here = current === index;
      const mark = done ? icon('check', { class: 'tp-i i14' }) : h``;
      return h`<li class="${done ? 'is-done' : here ? 'is-current' : ''}"${here ? h` aria-current="step"` : h``}><span class="tp-dot">${mark}</span>${portalText(key)}</li>`;
    },
  )}</ol>`;
}

function dayLabel(day: ThreadDay): Html {
  const name = day.label === 'today' ? portalText('calls.today') : day.weekday;
  return h`${name} · <span dir="ltr">${day.date}</span>`;
}

export function renderHomePage(screen: {
  csrf: string;
  greeting: string;
  choices: readonly PortalChoice[];
  chosenId: string;
  openCount: number;
  calls: readonly CallCard[];
  visit: VisitCard | null;
}): string {
  const flatHref = `/flat/${screen.chosenId}`;
  const rows =
    screen.calls.length === 0
      ? h`<p class="tp-meta">${portalText('calls.empty_open')}</p>`
      : h`<div class="tp-list">${screen.calls.map((card) => callLink(card, false))}</div>`;
  return shell(
    portalText('home.page'),
    h`<div class="tp-body">
      <div class="tp-head">${pill(screen.choices, screen.chosenId, screen.csrf, '/')}${languageSheet(screen.csrf, '/', false)}</div>
      <h1 class="tp-page-title">${screen.greeting}</h1>
      ${screen.visit === null ? h`` : visitHero(screen.visit)}
      <div class="tp-stack-10">
        <div class="tp-section-row">
          <h2 class="tp-section">${portalText('calls.open_home')} · <span dir="ltr">${String(screen.openCount)}</span></h2>
          <a class="tp-link" href="/calls">${portalText('calls.all')}</a>
        </div>
        ${rows}
      </div>
      <div class="tp-shortcuts">
        <a class="tp-shortcut" href="/ask"><span class="tp-well">${icon('message-circle', { class: 'tp-i i18' })}</span>${portalText('home.ask')}</a>
        <a class="tp-shortcut" href="${flatHref}#documents"><span class="tp-well">${icon('file', { class: 'tp-i i18' })}</span>${portalText('home.papers')}</a>
      </div>
    </div>`,
    tabBar('home', flatHref),
  );
}

export function renderFlatPage(screen: {
  csrf: string;
  choices: readonly PortalChoice[];
  chosenId: string;
  address: string;
  city: string;
  start: string;
  end: string;
  months: number;
  percent: number;
  parking: string;
  storage: string;
  documents: readonly { href: string; name: string; kind: string }[];
}): string {
  return shell(
    portalText('flat.page'),
    h`<div class="tp-body">
      <div class="tp-head">
        <h1 class="tp-page-title">${portalText('flat.title')}</h1>
        ${pill(screen.choices, screen.chosenId, screen.csrf, '/flat')}
      </div>
      <article class="tp-card">
        <h2 class="tp-flat-title">${screen.address}</h2>
        <p class="tp-meta">${screen.city}</p>
        <div class="tp-lease">
          <div class="tp-lease-row">
            <span dir="ltr">${screen.start}</span>
            <b>${monthsLeft(screen.months)}</b>
            <span dir="ltr">${screen.end}</span>
          </div>
          <div class="tp-track" role="progressbar" aria-label="${portalText('flat.progress')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${String(screen.percent)}"><i style="inline-size: ${String(screen.percent)}%"></i></div>
        </div>
        <dl class="tp-facts">
          <div><dt>${portalText('flat.parking')}</dt><dd>${screen.parking}</dd></div>
          <div><dt>${portalText('flat.storage')}</dt><dd>${screen.storage}</dd></div>
        </dl>
      </article>
      <h2 class="tp-section" id="documents">${portalText('flat.documents')}</h2>
      ${documentList(screen.documents)}
    </div>`,
    tabBar('flat', `/flat/${screen.chosenId}`),
  );
}

export function renderPortalCallsPage(screen: {
  csrf: string;
  choices: readonly PortalChoice[];
  chosenId: string;
  closed: boolean;
  openCount: number;
  closedCount: number;
  calls: readonly CallCard[];
}): string {
  const flatHref = `/flat/${screen.chosenId}`;
  const tab = (href: string, key: string, count: number, on: boolean): Html =>
    h`<a href="${href}"${on ? h` aria-current="page"` : h``}>${portalText(key)} · <span dir="ltr">${String(count)}</span></a>`;
  const list =
    screen.calls.length === 0
      ? h`<p class="tp-meta">${portalText(screen.closed ? 'calls.empty_closed' : 'calls.empty_open')}</p>`
      : h`<div class="tp-calls">${screen.calls.map((card) => callLink(card, true))}</div>`;
  return shell(
    portalText('calls.page'),
    h`<div class="tp-body">
      <div class="tp-head">
        <h1 class="tp-page-title">${portalText('calls.title')}</h1>
        ${pill(screen.choices, screen.chosenId, screen.csrf, '/calls')}
      </div>
      <div class="tp-seg">
        ${tab('/calls', 'calls.open', screen.openCount, !screen.closed)}
        ${tab('/calls?closed=1', 'calls.closed', screen.closedCount, screen.closed)}
      </div>
      ${list}
    </div>`,
    tabBar('calls', flatHref),
  );
}

export function renderPortalCallPage(screen: {
  title: string;
  number: string;
  category: string;
  opened: string;
  status: TenantStatus;
  visit: VisitCard | null;
  days: readonly ThreadDay[];
  callId: string;
  note: string | null;
  notice: string | null;
  csrf: string;
  /** Set on an open call. A closed call has none, and shows the continuation. */
  followKey: string | null;
}): string {
  const closed = isClosedStatus(screen.status);
  const visit =
    screen.visit === null
      ? h``
      : h`<div class="tp-strip">
          <span class="tp-datetile"><small>${screen.visit.weekdayShort}</small><b dir="ltr">${screen.visit.date}</b></span>
          <span class="tp-visit-text"><b>${portalText('calls.visit_name')}</b><span>${screen.visit.weekday} · <span dir="ltr">${screen.visit.from}–${screen.visit.to}</span></span></span>
        </div>`;
  const days = screen.days.map(
    (day) => h`<p class="tp-day">${dayLabel(day)}</p>
      <div class="tp-thread">${day.bubbles.map((bubble) =>
        bubble.side === 'office'
          ? h`<div class="tp-msg is-office"><span class="tp-who">${portalText('calls.office')}</span><p class="tp-bubble">${bubble.body}<span class="tp-time"><span dir="ltr">${bubble.time}</span></span></p></div>`
          : h`<div class="tp-msg is-tenant"><p class="tp-bubble">${bubble.body}<span class="tp-time"><span dir="ltr">${bubble.time}</span></span></p></div>`,
      )}</div>`,
  );
  const note =
    screen.note === null
      ? h``
      : h`<p class="tp-call-note">${portalText('calls.office_note')} ${screen.note}</p>`;
  const foot =
    screen.followKey === null
      ? h`<div class="tp-dock">
          <p class="tp-caption">${portalText('calls.closed_caption')}</p>
          <a class="tp-primary" href="/report?from=${screen.callId}">${portalText('calls.continue')}</a>
        </div>`
      : h`<form class="tp-composer" method="post" action="/calls/${screen.callId}/follow-up" enctype="multipart/form-data">
          ${csrfInput(screen.csrf)}
          <input type="hidden" name="key" value="${screen.followKey}" />
          <label class="tp-cam">${icon('camera', { class: 'tp-i i22' })}<input class="tp-sr" type="file" name="file" accept="image/*,video/*,.pdf" aria-label="${portalText('calls.follow_photo')}" /></label>
          <input type="text" name="body" required maxlength="4000" aria-label="${portalText('calls.follow_label')}" placeholder="${portalText('calls.follow_placeholder')}" />
          <button class="tp-send" type="submit" aria-label="${portalText('calls.follow_send')}">${icon('send', { class: 'tp-i i18' })}</button>
        </form>`;
  return page(
    screen.title,
    h`<div class="tp-ask is-thread">
      <header class="tp-bar">
        <div class="tp-bar-row">
          <a class="tp-icon-btn tp-back" href="/calls" aria-label="${portalText('calls.back')}">${icon('chevron-right', { class: 'tp-i i18' })}</a>
          <span class="tp-bar-title"><b>${screen.title}</b><small>${portalText('calls.number')} <span dir="ltr">${screen.number}</span> · ${screen.category} · <span dir="ltr">${screen.opened}</span></small></span>
          ${closed ? statusChip(screen.status) : h``}
        </div>
      </header>
      <div class="tp-body">
        ${notice(screen.notice)}
        ${stepper(screen.status)}
        ${visit}
        ${note}
        ${days}
      </div>
      ${foot}
    </div>`,
  );
}

export function renderMorePage(screen: { csrf: string }): string {
  return page(
    portalText('more.page'),
    h`<div class="tp-ask">
      <header class="tp-bar">
        <div class="tp-bar-row">
          <span class="tp-bar-title"><b>${portalText('more.title')}</b></span>
          <a class="tp-icon-btn" href="/" aria-label="${portalText('ask.close')}">${icon('x', { class: 'tp-i i18' })}</a>
        </div>
      </header>
      <div class="tp-body">
        <div class="tp-menu">
          <a class="tp-menu-row" href="/ask">${portalText('home.ask')}</a>
          ${languageSheet(screen.csrf, '/more', true)}
          <a class="tp-menu-row" href="/passkeys">${portalText('home.passkeys')}</a>
        </div>
        <form method="post" action="/sign-out">
          ${csrfInput(screen.csrf)}
          <button class="tp-text-btn" type="submit">${portalText('home.sign_out')}</button>
        </form>
        <form method="post" action="/sign-out/all">
          ${csrfInput(screen.csrf)}
          <button class="tp-text-btn" type="submit">${portalText('home.sign_out_all')}</button>
        </form>
      </div>
    </div>`,
  );
}

export type ReportEntry = 'YES' | 'ARRANGE' | 'HOME';

export interface ReportCategory {
  id: string;
  code: string;
  label: string;
}

export interface ReportDraft {
  csrf: string;
  submission: string;
  step: 1 | 2 | 3;
  categories: readonly ReportCategory[];
  categoryId: string;
  description: string;
  entry: ReportEntry | '';
  dutyPhone: string;
  dutyTel: string;
  flat: string;
  notice: string | null;
  files: readonly { id: string; fileName: string; contentType: string }[];
  predecessorId: string;
}

export function renderReportPage(screen: ReportDraft): string {
  const chosen = screen.categories.find((row) => row.id === screen.categoryId);
  const title =
    screen.step === 2
      ? (chosen?.label ?? portalText('report.title'))
      : screen.step === 3
        ? portalText('report.almost')
        : portalText('report.title');
  const primary = screen.step === 3 ? 'send' : 'next';
  const primaryLabel =
    screen.step === 3 ? portalText('report.send') : portalText('report.next');
  const implicit = h`<button hidden type="submit" name="action" value="${primary}">${primaryLabel}</button>`;
  const back =
    screen.step === 1
      ? h``
      : h`<button class="tp-icon-btn tp-back" type="submit" name="action" value="back" aria-label="${portalText('report.back')}">${icon('chevron-right', { class: 'tp-i i18' })}</button>`;
  const close =
    screen.step === 1
      ? h`<a class="tp-icon-btn" href="/" aria-label="${portalText('report.close')}">${icon('x', { class: 'tp-i i18' })}</a>`
      : h``;
  const enc = screen.step === 2 ? 'multipart/form-data' : null;
  return page(
    portalText('report.page'),
    h`<form class="tp-ask" method="post" action="/report"${enc === null ? h`` : h` enctype="multipart/form-data"`}>
      ${screen.step === 1 ? h`` : implicit}
      <header class="tp-bar">
        <div class="tp-bar-row">
          ${back}
          <span class="tp-bar-title"><b>${title}</b></span>
          ${close}
        </div>
        <div class="tp-steps" data-step="${screen.step}" aria-label="${stepLabel(screen.step)}"><i></i><i></i><i></i></div>
      </header>
      <div class="tp-body">
        ${screen.step === 1 ? emergencyCard(screen) : h``}
        ${screen.step === 1 ? implicit : h``}
        ${notice(screen.notice)}
        ${stepBody(screen, chosen?.label ?? '')}
        ${carried(screen)}
        <div class="tp-spacer"></div>
        <button class="tp-primary" type="submit" name="action" value="${primary}">${primaryLabel}</button>
      </div>
    </form>`,
  );
}

function stepLabel(step: 1 | 2 | 3): string {
  if (step === 1) return portalText('report.step1');
  if (step === 2) return portalText('report.step2');
  return portalText('report.step3');
}

function emergencyCard(screen: ReportDraft): Html {
  return h`<div class="tp-emergency">
    <b>${portalText('report.emergency_title')}</b>
    <p>${portalText('report.emergency_body')}</p>
    <a class="tp-danger" href="${screen.dutyTel}">${icon('phone', { class: 'tp-i i18' })}${portalText('report.duty')} · <span dir="ltr">${screen.dutyPhone}</span></a>
  </div>`;
}

function stepBody(screen: ReportDraft, categoryLabel: string): Html {
  if (screen.step === 1) {
    return h`<h2 class="tp-q">${portalText('report.what')}</h2>
      <div class="tp-tiles" role="radiogroup" aria-label="${portalText('report.category')}">
        ${screen.categories.map((category) => categoryTile(category, category.id === screen.categoryId))}
      </div>`;
  }
  if (screen.step === 2) {
    return h`<h2 class="tp-q"><label for="report-text">${portalText('report.tell')}</label></h2>
      <div>
        <textarea class="tp-textarea" id="report-text" name="description" required maxlength="4000" aria-describedby="report-help">${screen.description}</textarea>
        <p class="tp-help" id="report-help">${portalText('report.hint')}</p>
      </div>
      <h3 class="tp-section">${portalText('report.photos')}</h3>
      <div class="tp-thumbs">
        ${screen.files.map((file) => fileThumb(file))}
        <label class="tp-add"><input class="tp-sr" type="file" name="file" accept="image/*,video/*,.pdf" />${icon('camera', { class: 'tp-i i22' })}${portalText('report.add')}</label>
      </div>`;
  }
  return h`<h2 class="tp-q" id="entry-q">${portalText('report.entry_q')}</h2>
    <div class="tp-stack" role="radiogroup" aria-labelledby="entry-q">
      ${entryCard('YES', portalText('report.entry_yes'), screen.entry === 'YES')}
      ${entryCard('ARRANGE', portalText('report.entry_arrange'), screen.entry === 'ARRANGE')}
      ${entryCard('HOME', portalText('report.entry_home'), screen.entry === 'HOME')}
    </div>
    <div class="tp-summary">
      <span class="tp-kicker">${portalText('report.summary')}</span>
      <dl class="tp-stack">
        <div><dt>${portalText('report.category')}</dt><dd>${categoryLabel}</dd></div>
        <div><dt>${portalText('report.description')}</dt><dd>${screen.description}</dd></div>
        <div><dt>${portalText('report.files')}</dt><dd>${fileSummary(screen.files)}</dd></div>
        <div><dt>${portalText('report.flat')}</dt><dd>${screen.flat}</dd></div>
      </dl>
    </div>`;
}

function fileThumb(file: {
  id: string;
  fileName: string;
  contentType: string;
}): Html {
  const label = `${portalText('report.remove')}: ${file.fileName}`;
  const picture = file.contentType.startsWith('image/')
    ? h`<img src="/report/files/${file.id}" alt="" />`
    : h``;
  return h`<div class="tp-thumb">${picture}<span class="tp-thumb-name">${file.fileName}</span><button class="tp-thumb-x" type="submit" name="remove" value="${file.id}" aria-label="${label}">${icon('x', { class: 'tp-i i14' })}</button></div>`;
}

function fileSummary(files: ReportDraft['files']): string {
  if (files.length === 0) return portalText('report.files_none');
  return files.map((file) => file.fileName).join(', ');
}

function categoryTile(category: ReportCategory, on: boolean): Html {
  const mark = icon(categoryIcon(category.code), { class: 'tp-i i26' });
  const input = on
    ? h`<input class="tp-sr" type="radio" name="category" required data-code="${category.code}" value="${category.id}" checked />`
    : h`<input class="tp-sr" type="radio" name="category" required data-code="${category.code}" value="${category.id}" />`;
  return h`<label class="tp-tile">${input}${mark}${category.label}</label>`;
}

function categoryIcon(code: string): IconName {
  if (code === 'PLUMBING') return 'droplet';
  if (code === 'ELECTRICAL') return 'zap';
  if (code === 'LOCKS') return 'door';
  if (code === 'GATES') return 'building';
  if (code === 'AIR_CONDITIONING') return 'sun';
  return 'ellipsis';
}

function entryCard(value: ReportEntry, label: string, on: boolean): Html {
  const input = on
    ? h`<input class="tp-sr" type="radio" name="entry" required value="${value}" checked />`
    : h`<input class="tp-sr" type="radio" name="entry" required value="${value}" />`;
  return h`<label class="tp-radio">${input}<span class="tp-ring" aria-hidden="true"></span><span class="tp-radio-text">${label}</span></label>`;
}

function carried(screen: ReportDraft): Html {
  const description =
    screen.step === 2
      ? h``
      : h`<input type="hidden" name="description" value="${screen.description}" />`;
  const entry =
    screen.step === 3
      ? h``
      : h`<input type="hidden" name="entry" value="${screen.entry}" />`;
  const category =
    screen.step === 1
      ? h``
      : h`<input type="hidden" name="category" value="${screen.categoryId}" />`;
  return h`${csrfInput(screen.csrf)}
    <input type="hidden" name="submission" value="${screen.submission}" />
    <input type="hidden" name="predecessor" value="${screen.predecessorId}" />
    <input type="hidden" name="step" value="${screen.step}" />
    ${description}${entry}${category}`;
}

export function renderReportReceived(screen: {
  callId: string;
  callNumber: number;
  category: string;
  duty: string | null;
}): string {
  const duty =
    screen.duty === null
      ? h``
      : h`<p class="tp-strip" role="status">${screen.duty}</p>`;
  return page(
    portalText('report.received'),
    h`<div class="tp-body is-auth is-center">
      <div class="tp-spacer"></div>
      <span class="tp-hero-well is-sent">${icon('check', { class: 'tp-i i48' })}</span>
      <div class="tp-stack">
        <h1 class="tp-display">${portalText('report.received')}</h1>
        <p class="tp-lede" data-call-number="${screen.callNumber}">${portalText('ask.number')} <span dir="ltr">${screen.callNumber}</span> · ${screen.category}. ${portalText('report.received_line')}</p>
      </div>
      ${duty}
      <div class="tp-spacer"></div>
      <div class="tp-stack">
        <a class="tp-primary" href="/calls/${screen.callId}">${portalText('report.view')}</a>
        <a class="tp-text-btn" href="/">${portalText('report.home')}</a>
      </div>
    </div>`,
  );
}

export function renderNoAccessPage(screen: {
  csrf: string;
  phone: string;
}): string {
  return page(
    portalText('no_access.title'),
    h`<div class="tp-body is-auth is-center">
      <div class="tp-spacer"></div>
      <span class="tp-hero-well is-muted">${icon('building', { class: 'tp-i i48' })}</span>
      <div class="tp-stack">
        <h1 class="tp-display">${portalText('no_access.title')}</h1>
        <p class="tp-lede">${portalText('no_access.signed')} <span dir="ltr">${screen.phone}</span>. ${portalText('no_access.body')}</p>
        <p class="tp-meta">${portalText('no_access.meanwhile')}</p>
      </div>
      <div class="tp-spacer"></div>
      <div class="tp-stack">
        <a class="tp-primary" href="/ask">${portalText('home.ask')}</a>
        <form method="post" action="/sign-out">
          ${csrfInput(screen.csrf)}
          <button class="tp-text-btn" type="submit">${portalText('home.sign_out')}</button>
        </form>
      </div>
    </div>`,
  );
}

export function renderMissingPage(screen: { chosenId: string }): string {
  const flatHref = `/flat/${screen.chosenId}`;
  return shell(
    portalText('flat.missing'),
    h`<div class="tp-body">
      <h1 class="tp-page-title">${portalText('flat.missing')}</h1>
      <a class="tp-text-btn" href="/">${portalText('code.back')}</a>
    </div>`,
    tabBar('flat', flatHref),
  );
}

function reason(key: string): Html {
  return h`<li class="tp-row">${icon('check', { class: 'tp-i is-ok' })}${portalText(key)}</li>`;
}

export function renderPasskeyOffer(screen: {
  csrf: string;
  options: unknown;
}): string {
  return page(
    portalText('passkey.page'),
    h`<div class="tp-body is-auth is-center">
      <div class="tp-spacer"></div>
      <span class="tp-hero-well is-passkey">${icon('scan', { class: 'tp-i i48' })}</span>
      <div class="tp-stack">
        <h1 class="tp-display">${portalText('passkey.title')}</h1>
        <p class="tp-lede">${portalText('passkey.lede')}</p>
      </div>
      <ul class="tp-list">
        ${reason('passkey.reason_wait')}
        ${reason('passkey.reason_device')}
        ${reason('passkey.reason_control')}
      </ul>
      <p class="tp-notice" role="alert" data-portal-passkey-error hidden>${portalText('passkey.failed')}</p>
      ${passkeyOptions(screen.options)}
      <div class="tp-spacer"></div>
      <div class="tp-stack">
        <button class="tp-primary" type="button" data-portal-passkey="create">${portalText('passkey.enable')}</button>
        <form method="post" action="/passkey/later">
          ${csrfInput(screen.csrf)}
          <button class="tp-text-btn" type="submit">${portalText('passkey.later')}</button>
        </form>
      </div>
      ${passkeyScript()}
    </div>`,
  );
}

export function renderPasskeysPage(screen: {
  csrf: string;
  passkeys: ReadonlyArray<{ id: string; added: string }>;
  notice: string | null;
}): string {
  const rows = screen.passkeys.map(
    (row) => h`<li>
      <div class="tp-row">
        <span class="tp-row-text">
          <span class="tp-row-title" id="pk-${row.id}">${portalText('passkeys.one')}</span>
          <span class="tp-meta" dir="ltr">${row.added}</span>
        </span>
      </div>
      <form method="post" action="/passkeys/remove">
        ${csrfInput(screen.csrf)}
        <input type="hidden" name="passkey" value="${row.id}" />
        <button class="tp-text-btn" type="submit" aria-describedby="pk-${row.id}">${portalText('passkeys.remove')}</button>
      </form>
    </li>`,
  );
  return page(
    portalText('passkeys.page'),
    h`<div class="tp-body is-auth">
      <div class="tp-stack tp-auth-head">
        <h1 class="tp-display">${portalText('passkeys.title')}</h1>
        ${screen.passkeys.length === 0 ? h`<p class="tp-lede">${portalText('passkeys.empty')}</p>` : h``}
      </div>
      ${notice(screen.notice)}
      ${rows.length === 0 ? h`` : h`<ul class="tp-list">${rows}</ul>`}
      <a class="tp-text-btn" href="/">${portalText('passkeys.back')}</a>
    </div>`,
  );
}

function passkeyOptions(options: unknown): Html {
  return h`<input type="hidden" data-portal-passkey-options value="${JSON.stringify(options)}" />`;
}

function passkeyScript(): Html {
  return new Html(`<script>
    /* dona.portal.passkey */
    (function () {
      var button = document.querySelector('[data-portal-passkey]');
      if (!button) return;
      var fail = document.querySelector('[data-portal-passkey-error]');
      function show() {
        if (fail) fail.hidden = false;
      }
      function b64url(buffer) {
        var bytes = new Uint8Array(buffer);
        var bin = '';
        for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      }
      function bytes(value) {
        var pad = value.length % 4 === 0 ? '' : '===='.slice(value.length % 4);
        var bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out.buffer;
      }
      button.addEventListener('click', function () {
        if (!window.PublicKeyCredential || !navigator.credentials) {
          show();
          return;
        }
        var stored = document.querySelector('[data-portal-passkey-options]');
        if (!stored || !stored.value) {
          show();
          return;
        }
        var csrfInput = document.querySelector('input[name="csrf"]');
        var csrf = csrfInput ? csrfInput.value : '';
        var mode = button.getAttribute('data-portal-passkey');
        var finishUrl = mode === 'create' ? '/passkey/register' : '/passkey/sign-in';
        var options;
        try {
          options = JSON.parse(stored.value);
          options.publicKey.challenge = bytes(options.publicKey.challenge);
          if (options.publicKey.user) {
            options.publicKey.user.id = bytes(options.publicKey.user.id);
          }
          var excluded = options.publicKey.excludeCredentials || [];
          for (var i = 0; i < excluded.length; i += 1) {
            excluded[i].id = bytes(excluded[i].id);
          }
        } catch (error) {
          show();
          return;
        }
        button.disabled = true;
        var op = mode === 'create'
          ? navigator.credentials.create(options)
          : navigator.credentials.get(options);
        Promise.resolve(op).then(function (cred) {
          if (!cred) throw new Error('empty');
          var response = cred.response;
          var body = {
            csrf: csrf,
            id: cred.id,
            clientDataJSON: b64url(response.clientDataJSON),
          };
          if (mode === 'create') {
            body.attestationObject = b64url(response.attestationObject);
          } else {
            body.authenticatorData = b64url(response.authenticatorData);
            body.signature = b64url(response.signature);
            body.userHandle = response.userHandle ? b64url(response.userHandle) : '';
          }
          return fetch(finishUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        }).then(function (response) {
          if (!response.ok) throw new Error('finish');
          window.location.assign('/');
        }).catch(function () {
          button.disabled = false;
          show();
        });
      });
    })();
  </script>`);
}

function paragraphs(body: string): Html {
  return h`${body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => h`<p class="tp-long">${line}</p>`)}`;
}

function fallbackNote(fallback: boolean | undefined): Html {
  if (!fallback) return h``;
  return h`<p class="tp-legal-fallback">${portalText('legal.fallback')}</p>`;
}

function shownLegal(fallback: boolean | undefined, inner: Html): Html {
  if (!fallback) return inner;
  return h`<div lang="he" dir="rtl">${inner}</div>`;
}

function optSwitch(opt: {
  key: string;
  title: string;
  summary: string;
  on: boolean;
  fallback?: boolean;
}): Html {
  const checked = opt.on ? h` checked` : h``;
  return h`<label class="tp-card is-row" for="opt-${opt.key}">
    ${fallbackNote(opt.fallback)}
    ${shownLegal(
      opt.fallback,
      h`<span class="tp-row-text">
      <b class="tp-row-title">${opt.title}</b>
      <span class="tp-meta">${opt.summary}</span>
    </span>`,
    )}
    <span class="tp-switch"><input id="opt-${opt.key}" name="opt_${opt.key}" type="checkbox" role="switch" value="on"${checked} /></span>
  </label>`;
}

export function renderNoticePage(screen: {
  csrf: string;
  privacy: { id: string; title: string; summary: string; fallback?: boolean };
  terms: { id: string; title: string; summary: string; fallback?: boolean };
  optIns: ReadonlyArray<{
    key: string;
    title: string;
    summary: string;
    on: boolean;
    fallback?: boolean;
  }>;
}): string {
  return page(
    portalText('notice.page'),
    h`<div class="tp-body is-auth">
      <div class="tp-stack">
        <h1 class="tp-display">${portalText('notice.title')}</h1>
        <p class="tp-lede">${portalText('notice.lede')}</p>
      </div>
      <form method="post" action="/notice">
        ${csrfInput(screen.csrf)}
        <input type="hidden" name="privacy" value="${screen.privacy.id}" />
        <input type="hidden" name="terms" value="${screen.terms.id}" />
        <article class="tp-card">
          ${fallbackNote(screen.privacy.fallback)}
          ${shownLegal(
            screen.privacy.fallback,
            h`<div class="tp-row">
            <span class="tp-well">${icon('shield', { class: 'tp-i i18' })}</span>
            <h2 class="tp-section">${screen.privacy.title}</h2>
          </div>
          <p class="tp-long">${screen.privacy.summary}</p>`,
          )}
          ${fallbackNote(screen.terms.fallback)}
          ${shownLegal(
            screen.terms.fallback,
            h`<div class="tp-row">
            <span class="tp-well">${icon('file', { class: 'tp-i i18' })}</span>
            <h2 class="tp-section">${screen.terms.title}</h2>
          </div>
          <p class="tp-long">${screen.terms.summary}</p>`,
          )}
          <a class="tp-link" href="/notice/full">${portalText('notice.full')}</a>
        </article>
        ${screen.optIns.map((opt) => optSwitch(opt))}
        <button class="tp-primary" type="submit">${portalText('notice.continue')}</button>
      </form>
    </div>`,
  );
}

export function renderNoticeFullPage(screen: {
  privacy: { title: string; body: string; fallback?: boolean };
  terms: { title: string; body: string; fallback?: boolean };
}): string {
  return page(
    portalText('notice.full_page'),
    h`<div class="tp-body is-auth">
      <h1 class="tp-display">${portalText('notice.full_page')}</h1>
      <article class="tp-card">
        ${fallbackNote(screen.privacy.fallback)}
        ${shownLegal(
          screen.privacy.fallback,
          h`<h2 class="tp-section">${screen.privacy.title}</h2>
        ${paragraphs(screen.privacy.body)}`,
        )}
      </article>
      <article class="tp-card">
        ${fallbackNote(screen.terms.fallback)}
        ${shownLegal(
          screen.terms.fallback,
          h`<h2 class="tp-section">${screen.terms.title}</h2>
        ${paragraphs(screen.terms.body)}`,
        )}
      </article>
      <a class="tp-text-btn" href="/notice">${portalText('notice.back')}</a>
    </div>`,
  );
}

export function renderAskPage(screen: {
  csrf: string;
  submission: string;
  question: string;
  notice: string | null;
}): string {
  return page(
    portalText('ask.page'),
    h`<div class="tp-ask">
      <header class="tp-bar">
        <div class="tp-bar-row">
          <span class="tp-bar-title"><b>${portalText('ask.title')}</b></span>
          <a class="tp-icon-btn" href="/" aria-label="${portalText('ask.close')}">${icon('x', { class: 'tp-i i18' })}</a>
        </div>
      </header>
      <div class="tp-body">
        ${notice(screen.notice)}
        <p class="tp-strip">${icon('message-circle', { class: 'tp-i' })}${portalText('ask.strip')}</p>
        <form method="post" action="/ask">
          ${csrfInput(screen.csrf)}
          <input type="hidden" name="submission" value="${screen.submission}" />
          <label class="tp-label" for="question">${portalText('ask.question')}</label>
          <textarea class="tp-textarea is-tall" id="question" name="question" required>${screen.question}</textarea>
          <div class="tp-spacer"></div>
          <button class="tp-primary" type="submit">${portalText('ask.send')}</button>
        </form>
      </div>
    </div>`,
  );
}

export function renderAskReceived(screen: {
  callNumber: number;
  duty: string | null;
}): string {
  const duty =
    screen.duty === null
      ? h``
      : h`<p class="tp-strip" role="status">${screen.duty}</p>`;
  return page(
    portalText('ask.received'),
    h`<div class="tp-body is-auth is-center">
      <div class="tp-spacer"></div>
      <h1 class="tp-display">${portalText('ask.received')}</h1>
      <p class="tp-lede" data-call-number="${screen.callNumber}">${portalText('ask.number')} <span dir="ltr">${screen.callNumber}</span></p>
      ${duty}
      <div class="tp-spacer"></div>
      <a class="tp-text-btn" href="/">${portalText('ask.back')}</a>
    </div>`,
  );
}
