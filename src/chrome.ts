// The signed-in chrome. **Slice 5.2b, ops rail at 5.2c.**
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
  | 'expiring'
  | 'incomplete'
  | 'search'
  | 'staff';

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

export function signedInChrome(csrf: string, dest: ChromeDest): Html {
  return h`<nav aria-label="יעדי דלפק">
    ${item('estate', '/estate', 'בניינים', dest, h`<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" /><path d="M6 12h12" /><path d="M6 16h12" /><path d="M10 6h.01" /><path d="M14 6h.01" />`)}
    ${item('expiring', '/estate/expiring', 'חוזים מסתיימים', dest, h`<path d="M3 21h18" /><path d="M7 21V10" /><path d="M12 21V4" /><path d="M17 21v-7" />`)}
    ${item('incomplete', '/estate/incomplete', 'חוזים לא שלמים', dest, h`<path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" />`)}
    ${item('search', '/estate/search', 'חיפוש', dest, h`<circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />`)}
    ${item('staff', '/staff', 'צוות', dest, h`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />`)}
  </nav>
  <div class="ops-footer">
    <form class="sign-out" method="post" action="/staff/logout">
      <input type="hidden" name="${CSRF_FIELD}" value="${csrf}" />
      <button type="submit" class="nav-item" title="יציאה">
        ${icon(h`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />`)}
        <span class="nav-label">יציאה</span>
      </button>
    </form>
    <p class="ops-footer-note">היעדים האלה פתוחים. השאר נפתחים לפי סדר בניית המערכת.</p>
  </div>`;
}
