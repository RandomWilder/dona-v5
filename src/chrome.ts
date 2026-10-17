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
import { type IconName, icon } from './kernel/ui/icons.ts';
import { CSRF_FIELD } from './kernel/ui/page.ts';

export type ChromeDest =
  | 'index'
  | 'estate'
  | 'inventory'
  // **Slice 6.9.** A12 was built at 6.3 and had one door — a card on the index — so the week-6 demo
  // walked from a building page, never passed the root again, and filed six documents through A1's
  // unit-first screen without once reaching the flow the room had asked for. A flow's entrance is
  // part of the flow.
  | 'documents'
  | 'filing'
  | 'expiring'
  | 'tenancies'
  | 'incomplete'
  | 'search'
  | 'staff'
  | 'calls'
  | 'policy'
  | 'settings'
  // **#202.** The אנשי קשר tab. Shown only when the role holds `party.read`.
  | 'parties';

function item(
  dest: Exclude<ChromeDest, 'index'>,
  href: string,
  label: string,
  current: ChromeDest,
  name: IconName,
  badge?: number,
): Html {
  const mark = current === dest ? h`aria-current="page"` : h``;
  const count =
    badge === undefined
      ? h``
      : h`<span class="nav-count" data-open-calls="${badge}">${badge}</span>`;
  return h`<a class="nav-item" href="${href}" data-dest="${dest}" ${mark} title="${label}">${icon(name)}<span class="nav-label">${label}</span>${count}</a>`;
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
 *
 * **`mayReadParties` is required, for `mayFile`'s reason.** #202. A default would type-check at
 * every existing call and hide the tab from an operator, or — if the default were true — show it
 * to a viewer. The route refuses either way; the rail is not the refusal.
 */
export function signedInChrome(
  csrf: string,
  dest: ChromeDest,
  mayFile: boolean,
  mayReadParties: boolean,
  openCalls?: number,
): Html {
  // **#172.** בניינים is hidden: served, linked from nowhere except the old pages and
  // A11/A13. `estate` stays a destination so those pages can ask for a current item and
  // find none. נכסים is the only estate tab.
  return h`<nav aria-label="יעדי דלפק">
    ${item('inventory', '/estate/inventory', 'נכסים', dest, 'layout')}
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
            'upload',
          )}${item('filing', '/documents/filing', 'תיוק חוזה', dest, 'file')}`
        : h``
    }
    ${item('expiring', '/estate/expiring', 'חוזים מסתיימים', dest, 'bars')}
    ${item('tenancies', '/estate/tenancies', 'שכירויות', dest, 'book')}
    ${item('incomplete', '/estate/incomplete', 'חוזים לא שלמים', dest, 'check')}
    ${item('search', '/estate/search', 'חיפוש', dest, 'search')}
    ${
      mayReadParties
        ? item('parties', '/parties', 'אנשי קשר', dest, 'user')
        : h``
    }
    ${item('staff', '/staff', 'צוות', dest, 'users')}
    ${item('calls', '/calls', 'קריאות', dest, 'phone', openCalls)}
    ${item('policy', '/policy', 'מדיניות', dest, 'book')}
    ${item('settings', '/settings', 'הגדרות', dest, 'sun')}
  </nav>
  <div class="ops-footer">
    <form class="sign-out" method="post" action="/staff/logout">
      <input type="hidden" name="${CSRF_FIELD}" value="${csrf}" />
      <button type="submit" class="nav-item" title="יציאה">
        ${icon('logout')}
        <span class="nav-label">יציאה</span>
      </button>
    </form>
  </div>`;
}
