// The page shell every screen in this system is rendered into. Slice 3.3; ops frame at 5.2c.
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
//
// **Slice 5.2c** put v3's ops sidebar in this file. The destinations still arrive as `nav`. Login
// calls with no nav and gets no rail. The rail is a real grid column, not a `<details>` with
// `display: contents` — Chromium leaves that closed and paints no sidebar.
import { type Html, h } from './html.ts';

// The chrome, the page frame, and the typography both modules' screens share. Everything physical
// is logical -- `margin-inline`, `inset-inline-start` -- because Hebrew is RTL and one stylesheet
// serves both directions (SPEC.md). tests/ui/tokens.test.ts fails the build on a `left:` here.
const shell = h`<style>
  .ops {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: var(--size-sidebar) minmax(0, 1fr);
  }
  .ops-nav {
    background: var(--color-chrome);
    color: var(--color-on-chrome);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-4);
    border-inline-end: var(--size-hairline) solid var(--color-on-chrome-raised);
  }
  .ops-brand {
    padding-inline: var(--space-5);
    padding-block: var(--space-2);
    font-weight: 500;
  }
  .ops-nav nav {
    display: grid;
    gap: var(--space-1);
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--size-control-ops);
    margin-inline: var(--space-3);
    padding-inline: var(--space-3);
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--color-on-chrome);
    font: inherit;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }
  .nav-item[aria-current="page"] {
    background: var(--color-on-chrome-raised);
  }
  .nav-item svg {
    flex: 0 0 auto;
    width: var(--space-5);
    height: var(--space-5);
  }
  .ops-footer {
    margin-block-start: auto;
    padding-block: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  .ops-footer-note {
    margin: 0;
    padding-inline: var(--space-5);
    color: var(--color-on-chrome-muted);
    font-size: var(--text-sm);
  }
  .ops-footer form { margin: 0; display: grid; }
  .ops-main {
    min-width: 0;
    padding: var(--space-6);
    max-width: var(--size-content-max);
  }
  .guest {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: var(--space-5);
  }
  h1 { font-size: var(--text-xl); margin: 0; }
  h2 { font-size: var(--text-lg); margin: 0 0 var(--space-3); }
  .lede { color: var(--color-text-muted); margin: var(--space-1) 0 0; }
  .back { display: inline-block; }
  @media (max-width: 1099px) and (min-width: 840px) {
    .ops { grid-template-columns: var(--size-icon-rail) minmax(0, 1fr); }
    .nav-label,
    .ops-brand,
    .ops-footer-note {
      position: absolute;
      width: var(--size-hairline);
      height: var(--size-hairline);
      overflow: hidden;
      clip-path: inset(50%);
    }
    .nav-item { justify-content: center; padding-inline: 0; }
  }
  @media (max-width: 839px) {
    .ops {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 1fr;
    }
    .ops-nav {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      padding-block: var(--space-2);
    }
    .ops-nav nav {
      display: flex;
      flex-wrap: wrap;
    }
    .ops-footer {
      margin-block-start: 0;
      padding-block: 0;
      margin-inline-start: auto;
    }
    .ops-footer-note { display: none; }
    .ops-main { padding: var(--space-4); }
  }
  @media (max-width: 479px) {
    .nav-item { min-height: var(--size-touch); }
  }
</style>`;

export interface PageOptions {
  /** The `<title>`. Escaped, like every other interpolation `h` touches. */
  title: string;
  /** The screens' own layout. One `<style>` per page, after the shell's. */
  styles?: Html;
  /** What sits in the ops rail. The caller's, never the kernel's. Absent on login. */
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
  const frame =
    options.nav === undefined
      ? h`<main class="guest">${options.body}</main>`
      : h`<div class="ops">
            <aside class="ops-nav">
              <p class="ops-brand">דונה דום</p>
              ${options.nav}
            </aside>
            <main class="ops-main">${options.body}</main>
          </div>`;
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
    ${frame}
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
