// **Slice 5.2b, ops rail at 5.2c, remaining destinations at 5.3.**
//
// It lives here, beside `src/index-page.ts` and `src/app.ts`, because it names every module's
// routes plus the way out — the same reason the index left estate at 5.2. The kernel's shell
// still takes `nav` as HTML and learns no path. Estate, evidence and staff receive this function
// through their register deps and write none of their own bar.
//
// Login is not a caller. A chrome bar linking to the estate from a screen that has no session
// would be a link to a refusal.

import { type Html, h } from './kernel/ui/html.ts';
import { CSRF_FIELD } from './kernel/ui/page.ts';

export type ChromeDest =
  | 'index'
  | 'estate'
  // **Slice 6.9.** A12 was built at 6.3 and had one door — a card on the index — so the week-6 demo
  // walked from a building page, never passed the root again, and filed six documents through A1's
  // unit-first screen without once reaching the flow the room had asked for. A flow's entrance is
  // part of the flow.
  | 'documents'
  | 'filing'
  | 'expiring'
  | 'incomplete'
  | 'search'
  | 'staff'
  | 'calls'
  | 'settings';

function icon(drawing: Html): Html {
  return h`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;
}

function item(
  dest: Exclude<ChromeDest, 'index'>,
  href: string,
  label: string,
  current: ChromeDest,
  drawing: Html,
): Html {
  const mark = current === dest ? h`aria-current="page"` : h``;
  return h`<a class="nav-item" href="${href}" data-dest="${dest}" ${mark} title="${label}">${icon(drawing)}<span class="nav-label">${label}</span></a>`;
}

/**
 * The rail. **`mayFile` is required and has no default. Slice 6.9.**
 *
 * The documents tab and the lease-filing tab are gated, and the gate is `documents.write`: a VIEWER holds
 * `estate.read` and `documents.read` and nothing else, so an ungated tab would be a door that
 * answers `not_allowed` after somebody walked through it — which is exactly the refusal-after-typing
 * A11 refused to build for its own form. A required parameter rather than an optional one for 5.8's
 * reason: a default type-checks at every call site and renders the wrong rail, and the only way to
 * find that is by clicking.
 *
 * **The other six are ungated and three of them should not be** — `settings` is `settings.write` and
 * ADMIN-only, `staff` and `calls` are their own question. That is older than this slice and is not
 * widened by it; it is written up in `tasks/evidence/6.9.md` for the director.
 */
export function signedInChrome(
  csrf: string,
  dest: ChromeDest,
  mayFile: boolean,
): Html {
  return h`<nav aria-label="יעדי דלפק">
    ${item('estate', '/estate', 'בניינים', dest, h`<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" /><path d="M6 12h12" /><path d="M6 16h12" /><path d="M10 6h.01" /><path d="M14 6h.01" />`)}
    ${
      mayFile
        ? h`${item(
            'documents',
            // **Slice 7.1 moved this from `/documents/new` and renamed it.** The rail item was the
            // filing form itself, so the tab had no front page and the declaration the reader works
            // from was reachable from nowhere. It is a tab now: `מסמכים` is where the type and its
            // schema are read, and the filing form is a control on it.
            '/documents',
            'מסמכים',
            dest,
            h`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />`,
          )}${item(
            'filing',
            '/documents/filing',
            'תיוק חוזה',
            dest,
            h`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />`,
          )}`
        : h``
    }
    ${item('expiring', '/estate/expiring', 'חוזים מסתיימים', dest, h`<path d="M3 21h18" /><path d="M7 21V10" /><path d="M12 21V4" /><path d="M17 21v-7" />`)}
    ${item('incomplete', '/estate/incomplete', 'חוזים לא שלמים', dest, h`<path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" />`)}
    ${item('search', '/estate/search', 'חיפוש', dest, h`<circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />`)}
    ${item('staff', '/staff', 'צוות', dest, h`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />`)}
    ${item('calls', '/calls', 'קריאות', dest, h`<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />`)}
    ${item('settings', '/settings', 'הגדרות', dest, h`<circle cx="12" cy="12" r="3" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 19.1 1.4-1.4" /><path d="m17.7 6.3 1.4-1.4" />`)}
  </nav>
  <div class="ops-footer">
    <form class="sign-out" method="post" action="/staff/logout">
      <input type="hidden" name="${CSRF_FIELD}" value="${csrf}" />
      <button type="submit" class="nav-item" title="יציאה">
        ${icon(h`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />`)}
        <span class="nav-label">יציאה</span>
      </button>
    </form>
  </div>`;
}
