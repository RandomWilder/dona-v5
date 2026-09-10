// Unbuilt destinations. **Slice 5.3.**
//
// A tab that does not exist yet is not hidden and is not a fake product. It is one line naming
// the week and slice that own it, so the remaining roadmap is on the rail. The kernel still
// learns no route: this file lives beside `chrome.ts` at the composition root.

import { type ChromeDest, signedInChrome } from './chrome.ts';
import { h } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';

export interface StubDest {
  dest: Exclude<ChromeDest, 'index'>;
  title: string;
  owner: string;
}

const styles = h`<style>
  .stub { max-width: 36rem; }
  .stub p { color: var(--color-text-muted); }
</style>`;

export function renderStubPage(
  screen: { csrf: string },
  stub: StubDest,
  state: 'wired' | 'painted',
): string {
  const body = h`
    <div class="stub" data-state="${state}">
      <h1>${stub.title}</h1>
      <p class="lede">${stub.owner}</p>
    </div>`;
  return renderPage({
    title: `${stub.title} — דונה דום`,
    styles,
    nav: signedInChrome(screen.csrf, stub.dest),
    body,
  });
}

export const CALLS_STUB: StubDest = {
  dest: 'calls',
  title: 'קריאות',
  owner: 'שבוע 7 · סלייס 7.2',
};

export const SETTINGS_STUB: StubDest = {
  dest: 'settings',
  title: 'הגדרות',
  owner: 'שבוע 5 · סלייס 5.8',
};

export function renderIaMockup(csrf: string): string {
  const body = h`
    <div data-state="painted">
      <h1>יעדי הדלפק</h1>
      <p class="lede">שבעה יעדים. מה שעוד לא נבנה נושא את השבוע והסלייס שמחזיקים אותו.</p>
      <p>קריאות — ${CALLS_STUB.owner}</p>
      <p>הגדרות — ${SETTINGS_STUB.owner}</p>
    </div>`;
  return renderPage({
    title: 'יעדי הדלפק — דונה דום',
    styles,
    nav: signedInChrome(csrf, 'index'),
    body,
  });
}
