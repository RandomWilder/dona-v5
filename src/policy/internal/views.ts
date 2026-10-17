import type { Html } from '../../kernel/ui/html.ts';
import { h } from '../../kernel/ui/html.ts';
import { csrfInput } from '../../kernel/ui/page.ts';
import type { PolicySectionView, PolicyVersionView } from './library.ts';

const styles = h`<style>
  .policy-library { display: grid; gap: var(--space-4); }
  .policy-library .block {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
  }
  .policy-library .block h2 { margin: 0; }
  .policy-library .document { display: grid; gap: var(--space-2); }
  .policy-library .document h3 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 500;
  }
  .policy-library .versions {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .policy-library .in-force { font-weight: 500; }
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
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
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

function versionLine(version: PolicyVersionView): Html {
  const until = version.effectiveTo
    ? h` · הוחלף ב־${shownDate(version.effectiveTo)}`
    : h``;
  const todayMark = version.inForce
    ? h` · <span class="in-force">בתוקף היום</span>`
    : h``;
  return h`בתוקף מ־${shownDate(version.effectiveFrom)}${until}${todayMark}`;
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
          (document) => h`<li class="document">
            <h3>${document.title}</h3>
            <ol class="versions">
              ${document.versions.map(
                (version) => h`<li data-in-force="${version.inForce}">
                  <details>
                    <summary data-effective-from="${version.effectiveFrom}" data-effective-to="${version.effectiveTo ?? ''}">${versionLine(version)}</summary>
                    ${version.passages.map(
                      (passage) =>
                        h`<p class="passage" data-section="${passage.sectionKey}">${passage.body}</p>`,
                    )}
                  </details>
                </li>`,
              )}
            </ol>
            ${
              options.mayUpload
                ? h`<form class="version-form" method="post" action="/policy" enctype="multipart/form-data">
                    ${csrfInput(options.csrf)}
                    <input type="hidden" name="section_key" value="${section.sectionKey}" />
                    <input type="hidden" name="title" value="${document.title}" />
                    <label>בתוקף מ־
                      <input type="date" name="effective_from" required />
                    </label>
                    <label>קובץ
                      <input type="file" name="file" required />
                    </label>
                    <div>
                      <button class="btn" type="submit">גרסה חדשה</button>
                    </div>
                  </form>`
                : h``
            }
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
