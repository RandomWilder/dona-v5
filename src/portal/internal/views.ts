// The tenant portal's pages. Strings come from the copy rows. Colour, type and side live in
// portal.css. Two scripts, both named in SPEC.md: the code form submits on the
// sixth digit, and the passkey pages call WebAuthn. Without either, the button
// that does not need a ceremony still posts.

import type { CodeChannel } from '../../channel/contract.ts';
import { Html, h } from '../../kernel/ui/html.ts';
import { icon } from '../../kernel/ui/icons.ts';
import { csrfInput } from '../../kernel/ui/page.ts';
import { portalText } from './copy.ts';
import { nationalDisplay } from './phone.ts';

function page(title: string, body: Html): string {
  return `<!doctype html>
${h`<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <link rel="stylesheet" href="/ui/tokens.css" />
    <link rel="stylesheet" href="/ui/portal.css" />
  </head>
  <body class="portal">${body}</body>
</html>`}`;
}

function notice(key: string | null): Html {
  if (key === null) return h``;
  return h`<p class="tp-notice" role="alert">${portalText(key)}</p>`;
}

function languageSheet(): Html {
  return h`<div class="tp-lang">
    <input id="tp-lang" class="tp-lang-toggle" type="checkbox" aria-label="${portalText('sign_in.language')}" />
    <label for="tp-lang" class="tp-icon-btn is-globe" aria-hidden="true">${icon('globe', { class: 'tp-i i22' })}</label>
    <div class="tp-sheet-layer">
      <label for="tp-lang" class="tp-scrim-close"><span class="tp-sr">${portalText('code.back')}</span></label>
      <div class="tp-sheet" role="dialog" aria-labelledby="tp-lang-title">
        <span class="tp-grabber" aria-hidden="true"></span>
        <h2 id="tp-lang-title" class="tp-sheet-title">${portalText('sign_in.language_title')}</h2>
        <p class="tp-lang-row"><b>${portalText('sign_in.language_current')}</b>${icon('check', { class: 'tp-i' })}</p>
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
        ${languageSheet()}
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
        <a class="tp-icon-btn" href="/" aria-label="${portalText('code.back')}">${icon('chevron-right', { class: 'tp-i i18' })}</a>
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
  return h`${portalText('flat.months_left')} <span dir="ltr">${String(months)}</span> ${portalText('flat.months')}`;
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

function shell(title: string, body: Html, bar: Html): string {
  return page(title, h`<div class="tp-shell">${body}${bar}</div>`);
}

export function renderHomePage(screen: {
  csrf: string;
  greeting: string;
  choices: readonly PortalChoice[];
  chosenId: string;
}): string {
  const flatHref = `/flat/${screen.chosenId}`;
  return shell(
    portalText('home.page'),
    h`<div class="tp-body">
      <div class="tp-head">${pill(screen.choices, screen.chosenId, screen.csrf, '/')}</div>
      <h1 class="tp-page-title">${screen.greeting}</h1>
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
    </div>`,
    tabBar('flat', `/flat/${screen.chosenId}`),
  );
}

export function renderPortalCallsPage(screen: {
  csrf: string;
  choices: readonly PortalChoice[];
  chosenId: string;
}): string {
  const flatHref = `/flat/${screen.chosenId}`;
  return shell(
    portalText('calls.page'),
    h`<div class="tp-body">
      <div class="tp-head">
        <h1 class="tp-page-title">${portalText('calls.title')}</h1>
        ${pill(screen.choices, screen.chosenId, screen.csrf, '/calls')}
      </div>
    </div>`,
    tabBar('calls', flatHref),
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
          <div class="tp-menu-row"><span>${portalText('sign_in.language')}</span>${languageSheet()}</div>
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

export function renderReportPage(): string {
  return page(
    portalText('report.page'),
    h`<div class="tp-ask">
      <header class="tp-bar">
        <div class="tp-bar-row">
          <span class="tp-bar-title"><b>${portalText('report.title')}</b></span>
          <a class="tp-icon-btn" href="/" aria-label="${portalText('ask.close')}">${icon('x', { class: 'tp-i i18' })}</a>
        </div>
      </header>
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

function optSwitch(opt: {
  key: string;
  title: string;
  summary: string;
  on: boolean;
}): Html {
  const checked = opt.on ? h` checked` : h``;
  return h`<label class="tp-card is-row" for="opt-${opt.key}">
    <span class="tp-row-text">
      <b class="tp-row-title">${opt.title}</b>
      <span class="tp-meta">${opt.summary}</span>
    </span>
    <span class="tp-switch"><input id="opt-${opt.key}" name="opt_${opt.key}" type="checkbox" role="switch" value="on"${checked} /></span>
  </label>`;
}

export function renderNoticePage(screen: {
  csrf: string;
  privacy: { id: string; title: string; summary: string };
  terms: { id: string; title: string; summary: string };
  optIns: ReadonlyArray<{
    key: string;
    title: string;
    summary: string;
    on: boolean;
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
          <div class="tp-row">
            <span class="tp-well">${icon('shield', { class: 'tp-i i18' })}</span>
            <h2 class="tp-section">${screen.privacy.title}</h2>
          </div>
          <p class="tp-long">${screen.privacy.summary}</p>
          <div class="tp-row">
            <span class="tp-well">${icon('file', { class: 'tp-i i18' })}</span>
            <h2 class="tp-section">${screen.terms.title}</h2>
          </div>
          <p class="tp-long">${screen.terms.summary}</p>
          <a class="tp-link" href="/notice/full">${portalText('notice.full')}</a>
        </article>
        ${screen.optIns.map((opt) => optSwitch(opt))}
        <button class="tp-primary" type="submit">${portalText('notice.continue')}</button>
      </form>
    </div>`,
  );
}

export function renderNoticeFullPage(screen: {
  privacy: { title: string; body: string };
  terms: { title: string; body: string };
}): string {
  return page(
    portalText('notice.full_page'),
    h`<div class="tp-body is-auth">
      <h1 class="tp-display">${portalText('notice.full_page')}</h1>
      <article class="tp-card">
        <h2 class="tp-section">${screen.privacy.title}</h2>
        ${paragraphs(screen.privacy.body)}
      </article>
      <article class="tp-card">
        <h2 class="tp-section">${screen.terms.title}</h2>
        ${paragraphs(screen.terms.body)}
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
