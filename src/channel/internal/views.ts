// The dev-only form that pushes a fabricated message through the door. #186.
// A stamped revision does not register the route that renders this.

import type { CategoryRow } from '../../calls/contract.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';

export interface IntakeFormScreen {
  nav: Html;
  csrf: string;
  categories: readonly CategoryRow[];
  stored: boolean;
  refusal?: string;
}

const styles = h`<style>
  .intake { display: grid; gap: var(--space-6); }
  .intake .call-form { display: grid; gap: var(--space-4); padding: var(--space-5); }
  .intake .field, .intake .choice {
    display: grid;
    gap: var(--space-2);
    border: 0;
    padding: 0;
    margin: 0;
    background: transparent;
  }
  .intake .choice { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: center; }
  .intake .refusal { margin: 0; color: var(--color-alert); }
</style>`;

export function renderIntakeForm(screen: IntakeFormScreen): string {
  const refusal =
    screen.refusal === undefined
      ? h``
      : h`<p class="refusal">${screen.refusal}</p>`;
  const stored = screen.stored ? h`<p class="lede">נשמרה, בלי קריאה.</p>` : h``;
  const body = h`
    <div class="intake glass-stage">
      <header class="page-head">
        <div>
          <p class="back"><a href="/calls">קריאות</a></p>
          <h1>הודעת בדיקה</h1>
          <p class="lede">רק בסביבת פיתוח. המסווג כאן הוא בחירה, לא מודל.</p>
          ${stored}
        </div>
      </header>
      <form class="glass call-form" method="post" action="/dev/intake">
        ${csrfInput(screen.csrf)}
        ${refusal}
        <fieldset class="choice">
          <legend>ערוץ</legend>
          <label><input type="radio" name="channel" value="EMAIL" required /> דוא״ל</label>
          <label><input type="radio" name="channel" value="WHATSAPP" /> וואטסאפ</label>
        </fieldset>
        <div class="field">
          <label for="intake-sender">כתובת השולח</label>
          <input id="intake-sender" name="sender" type="text" maxlength="320" required autocomplete="off" />
        </div>
        <div class="field">
          <label for="intake-thread">שיחה</label>
          <input id="intake-thread" name="thread" type="text" maxlength="500" autocomplete="off" />
        </div>
        <div class="field">
          <label for="intake-subject">נושא</label>
          <input id="intake-subject" name="subject" type="text" maxlength="500" autocomplete="off" />
        </div>
        <div class="field">
          <label for="intake-body">הודעה</label>
          <textarea id="intake-body" name="body" rows="4" required></textarea>
        </div>
        <div class="field">
          <label for="intake-file">שם קובץ</label>
          <input id="intake-file" name="file" type="text" maxlength="200" autocomplete="off" />
        </div>
        <fieldset class="choice">
          <legend>פסק המסווג</legend>
          <label><input type="radio" name="verdict" value="call" required /> קריאה</label>
          <label><input type="radio" name="verdict" value="unsure" /> לא בטוח</label>
          <label><input type="radio" name="verdict" value="noise" /> רעש</label>
          <label><input type="radio" name="verdict" value="failure" /> כשל</label>
        </fieldset>
        <div class="field">
          <label for="intake-category">הצעת קטגוריה</label>
          <select id="intake-category" name="category">
            <option value="">בלי</option>
            ${screen.categories.map(
              (category) =>
                h`<option value="${category.code}">${category.labelHe}</option>`,
            )}
          </select>
        </div>
        <div class="field">
          <label for="intake-summary">סיכום</label>
          <input id="intake-summary" name="summary" type="text" maxlength="500" autocomplete="off" />
        </div>
        <label><input type="checkbox" name="echo" value="1" /> הד מהמשרד</label>
        <button class="btn btn-primary" type="submit">שליחה</button>
      </form>
    </div>`;
  return renderPage({
    title: 'הודעת בדיקה — דונה דום',
    styles,
    nav: screen.nav,
    body,
  });
}
