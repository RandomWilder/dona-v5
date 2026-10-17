import type { Html } from '../../kernel/ui/html.ts';
import { h } from '../../kernel/ui/html.ts';
import { csrfInput } from '../../kernel/ui/page.ts';
import type { PolicySectionView } from './library.ts';

const styles = h`<style>
  .policy-library { display: grid; gap: var(--space-4); }
  .policy-library .block {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
  }
  .policy-library .block h2 { margin: 0; }
  .policy-library .docs {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .policy-library details {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-3);
    background: var(--color-surface-card);
  }
  .policy-library summary {
    cursor: pointer;
    min-height: var(--size-touch);
    display: flex;
    align-items: center;
  }
  .policy-library .passage {
    margin: 0;
    white-space: pre-wrap;
  }
  .policy-library form { display: grid; gap: var(--space-3); }
  .policy-library form label { display: grid; gap: var(--space-2); }
</style>`;

function shownDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

export function renderPolicyPage(
  library: readonly PolicySectionView[],
  options: { csrf: string; mayUpload: boolean },
): { title: string; styles: Html; body: Html } {
  const sections = library.map(
    (
      section,
    ) => h`<article class="glass block" data-section="${section.sectionKey}">
      <h2>${section.labelHe}</h2>
      <ul class="docs">
        ${section.documents.map(
          (document) => h`<li>
            <details>
              <summary data-effective-from="${document.effectiveFrom}">${document.title} · בתוקף מ־${shownDate(document.effectiveFrom)}</summary>
              ${document.passages.map(
                (passage) =>
                  h`<p class="passage" data-section="${passage.sectionKey}">${passage.body}</p>`,
              )}
            </details>
          </li>`,
        )}
      </ul>
    </article>`,
  );
  const upload = options.mayUpload
    ? h`<article class="glass block">
        <h2>העלאה</h2>
        <form method="post" action="/policy" enctype="multipart/form-data">
          ${csrfInput(options.csrf)}
          <label>מדור
            <select name="section_key">
              ${library.map(
                (section) =>
                  h`<option value="${section.sectionKey}">${section.labelHe}</option>`,
              )}
            </select>
          </label>
          <label>כותרת
            <input type="text" name="title" maxlength="80" required />
          </label>
          <label>בתוקף מ־
            <input type="date" name="effective_from" required />
          </label>
          <label>קובץ
            <input type="file" name="file" required />
          </label>
          <div>
            <button class="btn btn-primary" type="submit">העלאה</button>
          </div>
        </form>
      </article>`
    : h``;
  return {
    title: 'מדיניות',
    styles,
    body: h`<div class="policy-library glass-stage">
      <header class="page-head">
        <div>
          <h1>מדיניות</h1>
        </div>
      </header>
      ${sections}
      ${upload}
    </div>`,
  };
}
