// The tenant portal's pages. Strings come from the copy rows. Colour, type and side live in
// portal.css. The one script submits the code form on the sixth digit; without it the button
// under the cells still posts (SPEC.md).

import type { CodeChannel } from '../../channel/contract.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
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
      <form method="post" action="/sign-in">
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
        </div>
      </form>
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
      ${fallbackCard(screen)}
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

export function renderHomePage(screen: { csrf: string }): string {
  return page(
    portalText('home.page'),
    h`<div class="tp-body is-auth">
      <div class="tp-stack tp-auth-head">
        <h1 class="tp-display">${portalText('home.title')}</h1>
        <p class="tp-lede">${portalText('home.empty')}</p>
      </div>
      <form method="post" action="/sign-out">
        ${csrfInput(screen.csrf)}
        <button class="tp-text-btn" type="submit">${portalText('home.sign_out')}</button>
      </form>
      <form method="post" action="/sign-out/all">
        ${csrfInput(screen.csrf)}
        <button class="tp-primary" type="submit">${portalText('home.sign_out_all')}</button>
      </form>
    </div>`,
  );
}
