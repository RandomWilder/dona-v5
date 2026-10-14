// **#233. The floor under every screen's own refusal.**
//
// On 14 Oct 2026 the director approved a lease and read `{"code":"invalid","message":"that terms
// profile does not exist"}` in the browser. The cause was fixed elsewhere; this page is so that the
// next refusal nobody anticipated arrives in Hebrew, inside the shell, with a way back.
//
// It lives beside `src/app.ts` for the index page's reason: the rail it draws names every module's
// routes. It never prints the error's own message — those are English, written for a log, and
// some name a field or a row (SPEC.md §Error shape).

import { signedInChrome } from './chrome.ts';
import type { ErrorCode } from './kernel/errors.ts';
import { h } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';

const SENTENCE_HE: Record<ErrorCode, string> = {
  invalid: 'אחד הפרטים שנשלחו אינו תקין, ולכן הפעולה לא בוצעה.',
  conflict: 'הפעולה מתנגשת במצב הנוכחי של הרשומה, ולכן לא בוצעה.',
  not_found: 'הדבר שביקשת לא נמצא.',
  not_allowed: 'אין לך הרשאה לבצע פעולה זו.',
  too_many: 'בוצעו יותר מדי פעולות מסוג זה. נסו שוב מאוחר יותר.',
  unavailable: 'אירעה תקלה בלתי צפויה. נסו שוב בעוד מספר דקות.',
};

export function errorSentenceHe(code: ErrorCode): string {
  return SENTENCE_HE[code];
}

/** Whether the client asked for a page. No `Accept`, or one without `text/html`, keeps JSON. */
export function wantsHtml(accept: string | undefined): boolean {
  return accept !== undefined && /\btext\/html\b/i.test(accept);
}

/**
 * The way back: the referring page's path when it is this host, `/` otherwise. A foreign or
 * malformed `Referer` never becomes a link — the page would otherwise be an open redirect that
 * wears the console's shell.
 */
export function wayBack(
  referer: string | undefined,
  host: string | undefined,
): string {
  if (referer === undefined || host === undefined) return '/';
  try {
    const url = new URL(referer);
    if (url.host !== host) return '/';
    // `//evil.example/x` is a same-host path and a protocol-relative href. Never a link out.
    if (url.pathname.startsWith('//')) return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

export interface ErrorScreen {
  code: ErrorCode;
  back: string;
  /** Present when the request carried a session: the page then draws the rail. */
  signedIn?: {
    csrf: string;
    mayFile: boolean;
    mayReadParties: boolean;
    openCalls?: number;
  };
}

const styles = h`<style>
  .error-card {
    display: grid;
    gap: var(--space-4);
    max-width: 40rem;
    background: var(--color-surface-card);
    border: var(--size-hairline) solid var(--color-divider-soft);
    border-radius: var(--radius-3);
    padding: var(--space-5);
  }
  .error-card h1 { margin: 0; }
  .error-card p { margin: 0; }
</style>`;

export function renderErrorPage(screen: ErrorScreen): string {
  const body = h`<section class="error-card" data-error-code="${screen.code}">
    <h1>הפעולה לא הושלמה</h1>
    <p>${errorSentenceHe(screen.code)}</p>
    <p><a data-way-back href="${screen.back}">${screen.back === '/' ? 'חזרה לדף הבית' : 'חזרה לדף הקודם'}</a></p>
  </section>`;
  const s = screen.signedIn;
  return renderPage({
    title: 'דונה דום — הפעולה לא הושלמה',
    styles,
    nav:
      s === undefined
        ? undefined
        : signedInChrome(
            s.csrf,
            'index',
            s.mayFile,
            s.mayReadParties,
            s.openCalls,
          ),
    body,
  });
}
