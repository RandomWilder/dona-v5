// The tenant host's one page. #272.
//
// There is no portal yet. The host has to answer something, or a tenant who opens it cannot tell
// the process is up from a process that is not. The office index stays on the office host; this
// page is the other one, and it carries no session and no household.
import { h } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';

export function renderPortalPlaceholder(): string {
  return renderPage({
    title: 'פורטל הדיירים',
    body: h`<div><h1>פורטל הדיירים</h1><p class="lede">הפורטל ייפתח כאן.</p></div>`,
  });
}
