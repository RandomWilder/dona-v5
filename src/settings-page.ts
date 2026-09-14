// The settings screen. Slice 5.8 — A9's hand on the two catalogues.
//
// It lives beside `src/index-page.ts` and `src/app.ts` because it spans tenancy and evidence: an
// ObligationType is E10 and a DocumentType is E15, and neither module may own the other's rows. The
// kernel still learns no route. There is no third card for the role matrix (SPEC-staff.md) and no
// `asset_type` (estate's kinds are not a setting). Secret names wait; `settings.write` is who may
// change a reference when that editor arrives.
//
// Type rows only. A field schema is still a seed. Natural key is the upsert identity: posting an
// existing `code` or `type_key` is an edit, never a second row.

import { signedInChrome } from './chrome.ts';
import type { DocumentTypeRow, DocumentTypeSpec } from './evidence/contract.ts';
import { KernelError } from './kernel/errors.ts';
import { type Html, h } from './kernel/ui/html.ts';
import { csrfInput, renderPage } from './kernel/ui/page.ts';
import { optionalText, requireText } from './kernel/validate.ts';
import type {
  ObligationTypeRow,
  ObligationTypeSpec,
  ResponsibleParty,
} from './tenancy/contract.ts';

export interface SettingsScreen {
  csrf: string;
  mayWrite: boolean;
  state: 'wired' | 'painted';
  obligations: readonly ObligationTypeRow[];
  documents: readonly DocumentTypeRow[];
  saved?: 'obligation' | 'document';
}

const styles = h`<style>
  .settings { display: grid; gap: var(--space-6); max-width: var(--size-shell-max); }
  .settings-block { display: grid; gap: var(--space-4); }
  .settings-form, .type-card {
    display: grid;
    gap: var(--space-3);
    background: var(--color-surface-card);
    border: var(--size-hairline) solid var(--color-divider-soft);
    border-radius: var(--radius-3);
    padding: var(--space-4) var(--space-5);
  }
  .settings-form h2, .type-card h2 { margin: 0; }
</style>`;

const PARTY_HE: Record<ResponsibleParty, string> = {
  TENANT: 'דייר',
  OPERATOR: 'מפעיל',
};

function flag(on: boolean): string {
  return on ? 'כן' : 'לא';
}

function active(on: boolean): string {
  return on ? 'פעיל' : 'לא פעיל';
}

function obligationForm(csrf: string): Html {
  return h`<form class="settings-form" method="post" action="/settings/obligation-types">
    ${csrfInput(csrf)}
    <h2>סוג התחייבות חדש</h2>
    <p class="lede">קוד קיים מעדכן את השורה. אין מחיקה — רק כיבוי.</p>
    <div class="field">
      <label for="ob-code">קוד</label>
      <input id="ob-code" name="code" type="text" dir="ltr" required maxlength="64" />
    </div>
    <div class="field">
      <label for="ob-he">שם בעברית</label>
      <input id="ob-he" name="label_he" type="text" required maxlength="120" />
    </div>
    <div class="field">
      <label for="ob-en">שם באנגלית</label>
      <input id="ob-en" name="label_en" type="text" dir="ltr" maxlength="120" />
    </div>
    <div class="field">
      <label for="ob-party">אחראי כברירת מחדל</label>
      <select id="ob-party" name="default_responsible_party" required>
        <option value="TENANT">דייר</option>
        <option value="OPERATOR">מפעיל</option>
      </select>
    </div>
    <label class="check">
      <input type="checkbox" name="requires_evidence" value="true" />
      נדרש מסמך
    </label>
    <label class="check">
      <input type="checkbox" name="is_active" value="true" checked />
      פעיל
    </label>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

function documentForm(csrf: string): Html {
  return h`<form class="settings-form" method="post" action="/settings/document-types">
    ${csrfInput(csrf)}
    <h2>סוג מסמך חדש</h2>
    <p class="lede">מפתח קיים מעדכן את השורה. שדות לחילוץ נשארים בזרע.</p>
    <div class="field">
      <label for="dt-key">מפתח</label>
      <input id="dt-key" name="type_key" type="text" dir="ltr" required maxlength="64" />
    </div>
    <div class="field">
      <label for="dt-he">שם בעברית</label>
      <input id="dt-he" name="label_he" type="text" required maxlength="120" />
    </div>
    <div class="field">
      <label for="dt-en">שם באנגלית</label>
      <input id="dt-en" name="label_en" type="text" dir="ltr" maxlength="120" />
    </div>
    <div class="field">
      <label for="dt-terms">מילות אימות</label>
      <textarea id="dt-terms" name="verification_terms" rows="3" maxlength="2000"></textarea>
      <p class="lede">שורה לכל דרישה; קו אנכי (|) מפריד בין ניסוחים חלופיים של אותה דרישה. ריק — סוג בלי שומר.</p>
    </div>
    <label class="check">
      <input type="checkbox" name="is_active" value="true" checked />
      פעיל
    </label>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

export function renderSettingsPage(screen: SettingsScreen): string {
  const saved = screen.saved === undefined ? h`` : h`<p class="lede">נשמר.</p>`;
  const writeOb = screen.mayWrite ? obligationForm(screen.csrf) : h``;
  const writeDoc = screen.mayWrite ? documentForm(screen.csrf) : h``;
  const body = h`
    <div class="settings" data-state="${screen.state}">
      <div>
        <h1>הגדרות</h1>
        <p class="lede">שני קטלוגים. סוג נכס אינו כאן. מטריצת ההרשאות אינה כאן.</p>
        ${saved}
      </div>
      <section class="settings-block">
        <h2>התחייבויות</h2>
        <div class="row-list">
          ${screen.obligations.map(
            (row) => h`<article class="type-card">
              <h2><span dir="ltr">${row.code}</span> · ${row.labelHe}</h2>
              <dl class="facts">
                <div><dt>אחראי</dt><dd>${PARTY_HE[row.defaultResponsibleParty]}</dd></div>
                <div><dt>מסמך</dt><dd>${flag(row.requiresEvidence)}</dd></div>
                <div><dt>מצב</dt><dd>${active(row.isActive)}</dd></div>
              </dl>
            </article>`,
          )}
        </div>
        ${writeOb}
      </section>
      <section class="settings-block">
        <h2>מסמכים</h2>
        <div class="row-list">
          ${screen.documents.map(
            (row) => h`<article class="type-card">
              <h2><span dir="ltr">${row.typeKey}</span> · ${row.labelHe}</h2>
              <dl class="facts">
                <div><dt>מצב</dt><dd>${active(row.isActive)}</dd></div>
              </dl>
            </article>`,
          )}
        </div>
        ${writeDoc}
      </section>
    </div>`;
  return renderPage({
    title: 'הגדרות — דונה דום',
    styles,
    nav: signedInChrome(screen.csrf, 'settings'),
    body,
  });
}

type Form = Record<string, string | undefined>;

function field(body: unknown, name: string, max: number): string {
  return requireText((body as Form | undefined)?.[name], name, max);
}

function optionalField(
  body: unknown,
  name: string,
  max: number,
): string | null {
  const raw = (body as Form | undefined)?.[name];
  if (raw === undefined || raw.trim() === '') return null;
  return optionalText(raw, name, max);
}

function checked(body: unknown, name: string): boolean {
  const raw = (body as Form | undefined)?.[name];
  return raw === 'true' || raw === 'on';
}

function responsibleParty(body: unknown): ResponsibleParty {
  const value = field(body, 'default_responsible_party', 16);
  if (value !== 'TENANT' && value !== 'OPERATOR') {
    throw new KernelError(
      'invalid',
      'default_responsible_party is not a party',
    );
  }
  return value;
}

function terms(body: unknown): string[] | null {
  const raw = optionalField(body, 'verification_terms', 2000);
  if (raw === null) return null;
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts;
}

export function parseObligationTypeForm(body: unknown): ObligationTypeSpec {
  return {
    code: field(body, 'code', 64),
    labelHe: field(body, 'label_he', 120),
    labelEn: optionalField(body, 'label_en', 120),
    defaultResponsibleParty: responsibleParty(body),
    requiresEvidence: checked(body, 'requires_evidence'),
    isActive: checked(body, 'is_active'),
  };
}

export function parseDocumentTypeForm(body: unknown): DocumentTypeSpec {
  return {
    typeKey: field(body, 'type_key', 64),
    labelHe: field(body, 'label_he', 120),
    labelEn: optionalField(body, 'label_en', 120),
    verificationTerms: terms(body),
    isActive: checked(body, 'is_active'),
  };
}
