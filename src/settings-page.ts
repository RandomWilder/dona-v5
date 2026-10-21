// The settings screen. Slice 5.8 — A9's hand on the two catalogues.
//
// It lives beside `src/index-page.ts` and `src/app.ts` because it spans tenancy and evidence: an
// ObligationType is E10 and a DocumentType is E15, and neither module may own the other's rows. The
// kernel still learns no route. There is no third card for the role matrix (SPEC-staff.md) and no
// `asset_type` (estate's kinds are not a setting). Secret names wait; `settings.write` is who may
// change a reference when that editor arrives.
//
// Type rows only, plus the call Category list (#183). Natural key is the upsert identity: posting
// an existing `code` or `type_key` is an edit, never a second row. Category is the trade a call
// needs. It is not `asset_type`.
//
// **A field schema was a seed until slice 7.2 and is now a row an ADMIN writes** — at `/documents`,
// flow A14, under this same `settings.write`. Deliberately not a third card here: a declaration is
// read beside the screen that shows what the reader looks for, and this screen is the catalogue's
// index rather than a place any of it is worked on.

import type {
  CategoryRow,
  CategorySpec,
  EmergencySettings,
  HandlingGoal,
  ResponseGoal,
} from './calls/contract.ts';
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
  /** Whether this role may file a document — the rail's one gated destination (slice 6.9). */
  mayFile: boolean;
  /** Whether this role may open אנשי קשר — `party.read`. Required, for `mayFile`'s reason. */
  mayReadParties: boolean;
  /** Open ServiceCalls, for the rail count. Absent when the page is rendered outside a request. */
  openCalls?: number;
  state: 'wired' | 'painted';
  obligations: readonly ObligationTypeRow[];
  documents: readonly DocumentTypeRow[];
  categories: readonly CategoryRow[];
  emergency: EmergencySettings;
  goal: ResponseGoal;
  handling: HandlingGoal;
  nonWorkingDates: readonly string[];
  saved?:
    | 'obligation'
    | 'document'
    | 'category'
    | 'emergency'
    | 'goal'
    | 'handling'
    | 'dates';
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

function emergencyForm(screen: SettingsScreen): Html {
  const duty = screen.emergency;
  if (!screen.mayWrite) {
    return h`<dl class="facts">
      <div><dt>מונחים</dt><dd>${duty.termsText}</dd></div>
      <div><dt>טלפון כונן</dt><dd dir="ltr">${duty.phone}</dd></div>
      <div><dt>שעות כונן</dt><dd>${duty.hours}</dd></div>
    </dl>`;
  }
  return h`<form class="settings-form" method="post" action="/settings/emergency">
    ${csrfInput(screen.csrf)}
    <h2>כונן ומונחי חירום</h2>
    <p class="lede">שורה לכל מונח. נכנס לתוקף בלי העלאה.</p>
    <div class="field">
      <label for="em-terms">מונחים</label>
      <textarea id="em-terms" name="emergency_terms" rows="6" maxlength="4000">${duty.termsText}</textarea>
    </div>
    <div class="field">
      <label for="em-phone">טלפון כונן</label>
      <input id="em-phone" name="duty_phone" type="text" dir="ltr" required maxlength="40" value="${duty.phone}" />
    </div>
    <div class="field">
      <label for="em-hours">שעות כונן</label>
      <input id="em-hours" name="duty_hours" type="text" required maxlength="200" value="${duty.hours}" />
    </div>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

function goalForm(screen: SettingsScreen): Html {
  const goal = screen.goal;
  if (!screen.mayWrite) {
    return h`<dl class="facts">
      <div><dt>כתום</dt><dd>${String(goal.amberMinutes)} דקות</dd></div>
      <div><dt>אדום</dt><dd>${String(goal.redMinutes)} דקות</dd></div>
    </dl>`;
  }
  return h`<form class="settings-form" method="post" action="/settings/response-goal">
    ${csrfInput(screen.csrf)}
    <h2>יעד מענה פנימי</h2>
    <p class="lede">לקריאת חירום. דקות שלמות. לא מוצג לדייר. נכנס לתוקף בלי העלאה.</p>
    <div class="field">
      <label for="goal-amber">כתום (דקות)</label>
      <input id="goal-amber" name="amber_minutes" type="text" inputmode="numeric" dir="ltr" required maxlength="6" value="${String(goal.amberMinutes)}" />
    </div>
    <div class="field">
      <label for="goal-red">אדום (דקות)</label>
      <input id="goal-red" name="red_minutes" type="text" inputmode="numeric" dir="ltr" required maxlength="6" value="${String(goal.redMinutes)}" />
    </div>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

function shownDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function handlingForm(screen: SettingsScreen): Html {
  const handling = screen.handling;
  if (!screen.mayWrite) {
    return h`<dl class="facts">
      <div><dt>כתום</dt><dd>${String(handling.amberDays)} ימים</dd></div>
      <div><dt>אדום</dt><dd>${String(handling.redDays)} ימים</dd></div>
    </dl>`;
  }
  return h`<form class="settings-form" method="post" action="/settings/handling-clock">
    ${csrfInput(screen.csrf)}
    <h2>סף טיפול</h2>
    <p class="lede">לקריאה שאינה חירום. ימי עסקים שלמים. לא מוצג לדייר. נכנס לתוקף בלי העלאה.</p>
    <div class="field">
      <label for="handling-amber">כתום (ימים)</label>
      <input id="handling-amber" name="amber_days" type="text" inputmode="numeric" dir="ltr" required maxlength="3" value="${String(handling.amberDays)}" />
    </div>
    <div class="field">
      <label for="handling-red">אדום (ימים)</label>
      <input id="handling-red" name="red_days" type="text" inputmode="numeric" dir="ltr" required maxlength="3" value="${String(handling.redDays)}" />
    </div>
    <button class="btn btn-primary" type="submit">שמירה</button>
  </form>`;
}

function dateRow(screen: SettingsScreen, iso: string): Html {
  const label = h`<span dir="ltr">${shownDate(iso)}</span>`;
  if (!screen.mayWrite)
    return h`<article class="type-card"><h2>${label}</h2></article>`;
  return h`<article class="type-card">
    <h2>${label}</h2>
    <form method="post" action="/settings/non-working-dates">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="op" value="remove" />
      <input type="hidden" name="date" value="${iso}" />
      <button class="btn" type="submit">הסרה</button>
    </form>
  </article>`;
}

function datesBlock(screen: SettingsScreen): Html {
  const rows =
    screen.nonWorkingDates.length === 0
      ? h`<p class="lede">אין ימים לא עובדים.</p>`
      : h`<div class="row-list">${screen.nonWorkingDates.map((iso) => dateRow(screen, iso))}</div>`;
  if (!screen.mayWrite) return rows;
  return h`${rows}
    <form class="settings-form" method="post" action="/settings/non-working-dates">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="op" value="add" />
      <h2>יום לא עובד</h2>
      <p class="lede">תאריך ביומן. יום ו׳ ושבת כבר אינם ימי עסקים.</p>
      <div class="field">
        <label for="non-working-date">תאריך</label>
        <input id="non-working-date" name="date" type="date" dir="ltr" required />
      </div>
      <button class="btn btn-primary" type="submit">הוספה</button>
    </form>`;
}

function categoryForm(csrf: string): Html {
  return h`<form class="settings-form" method="post" action="/settings/categories">
    ${csrfInput(csrf)}
    <h2>קטגוריה חדשה</h2>
    <p class="lede">קוד קיים מעדכן את השורה. אין מחיקה — רק כיבוי. זה לא סוג נכס.</p>
    <div class="field">
      <label for="cat-code">קוד</label>
      <input id="cat-code" name="code" type="text" dir="ltr" required maxlength="64" />
    </div>
    <div class="field">
      <label for="cat-he">שם בעברית</label>
      <input id="cat-he" name="label_he" type="text" required maxlength="120" />
    </div>
    <div class="field">
      <label for="cat-en">שם באנגלית</label>
      <input id="cat-en" name="label_en" type="text" dir="ltr" maxlength="120" />
    </div>
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
    <p class="lede">מפתח קיים מעדכן את השורה. שדות לחילוץ נערכים במסך <a href="/documents">מסמכים</a>.</p>
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
  const writeCat = screen.mayWrite ? categoryForm(screen.csrf) : h``;
  const body = h`
    <div class="settings" data-state="${screen.state}">
      <div>
        <h1>הגדרות</h1>
        <p class="lede">קטלוגים. סוג נכס אינו כאן. מטריצת ההרשאות אינה כאן.</p>
        ${saved}
      </div>
      <section class="settings-block">
        <h2>חירום</h2>
        ${emergencyForm(screen)}
      </section>
      <section class="settings-block">
        <h2>יעד מענה</h2>
        ${goalForm(screen)}
      </section>
      <section class="settings-block">
        <h2>ימי עסקים</h2>
        ${handlingForm(screen)}
        ${datesBlock(screen)}
      </section>
      <section class="settings-block">
        <h2>קטגוריות לקריאות</h2>
        <div class="row-list">
          ${screen.categories.map(
            (row) => h`<article class="type-card">
              <h2><span dir="ltr">${row.code}</span> · ${row.labelHe}</h2>
              <dl class="facts">
                <div><dt>מצב</dt><dd>${active(row.isActive)}</dd></div>
              </dl>
            </article>`,
          )}
        </div>
        ${writeCat}
      </section>
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
    nav: signedInChrome(
      screen.csrf,
      'settings',
      screen.mayFile,
      screen.mayReadParties,
      screen.openCalls,
    ),
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

function wholeMinutesField(body: unknown, name: string, field: string): number {
  const raw = (body as Form | undefined)?.[name];
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) {
    throw new KernelError('invalid', `${field} must be whole minutes`, {
      field,
    });
  }
  return Number(raw.trim());
}

export function parseResponseGoalForm(body: unknown): {
  amberMinutes: number;
  redMinutes: number;
} {
  return {
    amberMinutes: wholeMinutesField(body, 'amber_minutes', 'amber'),
    redMinutes: wholeMinutesField(body, 'red_minutes', 'red'),
  };
}

function wholeDaysField(body: unknown, name: string, field: string): number {
  const raw = (body as Form | undefined)?.[name];
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw.trim())) {
    throw new KernelError('invalid', `${field} must be whole business days`, {
      field,
    });
  }
  return Number(raw.trim());
}

export function parseHandlingGoalForm(body: unknown): {
  amberDays: number;
  redDays: number;
} {
  return {
    amberDays: wholeDaysField(body, 'amber_days', 'amber'),
    redDays: wholeDaysField(body, 'red_days', 'red'),
  };
}

export function parseNonWorkingDateForm(body: unknown): {
  op: 'add' | 'remove';
  date: string;
} {
  const op = field(body, 'op', 8);
  if (op !== 'add' && op !== 'remove') {
    throw new KernelError('invalid', 'op is not add or remove', {
      field: 'op',
    });
  }
  return { op, date: field(body, 'date', 10) };
}

export function parseEmergencyForm(body: unknown): {
  termsText: string;
  phone: string;
  hours: string;
} {
  return {
    termsText: optionalField(body, 'emergency_terms', 4000) ?? '',
    phone: field(body, 'duty_phone', 40),
    hours: field(body, 'duty_hours', 200),
  };
}

export function parseCategoryForm(body: unknown): CategorySpec {
  return {
    code: field(body, 'code', 64),
    labelHe: field(body, 'label_he', 120),
    labelEn: optionalField(body, 'label_en', 120),
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
