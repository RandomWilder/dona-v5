// The page shell every screen in this system is rendered into. Slice 3.3.
//
// It lived in `src/estate/internal/views.ts` from 1.11, because estate had the only screens there
// were. Slice 3.3 gives a second module a screen, and the choice at that moment is to copy the
// doctype, the head, the chrome bar and the shell CSS into `src/evidence/` or to move them here.
// A copied shell is the drift `src/kernel/ui/html.ts` was put in the kernel to prevent -- one page
// keeps its `noindex`, the other loses it, and `tests/ui/tokens.test.ts` is asserting the same
// property twice against two implementations.
//
// **What is here is the shell and nothing a module knows.** The kernel imports from no domain

// module (SPEC.md rule 9, proved by boundary.test.ts) and it does not know a route either: the nav
// is an `Html` the caller builds, because `/estate/expiring` is estate's fact and naming it here
// would be the kernel learning the estate. Layout for a module's own cards stays in that module's
// views and arrives through `styles`.
import { type Html, h } from './html.ts';

// The chrome, the page frame, and the typography both modules' screens share. Everything physical
// is logical -- `margin-inline`, `inset-inline-start` -- because Hebrew is RTL and one stylesheet
// serves both directions (SPEC.md). tests/ui/tokens.test.ts fails the build on a `left:` here.
const shell = h`<style>
  .wrap {
    max-width: var(--size-shell-max);
    margin-inline: auto;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-5);
  }
  .top {
    background: var(--color-chrome);
    color: var(--color-on-chrome);
    padding: var(--space-4);
  }
  .top-inner {
    max-width: var(--size-shell-max);
    margin-inline: auto;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .brand { font-weight: 500; }
  .top-note {
    color: var(--color-on-chrome-muted);
    font-size: var(--text-sm);
  }
  .top-nav {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    flex-wrap: wrap;
    margin-inline-start: auto;
  }
  .top-nav a { color: var(--color-on-chrome); }
  h1 { font-size: var(--text-xl); margin: 0; }
  h2 { font-size: var(--text-lg); margin: 0 0 var(--space-3); }
  .lede { color: var(--color-text-muted); margin: var(--space-1) 0 0; }
  .back { display: inline-block; }
</style>`;

export interface PageOptions {
  /** The `<title>`. Escaped, like every other interpolation `h` touches. */
  title: string;
  /** The screens' own layout. One `<style>` per page, after the shell's. */
  styles?: Html;
  /** What sits in the chrome bar beside the brand. The caller's, never the kernel's. */
  nav?: Html;
  body: Html;
}

/**
 * One page, server-rendered, with no client JavaScript in it at all.
 *
 * `noindex` is here rather than in each screen for the reason the shell is here at all: it is a
 * property of every page this system serves until week 5 puts a session in front of them, and a
 * property that has to be remembered per screen is one a screen will eventually forget.
 */
export function renderPage(options: PageOptions): string {
  return `<!doctype html>
${h`<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${options.title}</title>
    <link rel="stylesheet" href="/ui/tokens.css" />
    ${shell}
    ${options.styles ?? h``}
  </head>
  <body>
    <header class="top">
      <div class="top-inner">
        <span class="brand">דונה דום</span>
        <span class="top-note">נכסים · נתוני הדגמה</span>
        ${options.nav ?? h``}
      </div>
    </header>
    <main class="wrap">${options.body}</main>
  </body>
</html>`}`;
}

/**
 * The name of the hidden field every form in this system carries, and the markup that carries it.
 * **Slice 5.2.**
 *
 * The *value* is `src/staff/`'s — it is derived from the session, and the session is that module's
 * fact. The *name* and the *markup* are the page's, and they are here for the reason the shell
 * itself is: four modules render forms, and a field name spelled in four places is a field name
 * that will one day be spelled three ways. `src/staff/internal/csrf.ts` reads `CSRF_FIELD` from
 * here rather than declaring its own, so the form and the check cannot disagree about what the
 * input is called.
 *
 * This is not the kernel learning a domain: it is one string and one input element, and it knows
 * nothing about who is signed in or what the value means.
 */
export const CSRF_FIELD = 'csrf';

export function csrfInput(token: string): Html {
  return h`<input type="hidden" name="${CSRF_FIELD}" value="${token}" />`;
}
