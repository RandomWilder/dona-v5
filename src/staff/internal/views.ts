// The staff screens. Slice 5.1 — the first screens in this system that exist to decide who is
// looking, rather than to show what is there. **Slice 5.1b deleted four of the six**: the password
// form, the second-factor form, the enrolment screen and the invite-acceptance screen all existed
// to manage a credential this system no longer holds any part of (ADR-0005).
//
// **Two screens and not one line of client JavaScript**, which is the rule SPEC.md states and
// tests/ui/tokens.test.ts fails the build over. That rule decided the second factor at 5.1 — SMS
// would have needed a reCAPTCHA token minted by Google's browser SDK — and it outlives the second
// factor: the OIDC flow here is a plain redirect precisely so these screens stay HTML.
//
// **No screen here ever says why it refused.** One frozen sentence covers a wrong password, a wrong
// code, an account with no role and an account that does not exist, because the alternative is an
// account-enumeration oracle on the login page of a system holding 1,500 households.
//
// Every colour, face, radius and measure is a token; the CSS below is layout for these pages only.

import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import type { Permission, Role } from './roles.ts';

const styles = h`<style>
  .auth {
    max-width: min(var(--size-form-max), 100%);
    margin-inline: auto;
    display: grid;
    gap: var(--space-4);
  }
  .auth-card {
    background: var(--color-surface);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    display: grid;
    gap: var(--space-4);
  }
  .field { display: grid; gap: var(--space-2); }
  .field label { color: var(--color-text-muted); font-size: var(--text-sm); }
  .field input {
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-1);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: var(--text-body);
    inline-size: 100%;
    box-sizing: border-box;
  }
  .refusal {
    border: 1px solid var(--color-alert);
    border-radius: var(--radius-1);
    padding: var(--space-3);
    color: var(--color-alert);
    font-size: var(--text-sm);
  }
  .note { color: var(--color-text-muted); font-size: var(--text-sm); margin: 0; }
  .secret {
    background: var(--color-surface-card);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-1);
    padding: var(--space-3);
    font-size: var(--text-body);
    word-break: break-all;
    letter-spacing: 0.08em;
  }
  .perm-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; }
  .perm-list li { list-style: none; }
  .perm {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .identity-row {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    flex-wrap: wrap;
  }
</style>`;

function page(title: string, body: Html): string {
  // No nav. Every one of these screens is reached without a session or is the session's own page,
  // and a chrome bar linking to the estate from the login screen would be a link to a refusal.
  return renderPage({ title, styles, body });
}

function refusal(message: string | undefined): Html {
  return message === undefined ? h`` : h`<p class="refusal">${message}</p>`;
}

/** The one sentence, in Hebrew, for every cause. See the file header. */
export const REFUSED_HE = 'לא ניתן להיכנס.';

export interface LoginScreen {
  refused?: string;
  /** No OAuth client in this environment. Said out loud rather than answered as a failed sign-in. */
  unconfigured?: boolean;
}

export function renderLoginPage(screen: LoginScreen = {}): string {
  const start =
    screen.unconfigured === true
      ? h``
      : h`<div class="auth-card">
            <p class="note">הכניסה היא דרך חשבון Google. אין כאן סיסמה ואין קוד.</p>
            <p><a class="btn btn-primary" href="/staff/auth/start">המשך עם Google</a></p>
          </div>`;
  const body = h`
    <div class="auth">
      <div>
        <h1>כניסת צוות</h1>
        <p class="lede">מערכת דונה דום · ניהול נכסים</p>
      </div>
      ${screen.unconfigured === true ? h`<p class="refusal">שירות הזהויות אינו מוגדר בסביבה הזו.</p>` : refusal(screen.refused)}
      ${start}
      <p class="note">רק כתובת שכבר נמצאת ברשימת המשתמשים יכולה להיכנס.</p>
    </div>`;
  return page('דונה דום — כניסת צוות', body);
}

export interface StaffHomeScreen {
  /** Slice 5.2b. Login does not receive this. */
  nav: Html;
  /** The CSRF token for this session (slice 5.2). Both forms on this screen carry it. */
  csrf: string;
  email: string;
  role: Role;
  permissions: readonly Permission[];
  mayInvite: boolean;
  /** The operator just added. There is no URL to hand over, because there is nothing to deliver. */
  addedOperator?: { email: string; role: Role; created: boolean };
  refused?: string;
}

export function renderStaffHomePage(screen: StaffHomeScreen): string {
  const invite = screen.mayInvite
    ? h`<form class="auth-card" method="post" action="/staff/operators">
          ${csrfInput(screen.csrf)}
          <h2>הוספת משתמש</h2>
          <div class="field">
            <label for="invite-email">דואר אלקטרוני</label>
            <input id="invite-email" name="email" type="email" dir="ltr" required />
          </div>
          <div class="field">
            <label for="invite-role">הרשאה</label>
            <input id="invite-role" name="role" type="text" dir="ltr"
                   value="OPERATOR" required />
          </div>
          <button class="btn btn-primary" type="submit">הוספה</button>
          <p class="note">הוספה של כתובת שכבר קיימת מעבירה את ההרשאה ואינה יוצרת משתמש שני.</p>
        </form>`
    : h``;
  const issued =
    screen.addedOperator === undefined
      ? h``
      : h`<div class="auth-card">
            <h2>${screen.addedOperator.created ? 'המשתמש נוסף' : 'ההרשאה עודכנה'}</h2>
            <p class="note">
              <span dir="ltr">${screen.addedOperator.email}</span> · ${screen.addedOperator.role}
            </p>
            <p class="note">אין קישור להעביר: המשתמש נכנס עם חשבון ה־Google שלו.</p>
          </div>`;
  const body = h`
    <div class="auth">
      <div>
        <h1>הצוות</h1>
        <p class="lede identity-row">
          <span dir="ltr">${screen.email}</span>
          <span>·</span>
          <span>${screen.role}</span>
        </p>
      </div>
      ${refusal(screen.refused)}
      <div class="auth-card">
        <h2>מה מותר לכם</h2>
        <ul class="perm-list">
          ${screen.permissions.map((permission) => h`<li><span class="perm" dir="ltr">${permission}</span></li>`)}
        </ul>
        <p class="note">מטריצת ההרשאות היא קוד ולא שורה בבסיס נתונים; שינוי שלה עולה פריסה.</p>
      </div>
      ${issued}
      ${invite}
    </div>`;
  return renderPage({
    title: 'דונה דום — הצוות',
    styles,
    nav: screen.nav,
    body,
  });
}
