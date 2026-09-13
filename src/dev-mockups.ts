// The painted flow, served in the live shell. **Slice 5.3, made literal at 6.1.**
//
// CLAUDE.md has said since week 5 that an unbuilt flow is painted as `mockups/<flow>.html` and
// served at `/dev/mockups/<flow>`, and `scripts/guards.ts`'s fourth guard scans that directory so a
// paint cannot outlive the slice that wired it. The route did not read that directory: it named two
// flows in a condition and rendered two TypeScript functions, whose slices (5.3, 5.8) had closed —
// so the guard sat idle over an empty directory while the paint lived in `src/`. A third hardcoded
// function at 6.1 would have widened that hole rather than used it.
//
// **The file is the paint.** It is a body fragment and not a document: the shell, the ops rail and
// the token stylesheet come from `renderPage`, which is the whole reason a mockup is reviewed here
// rather than opened off the filesystem — what the director clicks is the live chrome with a
// painted middle.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { signedInChrome } from './chrome.ts';
import { KernelError } from './kernel/errors.ts';
import { Html } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';

export const MOCKUPS_DIR = path.resolve(import.meta.dirname, '..', 'mockups');

// A flow name, and nothing that could be a path. The segment is the only request-supplied value
// that reaches the filesystem here, so it is bounded before it is joined and the join is checked
// afterwards — belt and braces, because a validator that is the only defence is one edit from being
// no defence.
const FLOW = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * The painted body for one flow, or `not_found`.
 *
 * **`new Html(...)` on bytes nobody escaped**, which `kernel/ui/html.ts` deliberately offers no
 * template hatch for. It is sound exactly here and nowhere else: the bytes are a file in this
 * repository, the route is registered only on a `-dev` process (`devMockups`), and the request
 * contributes nothing to the page but a segment that had to match `FLOW` and resolve inside
 * `mockups/`. A painted flow is authored markup by definition — it is the thing being reviewed.
 */
export function renderMockup(flow: string, csrf: string): string {
  if (!FLOW.test(flow)) {
    throw new KernelError('not_found', 'route not found');
  }
  const file = path.resolve(MOCKUPS_DIR, `${flow}.html`);
  if (file !== path.join(MOCKUPS_DIR, `${flow}.html`)) {
    throw new KernelError('not_found', 'route not found');
  }
  let painted: string;
  try {
    painted = readFileSync(file, 'utf8');
  } catch {
    // Deliberately the same answer an unknown flow gets. Which flows are painted right now is a
    // fact about unshipped work, and a dev route is still a route that says as little as it can.
    throw new KernelError('not_found', 'route not found');
  }
  return renderPage({
    title: `${flow} — הדמיה — דונה דום`,
    nav: signedInChrome(csrf, 'index'),
    body: new Html(painted),
  });
}
