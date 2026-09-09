// The staff screens. Slice 5.1 — the first screens in this system that exist to decide who is
// looking, rather than to show what is there.
//
// **Six screens and not one line of client JavaScript**, which is the rule SPEC.md states and
// tests/ui/tokens.test.ts fails the build over. It is also the reason the second factor is TOTP
// rather than SMS: Identity Platform's SMS factor needs a reCAPTCHA token minted by Google's
// browser SDK, and buying it would have put the system's first `<script>` on the screens that guard
// everything else (SPEC-staff.md).
//
// **No screen here ever says why it refused.** One frozen sentence covers a wrong password, a wrong
// code, an account with no role and an account that does not exist, because the alternative is an
// account-enumeration oracle on the login page of a system holding 1,500 households.
//
// Every colour, face, radius and measure is a token; the CSS below is layout for these pages only.
import { type Html, h } from '../../kernel/ui/html.ts';
import { renderPage } from '../../kernel/ui/page.ts';
import type { Permission, Role } from './roles.ts';

const styles = h`<style>
  .auth {
    max-width: var(--size-form-max);
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
  button {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-1);
    background: var(--color-chrome);
    color: var(--color-on-chrome);
    font-size: var(--text-body);
    cursor: pointer;
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
  /** No API key in this environment. Said out loud rather than answered as a wrong password. */
  unconfigured?: boolean;
}

export function renderLoginPage(screen: LoginScreen = {}): string {
  const body = h`
    <div class="auth">
      <div>
        <h1>כניסת צוות</h1>
        <p class="lede">מערכת דונה דום · ניהול נכסים</p>
      </div>
      ${screen.unconfigured === true ? h`<p class="refusal">שירות הזהויות אינו מוגדר בסביבה הזו.</p>` : refusal(screen.refused)}
      <form class="auth-card" method="post" action="/staff/login">
        <div class="field">
          <label for="email">דואר אלקטרוני</label>
          <input id="email" name="email" type="email" dir="ltr" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">סיסמה</label>
          <input id="password" name="password" type="password" dir="ltr" autocomplete="current-password" required />
        </div>
        <button type="submit">המשך</button>
      </form>
      <p class="note">הכניסה מחייבת גורם שני. חשבון ללא גורם שני אינו יכול להיכנס.</p>
    </div>`;
  return page('דונה דום — כניסת צוות', body);
}

export interface SecondFactorScreen {
  /**
   * Google's short-lived credential for the half-finished sign-in, carried in a hidden field.
   * **It never enters this system's database** — that is what keeps "no token value exists anywhere
   * in the database" true, and it goes straight back to Google (SPEC-staff.md).
   */
  pendingCredential: string;
  enrollmentId: string;
  refused?: string;
}

export function renderSecondFactorPage(screen: SecondFactorScreen): string {
  const body = h`
    <div class="auth">
      <div>
        <h1>הגורם השני</h1>
        <p class="lede">הזינו את הקוד מאפליקציית האימות שלכם.</p>
      </div>
      ${refusal(screen.refused)}
      <form class="auth-card" method="post" action="/staff/login/verify">
        <input type="hidden" name="pending" value="${screen.pendingCredential}" />
        <input type="hidden" name="enrollment" value="${screen.enrollmentId}" />
        <div class="field">
          <label for="code">קוד בן שש ספרות</label>
          <input id="code" name="code" type="text" dir="ltr" inputmode="numeric"
                 autocomplete="one-time-code" maxlength="6" required />
        </div>
        <button type="submit">כניסה</button>
      </form>
    </div>`;
  return page('דונה דום — הגורם השני', body);
}

export interface InviteScreen {
  token: string;
  email: string;
  role: Role;
  refused?: string;
}

export function renderInvitePage(screen: InviteScreen): string {
  const body = h`
    <div class="auth">
      <div>
        <h1>הצטרפות לצוות</h1>
        <p class="lede">
          הזמנה עבור <span dir="ltr">${screen.email}</span> · הרשאה ${screen.role}
        </p>
      </div>
      ${refusal(screen.refused)}
      <form class="auth-card" method="post" action="/staff/invite/${screen.token}">
        <div class="field">
          <label for="password">בחרו סיסמה</label>
          <input id="password" name="password" type="password" dir="ltr"
                 autocomplete="new-password" minlength="12" required />
        </div>
        <button type="submit">המשך לרישום הגורם השני</button>
      </form>
      <p class="note">לפחות שתים־עשרה תווים. בשלב הבא תרשמו אפליקציית אימות; ההרשאה נכנסת לתוקף רק בסיומו.</p>
    </div>`;
  return page('דונה דום — הצטרפות לצוות', body);
}

export interface EnrolScreen {
  token: string;
  email: string;
  /** Base32, exactly as Google returned it — which is why this module carries no encoder. */
  sharedSecretKey: string;
  otpauthUri: string;
  sessionInfo: string;
  idToken: string;
  refused?: string;
}

export function renderEnrolPage(screen: EnrolScreen): string {
  const body = h`
    <div class="auth">
      <div>
        <h1>רישום הגורם השני</h1>
        <p class="lede">הוסיפו את המפתח לאפליקציית האימות, ואשרו בקוד הראשון.</p>
      </div>
      ${refusal(screen.refused)}
      <div class="auth-card">
        <div class="field">
          <label>מפתח משותף</label>
          <p class="secret" dir="ltr">${screen.sharedSecretKey}</p>
        </div>
        <div class="field">
          <label>או כתובת מלאה להעתקה</label>
          <p class="secret" dir="ltr">${screen.otpauthUri}</p>
        </div>
      </div>
      <form class="auth-card" method="post" action="/staff/invite/${screen.token}/enrol">
        <input type="hidden" name="session_info" value="${screen.sessionInfo}" />
        <input type="hidden" name="id_token" value="${screen.idToken}" />
        <div class="field">
          <label for="code">הקוד הראשון</label>
          <input id="code" name="code" type="text" dir="ltr" inputmode="numeric"
                 autocomplete="one-time-code" maxlength="6" required />
        </div>
        <button type="submit">סיום הרישום</button>
      </form>
      <p class="note">אין כאן קוד QR בכוונה: המסכים במערכת הזו אינם מריצים קוד בדפדפן.</p>
    </div>`;
  return page('דונה דום — רישום הגורם השני', body);
}

export function renderEnrolledPage(email: string): string {
  const body = h`
    <div class="auth">
      <div>
        <h1>הרישום הושלם</h1>
        <p class="lede"><span dir="ltr">${email}</span> — ההרשאה נכנסה לתוקף.</p>
      </div>
      <div class="auth-card">
        <p class="note">היכנסו עכשיו עם הסיסמה והקוד מאפליקציית האימות.</p>
        <p><a href="/staff/login">למסך הכניסה</a></p>
      </div>
    </div>`;
  return page('דונה דום — הרישום הושלם', body);
}

export interface StaffHomeScreen {
  email: string;
  role: Role;
  permissions: readonly Permission[];
  mayInvite: boolean;
  /** Shown once, on the page that created it. The row keeps only a hash (SPEC-staff.md). */
  issuedInviteUrl?: string;
  refused?: string;
}

export function renderStaffHomePage(screen: StaffHomeScreen): string {
  const invite = screen.mayInvite
    ? h`<form class="auth-card" method="post" action="/staff/invites">
          <h2>הזמנת משתמש</h2>
          <div class="field">
            <label for="invite-email">דואר אלקטרוני</label>
            <input id="invite-email" name="email" type="email" dir="ltr" required />
          </div>
          <div class="field">
            <label for="invite-role">הרשאה</label>
            <input id="invite-role" name="role" type="text" dir="ltr"
                   value="OPERATOR" required />
          </div>
          <button type="submit">יצירת הזמנה</button>
        </form>`
    : h``;
  const issued =
    screen.issuedInviteUrl === undefined
      ? h``
      : h`<div class="auth-card">
            <h2>ההזמנה נוצרה</h2>
            <p class="note">הכתובת מוצגת פעם אחת בלבד. העבירו אותה בערוץ שאתם סומכים עליו.</p>
            <p class="secret" dir="ltr">${screen.issuedInviteUrl}</p>
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
      <form method="post" action="/staff/logout">
        <button type="submit">יציאה</button>
      </form>
    </div>`;
  return page('דונה דום — הצוות', body);
}
